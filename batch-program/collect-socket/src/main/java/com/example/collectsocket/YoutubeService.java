package com.example.collectsocket;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import jakarta.annotation.PreDestroy;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 등록된(streamer_links/overlay_streamers) 유튜브 채널만 대상으로,
 * 유튜브 웹사이트가 쓰는 비공식 InnerTube 라이브챗 API를 폴링해서 채팅/슈퍼챗을 수집한다.
 * 공식 Data API(쿼터 제한, 타 채널 접근시 OAuth 필요 가능성)를 피하기 위한 선택.
 */
@Service
public class YoutubeService {

    private static final Logger log = LoggerFactory.getLogger(YoutubeService.class);
    private static final String USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    // InnerTube가 알려주는 timeoutMs를 우선 쓰고, 없거나 너무 짧으면 이 값을 하한선으로 사용(너무 자주 긁으면 차단 위험)
    private static final long MIN_POLL_INTERVAL_MS = 3_000;
    private static final long LIVE_CHECK_RETRY_DELAY_MS = 30_000;
    private static final int LIVE_CHECK_MAX_RETRIES = 3;

    private static final Pattern VIDEO_ID_PATTERN = Pattern.compile("\"videoId\":\"([a-zA-Z0-9_-]{11})\"");
    private static final Pattern API_KEY_PATTERN = Pattern.compile("\"INNERTUBE_API_KEY\":\"([^\"]+)\"");
    private static final Pattern CLIENT_VERSION_PATTERN = Pattern.compile("\"clientVersion\":\"([^\"]+)\"");
    private static final Pattern CONTINUATION_PATTERN = Pattern.compile("\"continuation\":\"([^\"]{20,})\"");
    private static final Pattern AMOUNT_DIGITS_PATTERN = Pattern.compile("[\\d.,]+");

    private final ObjectMapper json;
    private final JdbcTemplate jdbc;
    private final StringRedisTemplate redis;
    private final HttpClient httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ExecutorService pollWorkers = Executors.newCachedThreadPool();
    private final Set<String> activeChannels = ConcurrentHashMap.newKeySet();
    private volatile boolean shuttingDown;

    public YoutubeService(ObjectMapper json, JdbcTemplate jdbc, StringRedisTemplate redis) {
        this.json = json;
        this.jdbc = jdbc;
        this.redis = redis;
    }

    // 등록된 채널 목록을 주기적으로 확인해서, 아직 폴링 시작 안 한 채널이 있으면 시작한다
    @Scheduled(initialDelay = 5_000, fixedDelay = 120_000)
    void refreshChannels() {
        List<String> channelIds;
        try {
            channelIds = jdbc.queryForList("""
                    SELECT DISTINCT streamer_id FROM streamer_links WHERE platform='youtube'
                    UNION
                    SELECT DISTINCT streamer_id FROM overlay_streamers WHERE platform='youtube'
                    """, String.class);
        } catch (Exception error) {
            log.warn("유튜브 등록 채널 조회 실패: {}", rootMessage(error));
            return;
        }
        for (String channelId : channelIds) {
            if (activeChannels.add(channelId)) {
                pollWorkers.execute(() -> runChannel(channelId));
            }
        }
    }

    private void runChannel(String channelId) {
        try {
            int retries = 0;
            while (!shuttingDown) {
                String videoId = findLiveVideoId(channelId);
                if (videoId == null) {
                    retries++;
                    if (retries > LIVE_CHECK_MAX_RETRIES) return; // 다음 refreshChannels 주기에 다시 시도
                    Thread.sleep(LIVE_CHECK_RETRY_DELAY_MS);
                    continue;
                }
                retries = 0;
                pollLiveChat(channelId, videoId);
                // pollLiveChat이 끝났다는 건 방송이 끝났거나 오류 — 잠시 뒤 라이브 여부 다시 확인
                Thread.sleep(LIVE_CHECK_RETRY_DELAY_MS);
            }
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        } catch (Exception error) {
            log.warn("유튜브 채널 처리 실패: channelId={}, reason={}", channelId, rootMessage(error));
        } finally {
            activeChannels.remove(channelId);
        }
    }

    private String findLiveVideoId(String channelId) {
        try {
            String body = get("https://www.youtube.com/channel/" + channelId + "/live");
            Matcher matcher = VIDEO_ID_PATTERN.matcher(body);
            return matcher.find() ? matcher.group(1) : null;
        } catch (Exception error) {
            log.warn("유튜브 라이브 여부 확인 실패: channelId={}, reason={}", channelId, rootMessage(error));
            return null;
        }
    }

    private void pollLiveChat(String channelId, String videoId) throws InterruptedException {
        String popout;
        try {
            popout = get("https://www.youtube.com/live_chat?v=" + videoId + "&is_popout=1");
        } catch (Exception error) {
            log.warn("유튜브 라이브챗 초기 로드 실패: channelId={}, videoId={}, reason={}", channelId, videoId, rootMessage(error));
            return;
        }
        String apiKey = firstMatch(API_KEY_PATTERN, popout);
        String clientVersion = firstMatch(CLIENT_VERSION_PATTERN, popout);
        String continuation = firstMatch(CONTINUATION_PATTERN, popout);
        if (apiKey == null || clientVersion == null || continuation == null) {
            log.warn("유튜브 라이브챗 초기 토큰 파싱 실패(방송 종료/비공개 가능): channelId={}, videoId={}", channelId, videoId);
            return;
        }

        log.info("유튜브 라이브챗 연결 시작: channelId={}, videoId={}", channelId, videoId);
        while (!shuttingDown) {
            JsonNode response;
            try {
                response = requestLiveChat(apiKey, clientVersion, continuation);
            } catch (Exception error) {
                log.warn("유튜브 라이브챗 폴링 실패(종료 추정): channelId={}, videoId={}, reason={}", channelId, videoId, rootMessage(error));
                return;
            }
            JsonNode liveChat = response.path("continuationContents").path("liveChatContinuation");
            if (liveChat.isMissingNode()) return; // 방송/채팅 종료

            for (JsonNode action : liveChat.path("actions")) {
                handleAction(channelId, videoId, action);
            }

            JsonNode nextContinuationData = firstContinuationData(liveChat.path("continuations"));
            String nextContinuation = nextContinuationData.path("continuation").asText("");
            if (nextContinuation.isEmpty()) return;
            continuation = nextContinuation;
            long timeoutMs = nextContinuationData.path("timeoutMs").asLong(MIN_POLL_INTERVAL_MS);
            Thread.sleep(Math.max(timeoutMs, MIN_POLL_INTERVAL_MS));
        }
    }

    private JsonNode firstContinuationData(JsonNode continuations) {
        for (JsonNode continuation : continuations) {
            if (continuation.has("invalidationContinuationData")) return continuation.path("invalidationContinuationData");
            if (continuation.has("timedContinuationData")) return continuation.path("timedContinuationData");
            if (continuation.has("reloadContinuationData")) return continuation.path("reloadContinuationData");
        }
        return json.createObjectNode();
    }

    private JsonNode requestLiveChat(String apiKey, String clientVersion, String continuation) throws Exception {
        String body = json.writeValueAsString(Map.of(
                "context", Map.of("client", Map.of("clientName", "WEB", "clientVersion", clientVersion)),
                "continuation", continuation));
        HttpRequest request = HttpRequest.newBuilder(
                        URI.create("https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=" + apiKey))
                .header("Content-Type", "application/json").header("User-Agent", USER_AGENT)
                .timeout(Duration.ofSeconds(10))
                .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) throw new IllegalStateException("HTTP " + response.statusCode());
        return json.readTree(response.body());
    }

    private void handleAction(String channelId, String videoId, JsonNode action) {
        JsonNode item = action.path("addChatItemAction").path("item");
        if (item.isMissingNode()) return;

        JsonNode text = item.path("liveChatTextMessageRenderer");
        if (!text.isMissingNode()) {
            publishChat(channelId, text);
            return;
        }
        JsonNode paidMessage = item.path("liveChatPaidMessageRenderer");
        if (!paidMessage.isMissingNode()) {
            publishSuperChat(channelId, videoId, paidMessage, "superChat");
            return;
        }
        JsonNode paidSticker = item.path("liveChatPaidStickerRenderer");
        if (!paidSticker.isMissingNode()) {
            publishSuperChat(channelId, videoId, paidSticker, "superSticker");
        }
    }

    private void publishChat(String channelId, JsonNode renderer) {
        String userId = renderer.path("authorExternalChannelId").asText("");
        String nickname = renderer.path("authorName").path("simpleText").asText("익명");
        String message = joinRuns(renderer.path("message").path("runs"));
        Instant receivedAt = Instant.now();
        publishRealtime(Map.ofEntries(
                Map.entry("_id", UUID.randomUUID().toString()), Map.entry("type", "chat"),
                Map.entry("platform", "youtube"), Map.entry("streamer_id", channelId),
                Map.entry("streamer_nickname", channelId),
                Map.entry("user_id", userId), Map.entry("nickname", nickname),
                Map.entry("message", message), Map.entry("createdAt", receivedAt.toString()),
                Map.entry("ttl", receivedAt.plus(365, ChronoUnit.DAYS).toString()), Map.entry("__v", 0),
                Map.entry("extras", Map.of("youtube", Map.of()))));
    }

    // 슈퍼챗/슈퍼스티커. amount는 시청자가 결제한 통화 원문 금액(purchaseAmountText)에서 숫자만 뽑은 값이라
    // 통화 단위가 KRW로 정규화되어 있지 않음(SOOP/CHZZK와 달리) — 원문은 extras에 그대로 보존
    private void publishSuperChat(String channelId, String videoId, JsonNode renderer, String kind) {
        String userId = renderer.path("authorExternalChannelId").asText("");
        String nickname = renderer.path("authorName").path("simpleText").asText("익명");
        String message = joinRuns(renderer.path("message").path("runs"));
        String purchaseAmountText = renderer.path("purchaseAmountText").path("simpleText").asText("");
        long amount = parseAmount(purchaseAmountText);
        Instant receivedAt = Instant.now();
        String eventId = UUID.randomUUID().toString();
        Map<String, Object> extras = Map.of("youtube", Map.of(
                "kind", kind, "videoId", videoId, "purchaseAmountText", purchaseAmountText));
        String extrasJson = json.writeValueAsString(extras);
        try {
            jdbc.update("""
                    INSERT INTO donations
                    (_id, type, platform, streamer_id, message, user_id, nickname, cnt, amount, extras, created_at, ttl, `__v`)
                    VALUES (?, 'donation', 'youtube', ?, ?, ?, ?, 1, ?, ?, ?, ?, 0)
                    """, eventId, channelId, message, userId, nickname, amount, extrasJson,
                    java.sql.Timestamp.from(receivedAt), java.sql.Timestamp.from(receivedAt.plus(365, ChronoUnit.DAYS)));
        } catch (Exception error) {
            log.warn("유튜브 후원 저장 실패: channelId={}, reason={}", channelId, rootMessage(error));
        }
        publishRealtime(Map.ofEntries(
                Map.entry("_id", eventId), Map.entry("type", "donation"), Map.entry("platform", "youtube"),
                Map.entry("streamer_id", channelId), Map.entry("streamer_nickname", channelId),
                Map.entry("user_id", userId), Map.entry("nickname", nickname),
                Map.entry("message", message), Map.entry("cnt", 1), Map.entry("amount", amount),
                Map.entry("createdAt", receivedAt.toString()),
                Map.entry("ttl", receivedAt.plus(365, ChronoUnit.DAYS).toString()), Map.entry("__v", 0),
                Map.entry("extras", extras)));
    }

    private static long parseAmount(String purchaseAmountText) {
        Matcher matcher = AMOUNT_DIGITS_PATTERN.matcher(purchaseAmountText);
        if (!matcher.find()) return 0L;
        String digits = matcher.group().replace(",", "");
        try { return Math.round(Double.parseDouble(digits)); } catch (NumberFormatException e) { return 0L; }
    }

    private static String joinRuns(JsonNode runs) {
        StringBuilder builder = new StringBuilder();
        for (JsonNode run : runs) {
            if (run.has("text")) builder.append(run.path("text").asText());
            else if (run.has("emoji")) builder.append(run.path("emoji").path("shortcuts").path(0).asText(""));
        }
        return builder.toString();
    }

    private void publishRealtime(Map<String, Object> event) {
        try {
            redis.convertAndSend("collector.events", json.writeValueAsString(event));
        } catch (Exception error) {
            log.warn("유튜브 이벤트 Redis 발행 실패: {}", rootMessage(error));
        }
    }

    private String get(String url) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .header("User-Agent", USER_AGENT).timeout(Duration.ofSeconds(10)).GET().build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) throw new IllegalStateException("HTTP " + response.statusCode());
        return response.body();
    }

    private static String firstMatch(Pattern pattern, String text) {
        Matcher matcher = pattern.matcher(text);
        return matcher.find() ? matcher.group(1) : null;
    }

    private static String rootMessage(Throwable error) {
        Throwable root = error;
        while (root.getCause() != null && root.getCause() != root) root = root.getCause();
        String message = root.getMessage();
        return root.getClass().getSimpleName() + (message == null ? "" : ": " + message);
    }

    @PreDestroy
    void shutdown() {
        shuttingDown = true;
        pollWorkers.shutdownNow();
    }
}
