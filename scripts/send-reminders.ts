// Sends behind-target push reminders. Run hourly by .github/workflows/reminders.yml.
// Reads and writes D1 through the Cloudflare API with the same token the deploy uses.
import webpush from "web-push";
import { isDue, lookbackStart, planReminder, type ReminderUser } from "../src/server/reminders";
import type { Target } from "../src/server/stats";

const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
const DB_NAME = process.env.DB_NAME ?? "officedays";
const APP_URL = process.env.APP_URL ?? "https://officedays.pages.dev";
if (!token || !account) throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required.");

const base = process.env.CF_API_BASE ?? "https://api.cloudflare.com/client/v4"; // overridable for tests
const api = `${base}/accounts/${account}/d1/database`;

async function cf<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  const body: any = await res.json();
  if (!body.success) throw new Error(`Cloudflare API error: ${JSON.stringify(body.errors)}`);
  return body.result;
}

const databases = await cf<{ uuid: string; name: string }[]>(`${api}?name=${DB_NAME}`);
const dbId = databases.find((d) => d.name === DB_NAME)?.uuid;
if (!dbId) throw new Error(`D1 database ${DB_NAME} not found.`);

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await cf<{ results: T[] }[]>(`${api}/${dbId}/query`, {
    method: "POST",
    body: JSON.stringify({ sql, params }),
  });
  return result[0].results;
}

const vapid = (await query<{ value: string }>("SELECT value FROM app_config WHERE key = 'vapid'"))[0];
if (!vapid) {
  console.log("No push keys yet, so nobody has turned on reminders.");
  process.exit(0);
}
const keys = JSON.parse(vapid.value);
webpush.setVapidDetails(APP_URL, keys.publicKey, keys.privateKey);

const now = new Date();
const users = await query<ReminderUser>(
  `SELECT id, timezone, remind_day, remind_hour, reminded_for FROM users
   WHERE remind_day IS NOT NULL AND id IN (SELECT user_id FROM push_subscriptions)`,
);
const due = users.filter((u) => isDue(u, now));
console.log(`${users.length} user(s) with reminders on, ${due.length} due now.`);

for (const user of due) {
  const from = lookbackStart(user.timezone, now);
  const checkins = await query<{ local_date: string }>(
    "SELECT local_date FROM checkins WHERE user_id = ? AND local_date >= ?",
    [user.id, from],
  );
  const leave = await query<{ date: string }>("SELECT date FROM leave_days WHERE user_id = ? AND date >= ?", [user.id, from]);
  const [target] = await query<Target>(
    `SELECT week_days, month_days, workdays FROM targets WHERE user_id = ?
     ORDER BY effective_from DESC, id DESC LIMIT 1`,
    [user.id],
  );
  const plan = planReminder(
    user,
    now,
    checkins.map((r) => r.local_date),
    leave.map((r) => r.date),
    target ?? null,
  );

  if (plan.message) {
    const subs = await query<{ endpoint: string; p256dh: string; auth: string }>(
      "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
      [user.id],
    );
    const payload = JSON.stringify({ title: "OfficeDays", body: plan.message, url: "/" });
    for (const sub of subs) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
          TTL: 6 * 3600,
        });
      } catch (err: any) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // The device unsubscribed or the app was removed.
          await query("DELETE FROM push_subscriptions WHERE endpoint = ?", [sub.endpoint]);
        } else {
          console.error(`Push to user ${user.id} failed: ${err.statusCode ?? ""} ${err.message}`);
        }
      }
    }
  }
  await query("UPDATE users SET reminded_for = ? WHERE id = ?", [plan.weekStart, user.id]);
  console.log(`User ${user.id}: ${plan.message ?? "on track, no reminder"}`);
}
