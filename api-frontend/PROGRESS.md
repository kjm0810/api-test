# api-frontend 진행 상황

Next.js(App Router) 기반 API/WebSocket 콘솔. `:3001`에서 서비스.

## 개요

api-server를 사용하는 회원용 콘솔. 로그인, API 키 확인, 연결 스트리머 관리, API/소켓 사용법 문서를 제공한다. 원래 오버레이 설정 기능도 이 앱 안에 있었으나, 별도 프로젝트(overlay-frontend, `:3002`)로 완전히 분리했다.

## 주요 기능

- `AuthGate` — 로그인/회원가입 폼, `useAuth` 훅으로 accessToken(JWT)·apiKey를 localStorage에 저장
- 메인 페이지(`/`)
  - API 키 표시/복사
  - 연결 스트리머(`streamer_links`) 목록 조회/추가/삭제
  - `SocketGuide` — REST/소켓 사용법 문서(엔드포인트 표, 회원용 소켓 연결 예제 코드, 외부 개발자용 오버레이 소켓 예제 코드, curl 예시)

## 최근 변경

- 오버레이 관련 페이지(`/overlay`, `/overlay-setting` 및 그 하위) 전부 제거하고 overlay-frontend로 이전
- 헤더의 콘솔↔오버레이 이동 링크(Nav 컴포넌트) 제거 — 두 앱이 완전히 독립된 서비스로 분리됨에 따라 상호 이동 링크가 불필요해짐
- 그 결과 이 프로젝트는 로그인 세션도, API 키 관리도 overlay-frontend와 완전히 분리되어 있음 — **같은 계정(이메일/비밀번호)으로 로그인 가능하지만, 세션(localStorage)은 공유되지 않아 각 앱에서 따로 로그인해야 함**

## 알려진 제한

- 콘솔에 후원/채팅 실시간 피드 UI는 없음(문서에 예제 코드만 제공, 실제 UI는 없음) — 사용자가 직접 소켓 코드를 짜서 붙이는 걸 전제로 함
- `mission` 소켓 이벤트를 받는 기능 없음 (REST `/missions/polling`은 `SocketGuide` 문서에 이미 안내되어 있음)
