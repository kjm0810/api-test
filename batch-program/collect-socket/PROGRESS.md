# collect-socket 진행 상황

Spring Boot 4.1.0(Java 17) 기반 SOOP·치지직 실시간 데이터 수집기.

## 개요

SOOP·치지직의 공개 방송 목록을 주기적으로 조회하고, 각 방송에 raw WebSocket으로 직접 접속해서 채팅/후원/미션 이벤트를 파싱한다. 파싱된 이벤트는 MySQL에 저장되고, 동시에 Redis(`collector.events` 채널)로 실시간 발행되어 api-server가 구독한다.

## 주요 기능

### 방송 수집
- SOOP: `main_broad_list_api.php`를 페이지네이션으로 전체 순회, 조회수 내림차순 정렬
  - 필터링: 비밀번호 방송(`is_password`), 19세 등급(`broad_grade=19`) 제외
- 치지직: `/service/v1/lives`를 커서 기반으로 전체 순회, 성인/시청 정책 제한 방송 제외
- 60초 주기로 목록 갱신, 5초 주기로 미연결 방송 재시도
- SOOP/치지직 각각 별도 스레드풀(`soopConnectors`/`chzzkConnectors`)로 연결 처리 — 이전엔 하나를 공유해서 치지직의 200ms 스로틀이 SOOP 연결을 굶기는 문제가 있었음(수정 완료, 현재 치지직 스로틀 100ms)

### 이벤트 파싱
- **SOOP**: `STARTER(ESC+TAB) + 타입4자리 + 길이6자리 + "00" + SEP(\f)구분필드` 프로토콜
  - 후원: `0018`(별풍선), `0105`(영상풍선), `0087`(애드벌룬)
  - 채팅: `0005`
  - 미션: `0121` — JSON 바디, 최상위에 `type`/`key`/`gift_count`/`user_id`/`user_nick`/`title` 필드 (message 래퍼 없음)
- **치지직**: JSON envelope(`cmd`/`bdy`), 후원은 `extras.donationType`으로 판별. 미션은 `donationType`이 `MISSION`(개설)/`MISSION_PARTICIPATION`(참여)일 때 별도 분기

### 미션(도전미션/저금통) 수집
- SOOP `mission_type`: `GIFT`(일반), `CHALLENGE_GIFT`(도전미션) 확인됨. `SETTLE`/`FINISH`, `BATTLE_*` 계열은 실제 샘플 미확인 — 추정치로 매핑해둔 상태
- 치지직 `mission_type`: `extras.status`(`PENDING`/`APPROVED`) 저장, `cnt`는 항상 1
- `mission_key`: SOOP은 raw JSON의 `key` 필드, 치지직은 `missionDonationId`(개설)/`relatedMissionDonationId`(참여) — 같은 미션에 속한 여러 후원을 묶는 식별자
- `missions` 테이블에 저장 + `publishRealtime()`으로 Redis 발행(donation/chat과 동일 경로)

### 관리자 API (`AdminController`, 인증 없음, `:8080`)
- `GET /api/admin/status` — 연결 현황 요약
- `GET /api/admin/broadcasts`, `/chzzk/broadcasts` — 현재 방송 목록
- `GET /api/admin/donations` — 최근 후원 이벤트(메모리 버퍼)
- `GET /api/admin/connection-failures` — 연결 실패 로그
- `GET /api/admin/events` — SSE 스트림
- `admin.html` 대시보드 (배포 시 초기화됨, 영구 저장 아님)

## 알려진 이슈 / 미해결

- **SOOP 미션이 실제로 전혀 수집되지 않는 중** — 진단 로그(`SOOP TRACE`, `SOOP 미션(0121) 알 수 없는 type` 등)를 여러 채널에 걸어봤지만 패킷 자체가 안 잡힘. 테스트한 채널들이 전부 시점상 오프라인이었거나 오래된(한 달 전) SSAPI 참조 데이터였던 것으로 밝혀져, 아직 "진짜 라이브 중인 SOOP 미션 채널"로 재현 테스트를 못 함. 다음 후보 가설:
  1. 저희 로그인 핸드셰이크(`packet("0001", ...)`)가 실제 브라우저와 달라서 미션 이벤트 수신 권한이 없을 가능성
  2. 미션이 자주 열리는 스트리머가 구독 전용/19금 방송이라 애초에 연결 대상에서 제외됐을 가능성
  - 임시로 `MISSION_TRACE_STREAMERS`(특정 채널 전체 패킷 타입 로깅)가 `SoopService.java`에 남아있음 — 조사 끝나면 제거 필요
- 19세 인증 방송: 인증에 어떤 정보(SOOP 계정 쿠키/토큰 등)를 써야 하는지 미정
- 유튜브/투네이션: 공식 API는 있으나 지금처럼 "전수 스캔" 방식이 아니라 사용자가 직접 연동(API키/채널 등록)하는 구조로 가야 함 — 별도 설계 필요

## 다음 작업 후보

- SOOP 미션 미수집 원인 확정 (라이브 채널로 재현)
- SETTLE/FINISH 등 미확인 mission_type 실측 데이터로 보완
- 19세 인증 방송 수집 대응
- 유튜브/투네이션 연동 구조 설계
