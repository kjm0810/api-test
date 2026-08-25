package com.example.collectsocket;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.Duration;
import java.util.Comparator;
import java.util.List;
import java.util.ArrayList;
import java.util.Set;
import java.util.Map;
import java.util.UUID;
import java.time.temporal.ChronoUnit;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.fasterxml.jackson.annotation.JsonProperty;
import tools.jackson.databind.ObjectMapper;

import jakarta.annotation.PreDestroy;

@Service
public class SoopService {

    private static final Logger log = LoggerFactory.getLogger(SoopService.class);
    private static final String STARTER = "\u001B\t";
    private static final String SEP = "\f";
    private final RestClient live = RestClient.create("https://live.sooplive.com");
    private final RestClient detail = RestClient.create("https://live.sooplive.co.kr");
    private final RestClient chzzk = RestClient.create("https://api.chzzk.naver.com");
    private final RestClient chzzkGame = RestClient.create("https://comm-api.game.naver.com/nng_main");
    private final ObjectMapper json;
    private final JdbcTemplate jdbc;
    private final StringRedisTemplate redis;
    private final HttpClient httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ConcurrentHashMap<String, ChatSocket> sockets = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, ChzzkSocket> chzzkSockets = new ConcurrentHashMap<>();
    private final ExecutorService soopConnectors = Executors.newFixedThreadPool(32);
    private final ExecutorService chzzkConnectors = Executors.newFixedThreadPool(32);
    private final Set<String> connecting = ConcurrentHashMap.newKeySet();
    private final ConcurrentHashMap<String, RetryState> retryStates = new ConcurrentHashMap<>();
    private final ConcurrentLinkedDeque<ConnectionFailure> connectionFailures = new ConcurrentLinkedDeque<>();
    private final Object chzzkRateLock = new Object();
    private long chzzkNextRequestAt;
    private final CopyOnWriteArrayList<SseEmitter> emitters = new CopyOnWriteArrayList<>();
    private final ScheduledExecutorService pingScheduler = Executors.newSingleThreadScheduledExecutor();
    private final AtomicInteger failures = new AtomicInteger();
    private final AtomicLong donations = new AtomicLong();
    private final ConcurrentLinkedDeque<Donation> donationEvents = new ConcurrentLinkedDeque<>();
    private final LinkedBlockingQueue<DonationRow> saveQueue = new LinkedBlockingQueue<>();
    private final LinkedBlockingQueue<MissionRow> missionSaveQueue = new LinkedBlockingQueue<>();
    private volatile List<Broadcast> broadcasts = List.of();
    private volatile List<ChzzkBroadcast> chzzkBroadcasts = List.of();
    private volatile Instant lastSyncAt;

    public SoopService(ObjectMapper json, JdbcTemplate jdbc, StringRedisTemplate redis) {
        this.json = json;
        this.jdbc = jdbc;
        this.redis = redis;
        pingScheduler.scheduleAtFixedRate(this::pingAll, 60, 60, TimeUnit.SECONDS);
        pingScheduler.scheduleAtFixedRate(this::pingAllChzzk, 20, 20, TimeUnit.SECONDS);
    }

    @Scheduled(initialDelay = 1_000, fixedDelay = 60_000)
    public void refresh() {
        try {
            broadcasts = fetchAll();
            lastSyncAt = Instant.now();
            Set<String> wanted = broadcasts.stream().map(Broadcast::userId).collect(java.util.stream.Collectors.toSet());
            sockets.forEach((id, socket) -> {
                if (!wanted.contains(id) && sockets.remove(id, socket)) socket.close();
            });
            broadcasts.forEach(this::submitSoopConnect);
            publish();
        } catch (Exception ignored) {
            failures.incrementAndGet();
        }
    }

    public List<Broadcast> broadcasts() {
        return broadcasts;
    }

    public List<ChzzkBroadcast> chzzkBroadcasts() {
        return chzzkBroadcasts;
    }

    public Status status() {
        return new Status(broadcasts.size(), chzzkBroadcasts.size(), sockets.size(), chzzkSockets.size(),
                failures.get(), donations.get(), lastSyncAt);
    }

    @Scheduled(initialDelay = 1_000, fixedDelay = 60_000)
    public void refreshChzzk() {
        try {
            chzzkBroadcasts = fetchAllChzzk();
            Set<String> wanted = chzzkBroadcasts.stream().map(ChzzkBroadcast::channelId)
                    .collect(java.util.stream.Collectors.toSet());
            chzzkSockets.forEach((id, socket) -> {
                if (!wanted.contains(id) && chzzkSockets.remove(id, socket)) socket.close();
            });
            chzzkBroadcasts.forEach(this::submitChzzkConnect);
            log.info("CHZZK 방송 목록 동기화: {}개", chzzkBroadcasts.size());
            publish();
        } catch (Exception error) {
            failures.incrementAndGet();
            log.error("CHZZK 방송 목록 조회 실패", error);
        }
    }

    public List<Donation> donations() {
        return donationEvents.stream().toList();
    }

    public List<ConnectionFailure> connectionFailures() {
        return connectionFailures.stream().toList();
    }

    @Scheduled(initialDelay = 5_000, fixedDelay = 5_000)
    void reconnectDisconnected() {
        broadcasts.forEach(this::submitSoopConnect);
        chzzkBroadcasts.forEach(this::submitChzzkConnect);
    }

    public SseEmitter subscribe() {
        SseEmitter emitter = new SseEmitter(0L);
        emitters.add(emitter);
        emitter.onCompletion(() -> emitters.remove(emitter));
        emitter.onTimeout(() -> emitters.remove(emitter));
        send(emitter);
        return emitter;
    }

    @Scheduled(fixedDelay = 15_000)
    void heartbeat() {
        publish();
    }

    @Scheduled(fixedDelay = 1_000)
    void saveDonations() {
        List<DonationRow> batch = new ArrayList<>(1000);
        saveQueue.drainTo(batch, 1000);
        if (batch.isEmpty()) return;
        try {
            jdbc.batchUpdate("""
                    INSERT INTO donations
                    (_id, type, platform, streamer_id, message, user_id, nickname, cnt, amount, extras, created_at, ttl, `__v`)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, batch, 1000, (statement, row) -> {
                        statement.setString(1, row.id());
                        statement.setString(2, "donation");
                        statement.setString(3, row.platform());
                        statement.setString(4, row.streamerId());
                        statement.setString(5, row.message());
                        statement.setString(6, row.userId());
                        statement.setString(7, row.nickname());
                        statement.setInt(8, row.count());
                        statement.setLong(9, row.amount());
                        statement.setString(10, row.extras());
                        statement.setTimestamp(11, java.sql.Timestamp.from(row.createdAt()));
                        statement.setTimestamp(12, java.sql.Timestamp.from(row.ttl()));
                        statement.setInt(13, 0);
                    });
        } catch (Exception ignored) {
            saveQueue.addAll(batch);
            failures.incrementAndGet();
        }
    }

    @Scheduled(fixedDelay = 1_000)
    void saveMissions() {
        List<MissionRow> batch = new ArrayList<>(1000);
        missionSaveQueue.drainTo(batch, 1000);
        if (batch.isEmpty()) return;
        try {
            jdbc.batchUpdate("""
                    INSERT INTO missions
                    (_id, platform, streamer_id, mission_key, mission_type, mission_phase, title, user_id, nickname, cnt, amount, extras, created_at, ttl, `__v`)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, batch, 1000, (statement, row) -> {
                        statement.setString(1, row.id());
                        statement.setString(2, row.platform());
                        statement.setString(3, row.streamerId());
                        statement.setString(4, row.missionKey());
                        statement.setString(5, row.missionType());
                        statement.setString(6, row.missionPhase());
                        statement.setString(7, row.title());
                        statement.setString(8, row.userId());
                        statement.setString(9, row.nickname());
                        statement.setInt(10, row.cnt());
                        statement.setLong(11, row.amount());
                        statement.setString(12, row.extras());
                        statement.setTimestamp(13, java.sql.Timestamp.from(row.createdAt()));
                        statement.setTimestamp(14, java.sql.Timestamp.from(row.ttl()));
                        statement.setInt(15, 0);
                    });
        } catch (Exception ignored) {
            missionSaveQueue.addAll(batch);
            failures.incrementAndGet();
        }
    }

    private List<Broadcast> fetchAll() throws Exception {
        BroadcastResponse first = fetchPage(1);
        List<Broadcast> all = new ArrayList<>();
        addEligibleSoop(all, first.broad());
        int pageSize = first.cnt() > 0 ? first.cnt() : 60;
        int totalPages = (Integer.parseInt(first.totalCnt()) + pageSize - 1) / pageSize;
        for (int page = 2; page <= totalPages; page++)
            addEligibleSoop(all, fetchPage(page).broad());
        return all.stream()
                .sorted(Comparator.comparingInt(Broadcast::viewerCount).reversed())
                .toList();
    }

    private void addEligibleSoop(List<Broadcast> target, List<Broadcast> page) {
        page.stream().filter(item -> !"Y".equals(item.passwordProtected()))
                .filter(item -> !"19".equals(item.grade()))
                .forEach(target::add);
    }

    private BroadcastResponse fetchPage(int page) throws Exception {
        String body = live.get().uri(uri -> uri.path("/api/main_broad_list_api.php")
                        .queryParam("selectType", "action").queryParam("selectValue", "all")
                        .queryParam("orderType", "view_cnt").queryParam("pageNo", page)
                        .queryParam("strmLangType", "").queryParam("lang", "ko_KR")
                        .queryParam("_", System.currentTimeMillis()).build())
                .header("User-Agent", "Mozilla/5.0").header("Referer", "https://www.sooplive.co.kr/")
                .retrieve().body(String.class);
        return json.readValue(body, BroadcastResponse.class);
    }

    private List<ChzzkBroadcast> fetchAllChzzk() throws Exception {
        List<ChzzkBroadcast> all = new ArrayList<>();
        Set<String> seenCursors = new java.util.HashSet<>();
        Integer concurrentUserCount = null;
        Long liveId = null;
        do {
            String body;
            try {
                body = fetchChzzkPageWithRetry(concurrentUserCount, liveId);
            } catch (Exception error) {
                if (all.isEmpty()) throw error;
                break;
            }
            var content = json.readTree(body).path("content");
            for (var item : content.path("data")) {
                if (item.path("adult").asBoolean(false)) continue;
                if (!"ALLOWED".equals(item.path("tvAppViewingPolicyType").asText())) continue;
                var channel = item.path("channel");
                all.add(new ChzzkBroadcast(item.path("liveId").asLong(), channel.path("channelId").asText(),
                        channel.path("channelName").asText(), item.path("liveTitle").asText(),
                        item.path("concurrentUserCount").asInt()));
            }
            var next = content.path("page").path("next");
            if (next.isMissingNode() || next.isNull()) break;
            concurrentUserCount = next.path("concurrentUserCount").asInt();
            liveId = next.path("liveId").asLong();
            if (!seenCursors.add(concurrentUserCount + ":" + liveId)) break;
            Thread.sleep(100);
        } while (liveId != null);
        return List.copyOf(all);
    }

    private String fetchChzzkPageWithRetry(Integer concurrentUserCount, Long liveId) throws Exception {
        Exception last = null;
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                return fetchChzzkPage(concurrentUserCount, liveId);
            } catch (Exception error) {
                last = error;
                Thread.sleep(attempt * 500L);
            }
        }
        throw last;
    }

    private String fetchChzzkPage(Integer concurrentUserCount, Long liveId) {
        return chzzk.get().uri(uri -> {
                    var builder = uri.path("/service/v1/lives").queryParam("size", 20)
                            .queryParam("sortType", "POPULAR");
                    if (concurrentUserCount != null && liveId != null) builder
                            .queryParam("concurrentUserCount", concurrentUserCount).queryParam("liveId", liveId);
                    return builder.build();
                }).header("User-Agent", "Mozilla/5.0")
                .header("Accept", "application/json").retrieve().body(String.class);
    }

    private void submitSoopConnect(Broadcast broadcast) {
        String key = "soop:" + broadcast.userId();
        if (sockets.containsKey(broadcast.userId()) || !canRetry(key) || !connecting.add(key)) return;
        soopConnectors.execute(() -> {
            try {
                ChatSocket socket = connect(broadcast.userId());
                if (socket != null && !socket.closed) sockets.putIfAbsent(broadcast.userId(), socket);
            } finally {
                connecting.remove(key);
            }
        });
    }

    private void submitChzzkConnect(ChzzkBroadcast broadcast) {
        String key = "chzzk:" + broadcast.channelId();
        if (chzzkSockets.containsKey(broadcast.channelId()) || !canRetry(key) || !connecting.add(key)) return;
        chzzkConnectors.execute(() -> {
            try {
                ChzzkSocket socket = connectChzzk(broadcast);
                if (socket != null && !socket.closed) chzzkSockets.putIfAbsent(broadcast.channelId(), socket);
            } finally {
                connecting.remove(key);
            }
        });
    }

    private boolean canRetry(String key) {
        RetryState retry = retryStates.get(key);
        return retry == null || !Instant.now().isBefore(retry.nextAttempt());
    }

    private void connected(String platform, String targetId) {
        retryStates.remove(platform + ":" + targetId);
    }

    private void connectionFailed(String platform, String targetId, String stage, Throwable error) {
        String key = platform + ":" + targetId;
        RetryState previous = retryStates.get(key);
        int attempts = previous == null ? 1 : previous.attempts() + 1;
        String reason = rootMessage(error);
        boolean rateLimited = reason.contains("429") || reason.contains("TooManyRequests");
        long baseSeconds = rateLimited
                ? Math.min(300L, 30L * (1L << Math.min(attempts - 1, 4)))
                : Math.min(60L, 1L << Math.min(attempts - 1, 6));
        long delayMillis = baseSeconds * 1000L + ThreadLocalRandom.current().nextLong(500L);
        retryStates.put(key, new RetryState(attempts, Instant.now().plusMillis(delayMillis)));
        connectionFailures.addFirst(new ConnectionFailure(Instant.now(), platform, targetId, stage,
                reason, attempts, delayMillis));
        while (connectionFailures.size() > 200) connectionFailures.pollLast();
        failures.incrementAndGet();
        log.warn("{} 연결 실패: target={}, stage={}, attempt={}, retry={}ms, reason={}",
                platform.toUpperCase(), targetId, stage, attempts, delayMillis, reason);
    }

    private static String rootMessage(Throwable error) {
        if (error == null) return "unknown";
        Throwable root = error;
        while (root.getCause() != null && root.getCause() != root) root = root.getCause();
        String message = root.getMessage();
        return root.getClass().getSimpleName() + (message == null ? "" : ": " + message);
    }

    private ChzzkSocket connectChzzk(ChzzkBroadcast broadcast) {
        try {
            throttleChzzkRequest();
            String statusBody = chzzk.get().uri("/polling/v2/channels/{id}/live-status", broadcast.channelId())
                    .header("User-Agent", "Mozilla/5.0").retrieve().body(String.class);
            String chatChannelId = json.readTree(statusBody).path("content").path("chatChannelId").asText();
            if (chatChannelId.isBlank()) {
                connectionFailed("chzzk", broadcast.channelId(), "live-status", new IllegalStateException("chatChannelId 없음"));
                return null;
            }
            throttleChzzkRequest();
            String tokenBody = chzzkGame.get().uri(uri -> uri.path("/v1/chats/access-token")
                            .queryParam("channelId", chatChannelId).queryParam("chatType", "STREAMING").build())
                    .header("User-Agent", "Mozilla/5.0").retrieve().body(String.class);
            String accessToken = json.readTree(tokenBody).path("content").path("accessToken").asText();
            if (accessToken.isBlank()) {
                connectionFailed("chzzk", broadcast.channelId(), "access-token", new IllegalStateException("accessToken 없음"));
                return null;
            }
            int serverId = chatChannelId.chars().sum() % 9 + 1;
            return new ChzzkSocket(broadcast, chatChannelId, accessToken,
                    "wss://kr-ss" + serverId + ".chat.naver.com/chat");
        } catch (Exception error) {
            connectionFailed("chzzk", broadcast.channelId(), "handshake", error);
            return null;
        }
    }

    private void throttleChzzkRequest() throws InterruptedException {
        synchronized (chzzkRateLock) {
            long now = System.currentTimeMillis();
            long waitMillis = chzzkNextRequestAt - now;
            if (waitMillis > 0) Thread.sleep(waitMillis);
            chzzkNextRequestAt = System.currentTimeMillis() + 100L;
        }
    }

    private ChatSocket connect(String streamerId) {
        try {
            var form = new LinkedMultiValueMap<String, String>();
            form.add("bid", streamerId); form.add("type", "live"); form.add("pwd", "");
            form.add("player_type", "html5"); form.add("stream_type", "common");
            form.add("quality", "HD"); form.add("mode", "landing");
            form.add("from_api", "0"); form.add("is_revive", "false");
            String body = detail.post().uri("/afreeca/player_live_api.php?bjid={id}", streamerId)
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED).header("User-Agent", "Mozilla/5.0")
                    .header("Referer", "https://play.sooplive.co.kr/" + streamerId)
                    .body(form).retrieve().body(String.class);
            var channel = json.readTree(body).path("CHANNEL");
            if (channel.path("RESULT").asInt() == 0) {
                connectionFailed("soop", streamerId, "player-api", new IllegalStateException("RESULT=0"));
                return null;
            }
            String domain = channel.path("CHDOMAIN").asText().trim().toLowerCase();
            int port = channel.path("CHPT").asInt();
            String chatNo = channel.path("CHATNO").asText();
            if (domain.isBlank() || port <= 0 || chatNo.isBlank()) {
                connectionFailed("soop", streamerId, "player-api-invalid",
                        new IllegalStateException("CHDOMAIN/CHPT/CHATNO 누락"));
                return null;
            }
            String url = "wss://" + domain + ":" + (port + 1) + "/Websocket/" + streamerId;
            return new ChatSocket(streamerId, chatNo, url);
        } catch (Exception error) {
            connectionFailed("soop", streamerId, "handshake", error);
            return null;
        }
    }

    private void donation(String streamerId, String type, String raw) {
        String[] values = raw.split(SEP, -1);
        int offset = "0018".equals(type) ? 0 : 1;
        String fromId = value(values, 2 + offset);
        String fromNickname = value(values, 3 + offset);
        String from = fromNickname + "(" + fromId + ")";
        String countText = "0087".equals(type) ? value(values, 10) : value(values, 4 + offset);
        int count;
        try { count = Integer.parseInt(countText); } catch (NumberFormatException ignored) { count = 0; }
        Broadcast target = broadcasts.stream().filter(item -> item.userId().equals(streamerId)).findFirst().orElse(null);
        String targetNickname = target == null ? streamerId : target.userNickname();
        String to = targetNickname + "(" + streamerId + ")";
        Instant receivedAt = Instant.now();
        String eventId = UUID.randomUUID().toString();
        donationEvents.addFirst(new Donation(receivedAt, "SOOP", from, to, countText, type));
        String extras = json.writeValueAsString(Map.of("soop", Map.of(
                "typeNum", Integer.parseInt(type), "raw", raw)));
        saveQueue.offer(new DonationRow(eventId, "soop", streamerId, "", fromId,
                fromNickname, count, count * 100L, extras, receivedAt,
                receivedAt.plus(365, ChronoUnit.DAYS)));
        publishRealtime(Map.ofEntries(
                Map.entry("_id", eventId), Map.entry("type", "donation"), Map.entry("platform", "soop"),
                Map.entry("streamer_id", streamerId), Map.entry("streamer_nickname", targetNickname),
                Map.entry("user_id", fromId),
                Map.entry("nickname", fromNickname), Map.entry("message", ""), Map.entry("cnt", count),
                Map.entry("amount", count * 100L), Map.entry("createdAt", receivedAt.toString()),
                Map.entry("ttl", receivedAt.plus(365, ChronoUnit.DAYS).toString()), Map.entry("__v", 0),
                Map.entry("extras", Map.of(
                        "typeName", soopDonationTypeName(type),
                        "soop", Map.of("typeNum", Integer.parseInt(type))))));
        while (donationEvents.size() > 100) donationEvents.pollLast();
        donations.incrementAndGet();
        publish();
    }

    private static String value(String[] values, int index) {
        return index < values.length && !values[index].isBlank() ? values[index] : "알 수 없음";
    }

    private static String soopDonationTypeName(String type) {
        return switch (type) {
            case "0018" -> "SVC_SENDBALLOON";
            case "0105" -> "SVC_VIDEOBALLOON";
            case "0087" -> "SVC_ADCON_EFFECT";
            default -> "UNKNOWN";
        };
    }

    private void mission(String streamerId, String raw) {
        int jsonStart = raw.indexOf('{');
        if (jsonStart < 0) {
            log.info("SOOP 미션(0121) JSON 없음: streamerId={}, raw={}", streamerId, raw);
            return;
        }
        try {
            // 실측 페이로드 기준: message 래퍼 없이 최상위에 필드가 바로 있고, action이 아니라 type,
            // count가 아니라 gift_count, userNickname이 아니라 user_nick. key가 미션 고유 식별자.
            var root = json.readTree(raw.substring(jsonStart));
            String type = root.path("type").asText();
            String phase = soopMissionPhase(type);
            if (phase == null) {
                log.info("SOOP 미션(0121) 알 수 없는 type: streamerId={}, type={}, body={}", streamerId, type, root);
                return;
            }
            String missionKey = root.path("key").asText("");
            String userId = root.path("user_id").asText("");
            String nickname = root.path("user_nick").asText("");
            int cnt = root.path("gift_count").asInt(0);
            long amount = cnt * 100L;
            String title = root.path("title").asText("");
            Instant receivedAt = Instant.now();
            String eventId = UUID.randomUUID().toString();
            Broadcast target = broadcasts.stream().filter(item -> item.userId().equals(streamerId)).findFirst().orElse(null);
            String targetNickname = target == null ? streamerId : target.userNickname();
            Map<String, Object> extras = Map.of("soop", root);
            missionSaveQueue.offer(new MissionRow(eventId, "soop", streamerId, missionKey,
                    type, phase, title, userId, nickname, cnt, amount,
                    json.writeValueAsString(extras), receivedAt,
                    receivedAt.plus(365, ChronoUnit.DAYS)));
            publishRealtime(Map.ofEntries(
                    Map.entry("_id", eventId), Map.entry("type", "mission"), Map.entry("platform", "soop"),
                    Map.entry("streamer_id", streamerId), Map.entry("streamer_nickname", targetNickname),
                    Map.entry("user_id", userId), Map.entry("nickname", nickname),
                    Map.entry("mission_type", type), Map.entry("mission_phase", phase),
                    Map.entry("mission_key", missionKey), Map.entry("title", title),
                    Map.entry("cnt", cnt), Map.entry("amount", amount),
                    Map.entry("createdAt", receivedAt.toString()),
                    Map.entry("ttl", receivedAt.plus(365, ChronoUnit.DAYS).toString()), Map.entry("__v", 0),
                    Map.entry("extras", extras)));
        } catch (Exception ignored) {
        }
    }

    private static String soopMissionPhase(String type) {
        return switch (type) {
            // GIFT: 일반 미션(도전/대결 아님), CHALLENGE_GIFT: 도전미션, BATTLE_GIFT: 대결미션(추정)
            case "GIFT", "CHALLENGE_GIFT", "BATTLE_GIFT" -> "receive";
            case "SETTLE", "CHALLENGE_SETTLE", "BATTLE_SETTLE" -> "settle";
            case "FINISH", "CHALLENGE_FINISH", "BATTLE_FINISH" -> "result";
            default -> null;
        };
    }

    private void chat(String streamerId, String raw) {
        String[] values = raw.split(SEP, -1);
        Instant receivedAt = Instant.now();
        Broadcast target = broadcasts.stream().filter(item -> item.userId().equals(streamerId)).findFirst().orElse(null);
        String targetNickname = target == null ? streamerId : target.userNickname();
        publishRealtime(Map.ofEntries(
                Map.entry("_id", UUID.randomUUID().toString()), Map.entry("type", "chat"),
                Map.entry("platform", "soop"), Map.entry("streamer_id", streamerId),
                Map.entry("streamer_nickname", targetNickname),
                Map.entry("user_id", value(values, 2)), Map.entry("nickname", value(values, 6)),
                Map.entry("message", value(values, 1)), Map.entry("createdAt", receivedAt.toString()),
                Map.entry("ttl", receivedAt.plus(365, ChronoUnit.DAYS).toString()), Map.entry("__v", 0),
                Map.entry("extras", Map.of("soop", Map.of()))));
    }

    private void publishRealtime(Map<String, Object> event) {
        try {
            redis.convertAndSend("collector.events", json.writeValueAsString(event));
        } catch (Exception error) {
            log.warn("Redis 이벤트 발행 실패: {}", rootMessage(error));
        }
    }

    private void pingAll() { sockets.values().forEach(ChatSocket::ping); }
    private void pingAllChzzk() { chzzkSockets.values().forEach(ChzzkSocket::ping); }
    private void publish() { emitters.forEach(this::send); }
    private void send(SseEmitter emitter) {
        try { emitter.send(SseEmitter.event().name("status").data(status())); }
        catch (IOException | IllegalStateException e) { emitters.remove(emitter); emitter.complete(); }
    }
    private static String packet(String type, String payload) {
        return STARTER + type + String.format("%06d", payload.getBytes(StandardCharsets.UTF_8).length) + "00" + payload;
    }

    @PreDestroy
    void shutdown() {
        sockets.values().forEach(ChatSocket::close);
        chzzkSockets.values().forEach(ChzzkSocket::close);
        soopConnectors.shutdownNow();
        chzzkConnectors.shutdownNow();
        pingScheduler.shutdownNow();
    }

    public record Broadcast(@JsonProperty("broad_no") String broadcastNo,
            @JsonProperty("user_id") String userId, @JsonProperty("user_nick") String userNickname,
            @JsonProperty("broad_title") String title, @JsonProperty("total_view_cnt") int viewerCount,
            @JsonProperty("is_password") String passwordProtected,
            @JsonProperty("broad_grade") String grade) {}
    public record BroadcastResponse(@JsonProperty("total_cnt") String totalCnt, int cnt,
            List<Broadcast> broad) {}
    public record Status(int broadcasts, int chzzkBroadcasts, int connectedSockets, int chzzkConnectedSockets,
            int failedSockets,
            long savedEvents, Instant lastSyncAt) {}
    public record ChzzkBroadcast(long liveId, String channelId, String channelName,
            String title, int viewerCount) {}
    public record Donation(Instant receivedAt, String platform, String from, String to, String amount, String type) {}
    public record ConnectionFailure(Instant occurredAt, String platform, String targetId,
            String stage, String reason, int attempts, long retryAfterMillis) {}
    private record RetryState(int attempts, Instant nextAttempt) {}
    private record DonationRow(String id, String platform, String streamerId, String message,
            String userId, String nickname, int count, long amount, String extras,
            Instant createdAt, Instant ttl) {}
    private record MissionRow(String id, String platform, String streamerId, String missionKey,
            String missionType, String missionPhase, String title, String userId, String nickname,
            int cnt, long amount, String extras, Instant createdAt, Instant ttl) {}

    private final class ChatSocket implements WebSocket.Listener {
        private final String streamerId;
        private final String chatNo;
        private final StringBuilder buffer = new StringBuilder();
        private volatile WebSocket socket;
        private volatile boolean intentionalClose;
        private volatile boolean closed;

        ChatSocket(String streamerId, String chatNo, String url) {
            this.streamerId = streamerId; this.chatNo = chatNo;
            socket = httpClient.newWebSocketBuilder().subprotocols("chat")
                    .buildAsync(URI.create(url), this).orTimeout(10, TimeUnit.SECONDS).join();
        }
        public void onOpen(WebSocket ws) {
            connected("soop", streamerId);
            ws.request(1);
            ws.sendText(packet("0001", SEP.repeat(3) + "16" + SEP), true);
        }
        public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
            buffer.append(data);
            if (last) { handle(ws, buffer.toString()); buffer.setLength(0); }
            ws.request(1); return null;
        }
        public CompletionStage<?> onBinary(WebSocket ws, ByteBuffer data, boolean last) {
            byte[] bytes = new byte[data.remaining()]; data.get(bytes);
            return onText(ws, new String(bytes, StandardCharsets.UTF_8), last);
        }
        public CompletionStage<?> onClose(WebSocket ws, int code, String reason) {
            closed = true;
            sockets.remove(streamerId, this);
            if (!intentionalClose && broadcasts.stream().anyMatch(item -> item.userId().equals(streamerId)))
                connectionFailed("soop", streamerId, "socket-close-" + code, new IOException(reason));
            return null;
        }
        public void onError(WebSocket ws, Throwable error) {
            closed = true;
            sockets.remove(streamerId, this);
            if (!intentionalClose) connectionFailed("soop", streamerId, "socket-error", error);
        }
        void handle(WebSocket ws, String raw) {
            if (!raw.startsWith(STARTER) || raw.length() < 6) return;
            String type = raw.substring(2, 6);
            if ("0001".equals(type)) ws.sendText(packet("0002", SEP + chatNo + SEP.repeat(5)), true);
            else if ("0005".equals(type)) chat(streamerId, raw);
            else if ("0018".equals(type) || "0105".equals(type) || "0087".equals(type)) donation(streamerId, type, raw);
            else if ("0121".equals(type)) mission(streamerId, raw);
        }
        void ping() { if (socket != null && !socket.isOutputClosed()) socket.sendText(packet("0000", SEP), true); }
        void close() {
            intentionalClose = true;
            closed = true;
            if (socket != null) socket.sendClose(WebSocket.NORMAL_CLOSURE, "refresh");
        }
    }

    private final class ChzzkSocket implements WebSocket.Listener {
        private final ChzzkBroadcast broadcast;
        private final String chatChannelId;
        private final String accessToken;
        private final StringBuilder buffer = new StringBuilder();
        private volatile WebSocket socket;
        private volatile boolean intentionalClose;
        private volatile boolean closed;

        ChzzkSocket(ChzzkBroadcast broadcast, String chatChannelId, String accessToken, String url) {
            this.broadcast = broadcast;
            this.chatChannelId = chatChannelId;
            this.accessToken = accessToken;
            this.socket = httpClient.newWebSocketBuilder().buildAsync(URI.create(url), this)
                    .orTimeout(10, TimeUnit.SECONDS).join();
        }

        public void onOpen(WebSocket ws) {
            ws.request(1);
            try {
                ws.sendText(json.writeValueAsString(Map.of(
                        "bdy", Map.of("accTkn", accessToken, "auth", "READ", "devType", 2001),
                        "cmd", 100, "tid", 1, "cid", chatChannelId, "svcid", "game", "ver", "2")), true);
            } catch (Exception e) {
                connectionFailed("chzzk", broadcast.channelId(), "connect-packet", e);
                ws.abort();
            }
        }

        public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
            buffer.append(data);
            if (last) {
                handle(ws, buffer.toString());
                buffer.setLength(0);
            }
            ws.request(1);
            return null;
        }

        public CompletionStage<?> onBinary(WebSocket ws, ByteBuffer data, boolean last) {
            byte[] bytes = new byte[data.remaining()];
            data.get(bytes);
            return onText(ws, new String(bytes, StandardCharsets.UTF_8), last);
        }

        public CompletionStage<?> onClose(WebSocket ws, int code, String reason) {
            closed = true;
            chzzkSockets.remove(broadcast.channelId(), this);
            if (!intentionalClose && chzzkBroadcasts.stream().anyMatch(item -> item.channelId().equals(broadcast.channelId())))
                connectionFailed("chzzk", broadcast.channelId(), "socket-close-" + code, new IOException(reason));
            return null;
        }

        public void onError(WebSocket ws, Throwable error) {
            closed = true;
            chzzkSockets.remove(broadcast.channelId(), this);
            if (!intentionalClose) connectionFailed("chzzk", broadcast.channelId(), "socket-error", error);
        }

        private void handle(WebSocket ws, String raw) {
            try {
                var root = json.readTree(raw);
                int command = root.path("cmd").asInt();
                if (command == 10100) connected("chzzk", broadcast.channelId());
                if (command == 0) {
                    ws.sendText("{\"cmd\":10000,\"ver\":\"2\"}", true);
                    return;
                }
                if (command != 93101 && command != 93102 && command != 15101) return;
                var body = root.path("bdy");
                var messages = body.has("messageList") ? body.path("messageList") : body;
                if (!messages.isArray()) return;
                for (var message : messages) {
                    int type = message.has("msgTypeCode") ? message.path("msgTypeCode").asInt()
                            : message.path("messageTypeCode").asInt();
                    var profile = parseEmbeddedJson(message.path("profile"));
                    var extras = parseEmbeddedJson(message.path("extras"));
                    String nickname = profile.path("nickname").asText(extras.path("nickname").asText("익명"));
                    String userId = profile.path("userIdHash").asText("");
                    String text = message.has("msg") ? message.path("msg").asText() : message.path("content").asText();
                    if (type == 1) {
                        Instant receivedAt = Instant.now();
                        publishRealtime(Map.ofEntries(
                                Map.entry("_id", UUID.randomUUID().toString()), Map.entry("type", "chat"),
                                Map.entry("platform", "chzzk"), Map.entry("streamer_id", broadcast.channelId()),
                                Map.entry("streamer_nickname", broadcast.channelName()),
                                Map.entry("user_id", userId), Map.entry("nickname", nickname),
                                Map.entry("message", text), Map.entry("createdAt", receivedAt.toString()),
                                Map.entry("ttl", receivedAt.plus(365, ChronoUnit.DAYS).toString()), Map.entry("__v", 0),
                                Map.entry("extras", Map.of("chzzk", extras))));
                        continue;
                    }
                    if (type != 10) continue;
                    long amount = extras.path("payAmount").asLong();
                    String donationType = extras.path("donationType").asText();
                    if ("MISSION".equals(donationType) || "MISSION_PARTICIPATION".equals(donationType)) {
                        Instant receivedAt = Instant.now();
                        String missionKey = "MISSION".equals(donationType)
                                ? extras.path("missionDonationId").asText("")
                                : extras.path("relatedMissionDonationId").asText("");
                        String missionTitle = extras.path("missionText").asText("");
                        // mission_type은 donationType이 아니라 status(PENDING/APPROVED). cnt는 금액과 무관하게 항상 1건.
                        String missionStatus = extras.path("status").asText("");
                        String missionEventId = UUID.randomUUID().toString();
                        Map<String, Object> missionExtras = Map.of("chzzk", extras);
                        missionSaveQueue.offer(new MissionRow(missionEventId, "chzzk",
                                broadcast.channelId(), missionKey, missionStatus, "receive", missionTitle, userId, nickname,
                                1, amount,
                                json.writeValueAsString(missionExtras), receivedAt,
                                receivedAt.plus(365, ChronoUnit.DAYS)));
                        publishRealtime(Map.ofEntries(
                                Map.entry("_id", missionEventId), Map.entry("type", "mission"), Map.entry("platform", "chzzk"),
                                Map.entry("streamer_id", broadcast.channelId()), Map.entry("streamer_nickname", broadcast.channelName()),
                                Map.entry("user_id", userId), Map.entry("nickname", nickname),
                                Map.entry("mission_type", missionStatus), Map.entry("mission_phase", "receive"),
                                Map.entry("mission_key", missionKey), Map.entry("title", missionTitle),
                                Map.entry("cnt", 1), Map.entry("amount", amount),
                                Map.entry("createdAt", receivedAt.toString()),
                                Map.entry("ttl", receivedAt.plus(365, ChronoUnit.DAYS).toString()), Map.entry("__v", 0),
                                Map.entry("extras", missionExtras)));
                        continue;
                    }
                    String from = nickname + (userId.isBlank() ? "" : "(" + userId + ")");
                    String to = broadcast.channelName() + "(" + broadcast.channelId() + ")";
                    donationEvents.addFirst(new Donation(Instant.now(), "CHZZK", from, to,
                            Long.toString(amount), donationType));
                    while (donationEvents.size() > 100) donationEvents.pollLast();
                    donations.incrementAndGet();
                    Instant receivedAt = Instant.now();
                    String eventId = UUID.randomUUID().toString();
                    saveQueue.offer(new DonationRow(eventId, "chzzk",
                            broadcast.channelId(), text, userId, nickname,
                            (int) Math.min(amount, Integer.MAX_VALUE), amount,
                            json.writeValueAsString(Map.of("chzzk", extras)), receivedAt,
                            receivedAt.plus(365, ChronoUnit.DAYS)));
                    publishRealtime(Map.ofEntries(
                            Map.entry("_id", eventId), Map.entry("type", "donation"),
                            Map.entry("platform", "chzzk"), Map.entry("streamer_id", broadcast.channelId()),
                            Map.entry("streamer_nickname", broadcast.channelName()),
                            Map.entry("user_id", userId), Map.entry("nickname", nickname),
                            Map.entry("message", text), Map.entry("cnt", (int) Math.min(amount, Integer.MAX_VALUE)),
                            Map.entry("amount", amount), Map.entry("createdAt", receivedAt.toString()),
                            Map.entry("ttl", receivedAt.plus(365, ChronoUnit.DAYS).toString()), Map.entry("__v", 0),
                            Map.entry("extras", Map.of("chzzk", extras))));
                }
            } catch (Exception ignored) {
            }
        }

        private tools.jackson.databind.JsonNode parseEmbeddedJson(tools.jackson.databind.JsonNode node) {
            if (node.isObject()) return node;
            if (!node.isTextual() || node.asText().isBlank()) return json.createObjectNode();
            try { return json.readTree(node.asText()); }
            catch (Exception ignored) { return json.createObjectNode(); }
        }

        void ping() {
            if (socket != null && !socket.isOutputClosed())
                socket.sendText("{\"cmd\":0,\"ver\":\"2\"}", true);
        }

        void close() {
            intentionalClose = true;
            closed = true;
            if (socket != null) socket.sendClose(WebSocket.NORMAL_CLOSURE, "refresh");
        }
    }
}
