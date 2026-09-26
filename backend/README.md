# Notification Backend (Cloudflare Workers)

World App 푸시 알림용 백엔드입니다.
핵심 기능:
- Vault 감시 상태를 D1에 저장
- Cron(매 분)으로 claim 가능 여부 + vault WLD 잔액 체크
- 조건 만족 시 World notification API 호출

## Files

- `src/worker.mjs`: Worker API + cron 로직
- `migrations/0001_init.sql`: D1 스키마
- `wrangler.toml`: Worker/D1/Cron 설정

## One-time Setup

1. Cloudflare D1 생성

```bash
npx wrangler d1 create world-inheritance-notify
```

2. 생성된 `database_id`를 `wrangler.toml`의 `database_id`에 반영

3. 시크릿 설정

```bash
npx wrangler secret put WORLD_NOTIFY_API_KEY --config backend/wrangler.toml
npx wrangler secret put WORLD_APP_ID --config backend/wrangler.toml
```

4. 마이그레이션 적용

```bash
npm run notify:d1:remote
```

## Local Dev

```bash
npm run notify:d1:local
npm run notify:dev
```

기본 로컬 포트는 `8787`이며, 프론트 env는 다음처럼 연결합니다.

```bash
VITE_NOTIFY_BACKEND_URL=http://localhost:8787
```

## Deploy

```bash
npm run notify:d1:remote
npm run notify:deploy
```

배포 후 Worker URL(예: `https://world-inheritance-notify.<subdomain>.workers.dev`)을
`VITE_NOTIFY_BACKEND_URL`에 넣으면 프론트와 연결됩니다.

## API

- `GET /api/health`
- `GET /api/notifications`
- `GET /api/notifications/status?vaultAddress=0x...`
- `POST /api/notifications/register`
  - body: `{ "vaultAddress": "0x...", "ownerAddress": "0x...", "heirAddress": "0x..." }`
- `POST /api/notifications/unregister`
  - body: `{ "vaultAddress": "0x..." }`
- `POST /api/notifications/check-now`
- `POST /api/notifications/test`
  - body: `{ "walletAddress": "0x...", "vaultAddress": "0x..." }`
