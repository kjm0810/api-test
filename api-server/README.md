# Stream Event API

Express와 Socket.IO를 같은 포트에서 제공하는 SOOP/치지직 이벤트 API입니다.

## 실행

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

MySQL에서 먼저 `schema.sql`을 실행하세요.

## 주소

- REST: `http://5.104.82.219:3000/api/v1`
- Socket.IO: `http://5.104.82.219:3000` (`auth: { apiKey }`)
- 수집기 이벤트 입력: `POST /internal/events`

배포 시 Nginx 또는 Cloudflare에서 TLS를 적용하면 같은 주소가 HTTPS/WSS로 제공됩니다.
