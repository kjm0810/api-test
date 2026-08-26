# api-server 진행 상황

Node.js/Express + Socket.IO 기반 API·실시간 중계 서버.

## 개요

collect-socket이 Redis(`collector.events`)로 발행한 이벤트를 구독해서, 회원별 API 키/JWT 인증을 거쳐 REST 폴링과 Socket.IO 실시간 전송 두 가지 방식으로 제공한다. 오버레이(OBS 위젯) 전용 인증/데이터도 이 서버가 담당한다.

## 주요 기능

### 인증
- 회원가입 시 JWT 발급 + API 키(`sk_live_...`) 발급, `api_keys` 테이블에 해시로 저장
- `auth` 미들웨어: `Authorization: Bearer <JWT 또는 API Key>` 또는 `x-api-key` 헤더 순서로 검증 — SSAPI처럼 API 키를 Bearer로도 쓸 수 있게 맞춤

### REST API
- `POST /auth/signup`, `/auth/login`
- `GET /api/v1/me`, `/api/v1/api-keys`
- `GET/POST/DELETE /api/v1/streamers` — 계정 ↔ 스트리머 연결(소켓 실시간 수신 대상)
- `GET/PATCH /api/v1/overlay/widgets` — 오버레이 위젯 3종(donation/chat/game) 설정 조회/저장, 토큰 없으면 자동 생성
- `GET/POST/DELETE /api/v1/overlay/streamers` — 오버레이 전용 연결 스트리머(계정 공용, `streamer_links`와 별개)
- `GET /overlay/:token` — 로그인 없이 위젯 토큰만으로 설정/스트리머 조회 (OBS 페이지 초기 로드용)
- `GET /donations/polling` — 계정 등록 여부 무관하게 전체 후원 데이터 커서 기반 조회. SSAPI와 동일한 요청/응답 형식
- `GET /missions/polling` — 후원과 동일한 방식의 미션 이벤트 조회(cursor/limit/platform/streamer_id/phase/mission_type/key 필터)
- `POST /internal/events` — 내부 시크릿으로 이벤트 강제 발행(테스트/백필용)
- `POST /admin/users/:userId/api-keys` — 관리자 시크릿으로 API 키 재발급

### Socket.IO
- 기본 네임스페이스(`/`): `login` 이벤트로 API 키 인증 후 연결된 스트리머 room에 join, `chat`/`donation`/`mission` 이벤트 수신 (Snappy로 압축된 payload)
- `/overlay` 네임스페이스:
  - `subscribe`: 고정 시크릿 + `{platform,id}[]` 배열로 인증 — 외부 개발자가 자체 오버레이 프로그램을 만들 때 쓰는 경로 (기존 유지)
  - `join`: 위젯 토큰 하나로 인증 — 자체 OBS 렌더 페이지가 쓰는 경로. 인증 성공 시 해당 계정의 오버레이 전용 스트리머 room에 join, 위젯 설정도 같이 내려줌
- Redis 구독(`collector.events`) → zod(`eventSchema`, discriminated union: chat/donation/mission)으로 검증 후 `io`/`overlayNs` 양쪽에 emit

## DB 스키마 (api-server/schema.sql)

- `users`, `api_keys`
- `streamer_links` — 계정 ↔ 스트리머(실시간 수신 대상)
- `overlay_widgets` — 계정당 고정 3행(donation/chat/game), `token`(OBS URL용) + `settings`(JSON)
- `overlay_streamers` — 오버레이 전용 연결 스트리머(계정 공용)

(donations/missions 테이블은 collect-socket 쪽 schema.sql에 있음, 같은 DB 공유)

## 다음 작업 후보

- `mission` 소켓 이벤트를 소비하는 콘솔/오버레이 UI 추가
- 유튜브/투네이션 연동 시 회원별 API 키/채널 등록 구조 설계
