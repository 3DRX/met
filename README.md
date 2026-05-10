# Met

Anonymous 1v1 WebRTC video chat built with React and Cloudflare Workers. The React SPA is served as Worker static assets, `/api/*` routes run through the Worker, and a Durable Object coordinates room membership and WebRTC signaling.

## Local Setup

Install dependencies:

```bash
pnpm install
```

Create local Cloudflare TURN credentials:

```bash
cp .dev.vars.example .dev.vars
```

Then edit `.dev.vars` with a Cloudflare Realtime TURN key ID and API token.

Build static assets:

```bash
pnpm run build
```

Run the Worker locally:

```bash
pnpm exec wrangler -- dev --local --port 8787
```

Open `http://localhost:8787`.

## Production Secrets

Set the TURN secrets before deploying:

```bash
pnpm exec wrangler -- secret put TURN_KEY_ID
pnpm exec wrangler -- secret put TURN_KEY_API_TOKEN
```

Deploy:

```bash
pnpm run build
pnpm exec wrangler -- deploy
```

## Checks

```bash
pnpm test
pnpm exec tsc -- --noEmit
pnpm run build
```
