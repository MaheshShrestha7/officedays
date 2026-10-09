# OfficeDays

Track your office days by scanning the QR code on any office desk. Each person signs in, scans once a day, and sees progress against their own weekly or monthly target.

Runs on Cloudflare's free tier: **Pages** serves the app, a **Pages Function** (Hono) is the API, **D1** stores the data.

## How a scan is recognised

The desk QR codes decode to a link of a fixed shape:

```
https://virtual.floorsen.se/scan-code?eui64=<16 hex desk id>&sitekey=<office site key>
```

Only the desk id changes between desks, so the API accepts a scan when the host, path and site key match and the desk id is 16 hex characters (`src/server/qr.ts`). One check-in per person per day; scanning again the same day does nothing.

## Features

- Scan any office desk QR to log the day.
- Your own target: N days per week or per month, on the weekdays you pick.
- Month calendar: tap a day to add a missed office day, or mark leave, a public holiday or a sick day. Days off on a workday lower that week's or month's target.
- Export all your days as CSV from Settings.
- Installable app (PWA): an Install button in Settings on Android and desktop Chrome; on iPhone use Share → Add to Home Screen.
- "Scan desk" shortcut: long-press the installed app icon to open the scanner directly.
- Desk names: name a desk (e.g. 24.002) the first time you scan it; names are shared by everyone.
- Stats: weeks or months in a row on target, hit rate, office days per month, your most used desks.
- Reminders: a push notification on your chosen day and hour when you're behind your target. Sent by `.github/workflows/reminders.yml`, which runs hourly with the same Cloudflare secrets as the deploy. iPhone needs the app installed to the home screen (iOS 16.4+). GitHub pauses scheduled workflows after 60 days without commits; re-enable it from the Actions tab if that happens.
- Calendar sync: a private iCal link (Settings → Calendar sync) for Google, Outlook or Apple Calendar.

## Deploy from your phone (GitHub Actions)

Every push to `main` deploys automatically through `.github/workflows/deploy.yml`. The first run creates the D1 database, its tables and the Pages project for you. One-time setup, all doable in a phone browser:

1. **Cloudflare API token.** In the Cloudflare dashboard go to My Profile → API Tokens → Create Token → Create Custom Token. Add two permissions: *Account · Cloudflare Pages · Edit* and *Account · D1 · Edit*. Create it and copy the token.
2. **Account ID.** In the Cloudflare dashboard, open Workers & Pages; the Account ID is on the right side of the overview (or in the account menu → Copy account ID).
3. **GitHub secrets.** In this repo go to Settings → Secrets and variables → Actions → New repository secret, and add:
   - `CLOUDFLARE_API_TOKEN`: the token from step 1
   - `CLOUDFLARE_ACCOUNT_ID`: the ID from step 2
   - `SIGNUP_CODE`: an invite code people must type to create an account
   - `QR_SITEKEY`: the `sitekey=` value at the end of your desk QR link (optional; without it any Floorsense site is accepted)
4. **Run it.** Actions tab → Deploy to Cloudflare → Run workflow. When it finishes, the run summary shows the address, normally `https://officedays.pages.dev`.

**Buy me a coffee link (optional).** Put your Buy Me a Coffee username in `BUYMEACOFFEE` in `wrangler.toml` (it's public, not a secret). Settings then shows a "Buy me a coffee" link; leave it empty to hide it.

## Deploy from a laptop instead

```sh
npm install
npx wrangler login
npx wrangler d1 create officedays          # paste the printed database_id into wrangler.toml
npm run db:migrate:remote
npx wrangler pages project create officedays --production-branch main
npx wrangler pages secret put SIGNUP_CODE
npx wrangler pages secret put QR_SITEKEY
npm run deploy
```

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
