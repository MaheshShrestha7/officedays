# OfficeDays

Track your office days by scanning the QR code on any office desk. Each person signs in, scans once a day, and sees progress against their own weekly or monthly target.

Runs on Cloudflare's free tier: **Pages** serves the app, a **Pages Function** (Hono) is the API, **D1** stores the data.

## How a scan is recognised

The desk QR codes decode to a link of a fixed shape:

```
https://virtual.floorsen.se/scan-code?eui64=<16 hex desk id>&sitekey=<office site key>
```

Only the desk id changes between desks, so the API accepts a scan when the host, path and site key match and the desk id is 16 hex characters (`src/server/qr.ts`). One check-in per person per day; scanning again the same day does nothing.

## Deploy (one time, about 10 minutes)

You need a free Cloudflare account and Node 20+.

```sh
npm install
npx wrangler login

# 1. Create the database and paste the printed database_id into wrangler.toml
npx wrangler d1 create officedays

# 2. Create the tables
npm run db:migrate:remote

# 3. Create the Pages project (gives you https://officedays.pages.dev or similar)
npx wrangler pages project create officedays --production-branch main

# 4. Secrets
#    SIGNUP_CODE: an invite code people must type to create an account (share it with colleagues)
#    QR_SITEKEY:  the sitekey value from your desk QR link (optional; without it any Floorsense site key is accepted)
npx wrangler pages secret put SIGNUP_CODE
npx wrangler pages secret put QR_SITEKEY

# 5. Deploy
npm run deploy
```

Run `npm run deploy` again after any change. To deploy automatically on every push instead, connect the GitHub repo in the Cloudflare dashboard (Workers & Pages → officedays → Settings → Builds) with build command `npm run build` and output directory `dist`.

## Local development

```sh
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev          # http://localhost:8788
npm test
npm run typecheck
```

The camera needs HTTPS or localhost. To try scanning from your phone, deploy first and open the pages.dev address.

## Layout

| Path | What it is |
| --- | --- |
| `web/` | Front end (Vite, plain TypeScript): sign in, dashboard, scanner, settings |
| `functions/api/[[route]].ts` | Pages Function that mounts the API |
| `src/server/` | API routes, QR check, date and progress maths, password hashing |
| `migrations/` | D1 schema |
| `tests/` | Unit tests for QR recognition and progress counting |
