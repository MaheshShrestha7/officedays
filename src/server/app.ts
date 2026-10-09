import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { hashPassword, randomHex, sha256Hex, verifyPassword } from "./auth";
import { addDays, isValidDate, isValidTimezone, localDate, monthRange } from "./dates";
import { history, monthWeeks, weekdayCounts, type TargetRow } from "./history";
import { buildCalendar, type CalendarEvent } from "./ical";
import { checkDeskQr } from "./qr";
import { progress, type Target } from "./stats";
import { getVapidKeys } from "./vapid";

export interface Env {
  DB: D1Database;
  QR_HOST: string;
  QR_PATH: string;
  QR_SITEKEY?: string;
  SIGNUP_CODE?: string;
  /** Buy Me a Coffee username for the support link; the link is hidden when unset. */
  BUYMEACOFFEE?: string;
}

interface User {
  id: number;
  email: string;
  name: string;
  timezone: string;
  created_at: string;
  remind_day: number | null;
  remind_hour: number;
}

type App = { Bindings: Env; Variables: { user: User } };

const COOKIE = "od_session";
const SESSION_DAYS = 60;

export const app = new Hono<App>().basePath("/api");

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Something went wrong. Please try again." }, 500);
});

async function startSession(c: any, userId: number) {
  const token = randomHex(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await c.env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(token), userId, expires.toISOString())
    .run();
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    expires,
  });
}

function cleanEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

app.post("/signup", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = cleanEmail(body.email);
  const name = String(body.name ?? "").trim();
  const password = String(body.password ?? "");
  const timezone = isValidTimezone(String(body.timezone ?? "")) ? String(body.timezone) : "UTC";
  if (c.env.SIGNUP_CODE && body.code !== c.env.SIGNUP_CODE) {
    return c.json({ error: "That invite code is not right." }, 403);
  }
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || !name || password.length < 8) {
    return c.json({ error: "Enter your name, an email address and a password of at least 8 characters." }, 400);
  }
  const exists = await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
  if (exists) return c.json({ error: "An account with that email already exists. Sign in instead." }, 409);

  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  const user = await c.env.DB.prepare(
    "INSERT INTO users (email, name, password_hash, password_salt, timezone) VALUES (?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(email, name, hash, salt, timezone)
    .first<{ id: number }>();
  // Default target: 3 days a week, editable in settings.
  await c.env.DB.prepare(
    "INSERT INTO targets (user_id, period, days_required, week_days, effective_from) VALUES (?, 'week', 3, 3, '0000-01-01')",
  )
    .bind(user!.id)
    .run();
  await startSession(c, user!.id);
  return c.json({ ok: true });
});

app.post("/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const row = await c.env.DB.prepare("SELECT id, password_hash, password_salt FROM users WHERE email = ?")
    .bind(cleanEmail(body.email))
    .first<{ id: number; password_hash: string; password_salt: string }>();
  if (!row || !(await verifyPassword(String(body.password ?? ""), row.password_salt, row.password_hash))) {
    return c.json({ error: "Email or password is not right." }, 401);
  }
  await startSession(c, row.id);
  return c.json({ ok: true });
});

app.post("/logout", async (c) => {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

const KIND_LABEL: Record<string, string> = { leave: "Leave", holiday: "Public holiday", sick: "Sick" };

// Private calendar feed. Calendar apps can't sign in, so the secret token in the URL is the key.
app.get("/calendar/:file", async (c) => {
  const token = c.req.param("file").replace(/\.ics$/, "");
  if (!/^[0-9a-f]{40}$/.test(token)) return c.text("Not found", 404);
  const user = await c.env.DB.prepare("SELECT id, timezone FROM users WHERE calendar_token = ?")
    .bind(token)
    .first<{ id: number; timezone: string }>();
  if (!user) return c.text("Not found", 404);
  const from = addDays(localDate(user.timezone), -400);
  const [office, leave] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT c.local_date, c.desk_eui64, d.name FROM checkins c LEFT JOIN desk_names d ON d.eui64 = c.desk_eui64
       WHERE c.user_id = ? AND c.local_date >= ?`,
    ).bind(user.id, from),
    c.env.DB.prepare("SELECT date, kind FROM leave_days WHERE user_id = ? AND date >= ?").bind(user.id, from),
  ]);
  const events: CalendarEvent[] = [
    ...office.results.map((r: any) => ({
      date: r.local_date,
      uid: `office-${r.local_date}-${user.id}@officedays`,
      summary: r.name ? `Office · desk ${r.name}` : "Office",
    })),
    ...leave.results.map((r: any) => ({
      date: r.date,
      uid: `off-${r.date}-${user.id}@officedays`,
      summary: KIND_LABEL[r.kind] ?? "Day off",
    })),
  ];
  return new Response(buildCalendar("OfficeDays", events), {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=900" },
  });
});

// Everything below needs a signed-in user.
app.use("*", async (c, next) => {
  const token = getCookie(c, COOKIE);
  const user = token
    ? await c.env.DB.prepare(
        `SELECT u.id, u.email, u.name, u.timezone, u.created_at, u.remind_day, u.remind_hour FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
        .bind(await sha256Hex(token), new Date().toISOString())
        .first<User>()
    : null;
  if (!user) return c.json({ error: "Please sign in." }, 401);
  c.set("user", user);
  await next();
});

async function currentTarget(db: D1Database, userId: number, date: string): Promise<Target | null> {
  return db
    .prepare(
      `SELECT week_days, month_days, workdays FROM targets WHERE user_id = ? AND effective_from <= ?
       ORDER BY effective_from DESC, id DESC LIMIT 1`,
    )
    .bind(userId, date)
    .first<Target>();
}

function coffeeUrl(username: string | undefined): string | null {
  const name = username?.trim();
  return name && /^[A-Za-z0-9_-]{1,64}$/.test(name) ? `https://buymeacoffee.com/${name}` : null;
}

async function summary(c: any) {
  const user: User = c.get("user");
  const today = localDate(user.timezone);
  // A week can start in the previous month, so look back 7 days before the month starts.
  const from = addDays(monthRange(today).start, -7);
  const [rows, leave] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT local_date FROM checkins WHERE user_id = ? AND local_date >= ?").bind(user.id, from),
    c.env.DB.prepare("SELECT date FROM leave_days WHERE user_id = ? AND date >= ?").bind(user.id, from),
  ]);
  const dates = rows.results.map((r: { local_date: string }) => r.local_date);
  const leaveDates = leave.results.map((r: { date: string }) => r.date);
  const target = await currentTarget(c.env.DB, user.id, today);
  const push: { n: number } | null = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?",
  )
    .bind(user.id)
    .first();
  return {
    user: { name: user.name, email: user.email, timezone: user.timezone, remind_day: user.remind_day, remind_hour: user.remind_hour },
    target,
    pushDevices: push?.n ?? 0,
    coffee: coffeeUrl(c.env.BUYMEACOFFEE),
    progress: progress(today, dates, target, leaveDates),
  };
}

app.get("/me", async (c) => c.json(await summary(c)));

app.post("/checkin", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const result = checkDeskQr(String(body.qr ?? ""), {
    host: c.env.QR_HOST,
    path: c.env.QR_PATH,
    sitekey: c.env.QR_SITEKEY || undefined,
  });
  if (!result.ok) return c.json({ error: result.reason }, 422);

  const today = localDate(user.timezone);
  const country = (c.req.raw as any).cf?.country ?? null;
  const inserted = await c.env.DB.prepare(
    `INSERT INTO checkins (user_id, local_date, desk_eui64, ip_country) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, local_date) DO NOTHING RETURNING id`,
  )
    .bind(user.id, today, result.desk, country)
    .first();
  const named = await c.env.DB.prepare("SELECT name FROM desk_names WHERE eui64 = ?").bind(result.desk).first<{ name: string }>();
  return c.json({ ...(await summary(c)), desk: result.desk, deskName: named?.name ?? null, alreadyCheckedIn: !inserted });
});

app.get("/checkins", async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB.prepare(
    "SELECT local_date, desk_eui64, scanned_at, status FROM checkins WHERE user_id = ? ORDER BY local_date DESC LIMIT 400",
  )
    .bind(user.id)
    .all();
  return c.json({ checkins: rows.results });
});

app.delete("/checkins/:date", async (c) => {
  const user = c.get("user");
  await c.env.DB.prepare("DELETE FROM checkins WHERE user_id = ? AND local_date = ?")
    .bind(user.id, c.req.param("date"))
    .run();
  return c.json(await summary(c));
});

app.put("/settings", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  // Days per week and per month, each a number or null for none. Older clients send one period.
  let weekDays = body.week_days;
  let monthDays = body.month_days;
  if (weekDays === undefined && monthDays === undefined) {
    weekDays = body.period === "month" ? null : body.days_required;
    monthDays = body.period === "month" ? body.days_required : null;
  }
  weekDays = weekDays === null ? null : Number(weekDays);
  monthDays = monthDays === null ? null : Number(monthDays);
  if (weekDays !== null && !(Number.isInteger(weekDays) && weekDays >= 0 && weekDays <= 7)) {
    return c.json({ error: "Days a week must be a whole number from 0 to 7." }, 400);
  }
  if (monthDays !== null && !(Number.isInteger(monthDays) && monthDays >= 0 && monthDays <= 31)) {
    return c.json({ error: "Days a month must be a whole number from 0 to 31." }, 400);
  }
  if (weekDays === null && monthDays === null) return c.json({ error: "Set a weekly or a monthly target." }, 400);
  const workdays = [...new Set(String(body.workdays ?? "12345").split(""))].filter((d) => /^[1-7]$/.test(d)).sort().join("");
  if (!workdays) return c.json({ error: "Pick at least one workday." }, 400);
  const timezone = isValidTimezone(String(body.timezone ?? "")) ? String(body.timezone) : user.timezone;
  const name = String(body.name ?? "").trim() || user.name;
  // Reminder: day 1-7 or null for off, hour 0-23. Left as they are when not sent.
  const remindDay =
    body.remind_day === undefined ? user.remind_day : body.remind_day === null ? null : Number(body.remind_day);
  const remindHour = body.remind_hour === undefined ? user.remind_hour : Number(body.remind_hour);
  if ((remindDay !== null && !(Number.isInteger(remindDay) && remindDay >= 1 && remindDay <= 7)) ||
      !(Number.isInteger(remindHour) && remindHour >= 0 && remindHour <= 23)) {
    return c.json({ error: "Pick a valid reminder day and time." }, 400);
  }
  await c.env.DB.prepare("UPDATE users SET name = ?, timezone = ?, remind_day = ?, remind_hour = ? WHERE id = ?")
    .bind(name, timezone, remindDay, remindHour, user.id)
    .run();
  c.set("user", { ...user, name, timezone, remind_day: remindDay, remind_hour: remindHour });

  const today = localDate(timezone);
  const current = await currentTarget(c.env.DB, user.id, today);
  if (!current || current.week_days !== weekDays || current.month_days !== monthDays || current.workdays !== workdays) {
    // period and days_required are legacy columns that can't be null; week_days and month_days are what count.
    await c.env.DB.prepare(
      `INSERT INTO targets (user_id, period, days_required, week_days, month_days, workdays, effective_from)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(user.id, weekDays !== null ? "week" : "month", weekDays ?? monthDays, weekDays, monthDays, workdays, today)
      .run();
  }
  return c.json(await summary(c));
});

// Office days and days off in a date range, for the calendar.
app.get("/days", async (c) => {
  const user = c.get("user");
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  if (!isValidDate(from) || !isValidDate(to)) return c.json({ error: "Pick a valid date range." }, 400);
  const month = monthRange(from);
  const [checkins, leave, monthCheckins, monthLeave, targets] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT c.local_date, c.desk_eui64, d.name AS desk_name, c.status FROM checkins c
       LEFT JOIN desk_names d ON d.eui64 = c.desk_eui64
       WHERE c.user_id = ? AND c.local_date BETWEEN ? AND ? ORDER BY c.local_date`,
    ).bind(user.id, from, to),
    c.env.DB.prepare("SELECT date, kind FROM leave_days WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date").bind(
      user.id,
      from,
      to,
    ),
    c.env.DB.prepare("SELECT local_date FROM checkins WHERE user_id = ? AND local_date BETWEEN ? AND ?").bind(
      user.id,
      month.start,
      month.end,
    ),
    c.env.DB.prepare("SELECT date FROM leave_days WHERE user_id = ? AND date BETWEEN ? AND ?").bind(user.id, month.start, month.end),
    c.env.DB.prepare(
      "SELECT week_days, month_days, workdays, effective_from FROM targets WHERE user_id = ? ORDER BY effective_from, id",
    ).bind(user.id),
  ]);
  // Each week of the month that `from` falls in, scored on that month's days only.
  const weeks = monthWeeks(
    from,
    localDate(user.timezone),
    monthCheckins.results.map((r: any) => r.local_date),
    monthLeave.results.map((r: any) => r.date),
    targets.results as unknown as TargetRow[],
  );
  return c.json({ checkins: checkins.results, leave: leave.results, weeks });
});

const DAY_TYPES = ["office", "leave", "holiday", "sick", "none"] as const;

// Mark a day by hand: a missed office day, a day off, or clear it.
app.put("/days/:date", async (c) => {
  const user = c.get("user");
  const date = c.req.param("date");
  const body = await c.req.json().catch(() => ({}));
  const type = DAY_TYPES.find((t) => t === body.type);
  const today = localDate(user.timezone);
  if (!isValidDate(date) || !type) return c.json({ error: "Pick a valid day and type." }, 400);
  if (date < addDays(today, -366) || date > addDays(today, 366)) {
    return c.json({ error: "Pick a day within a year of today." }, 400);
  }
  if (type === "office" && date > today) {
    return c.json({ error: "Office days can't be in the future." }, 400);
  }

  const db = c.env.DB;
  const clearCheckin = db.prepare("DELETE FROM checkins WHERE user_id = ? AND local_date = ?").bind(user.id, date);
  const clearLeave = db.prepare("DELETE FROM leave_days WHERE user_id = ? AND date = ?").bind(user.id, date);
  if (type === "none") {
    await db.batch([clearCheckin, clearLeave]);
  } else if (type === "office") {
    // Keeps an existing scanned check-in as it is.
    await db.batch([
      clearLeave,
      db.prepare(
        `INSERT INTO checkins (user_id, local_date, status) VALUES (?, ?, 'manual')
         ON CONFLICT (user_id, local_date) DO NOTHING`,
      ).bind(user.id, date),
    ]);
  } else {
    await db.batch([
      clearCheckin,
      db.prepare(
        `INSERT INTO leave_days (user_id, date, kind) VALUES (?, ?, ?)
         ON CONFLICT (user_id, date) DO UPDATE SET kind = excluded.kind`,
      ).bind(user.id, date, type),
    ]);
  }
  return c.json(await summary(c));
});

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

app.get("/export.csv", async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB.prepare(
    `SELECT local_date AS date, 'office' AS type, status, desk_eui64 AS desk, scanned_at FROM checkins WHERE user_id = ?
     UNION ALL
     SELECT date, kind, NULL, NULL, NULL FROM leave_days WHERE user_id = ?
     ORDER BY date`,
  )
    .bind(user.id, user.id)
    .all();
  const header = ["date", "type", "status", "desk", "scanned_at_utc"];
  const lines = rows.results.map((r: Record<string, unknown>) =>
    [r.date, r.type, r.status, r.desk, r.scanned_at].map(csvCell).join(","),
  );
  return new Response([header.join(","), ...lines].join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="officedays-${localDate(user.timezone)}.csv"`,
    },
  });
});

/* ---------- Stats ---------- */

app.get("/stats", async (c) => {
  const user = c.get("user");
  const today = localDate(user.timezone);
  const since = localDate(user.timezone, new Date(`${user.created_at.replace(" ", "T")}Z`));
  const from = addDays(today, -400);
  const [checkins, leave, targets, desks] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT local_date FROM checkins WHERE user_id = ? AND local_date >= ?").bind(user.id, from),
    c.env.DB.prepare("SELECT date FROM leave_days WHERE user_id = ? AND date >= ?").bind(user.id, from),
    c.env.DB.prepare(
      "SELECT week_days, month_days, workdays, effective_from FROM targets WHERE user_id = ? ORDER BY effective_from, id",
    ).bind(user.id),
    c.env.DB.prepare(
      `SELECT c.desk_eui64 AS eui64, d.name, COUNT(*) AS days, MAX(c.local_date) AS last
       FROM checkins c LEFT JOIN desk_names d ON d.eui64 = c.desk_eui64
       WHERE c.user_id = ? AND c.desk_eui64 IS NOT NULL
       GROUP BY c.desk_eui64 ORDER BY days DESC, last DESC LIMIT 5`,
    ).bind(user.id),
  ]);
  // Days added by hand can predate the account; start from whichever is earlier.
  const earliest = [since, ...checkins.results.map((r: any) => r.local_date)].sort()[0];
  const h = history(
    today,
    earliest,
    checkins.results.map((r: any) => r.local_date),
    leave.results.map((r: any) => r.date),
    targets.results as unknown as TargetRow[],
  );
  return c.json({ ...h, weekdays: weekdayCounts(checkins.results.map((r: any) => r.local_date)), topDesks: desks.results });
});

/* ---------- Desk names ---------- */

app.put("/desks/:eui64", async (c) => {
  const user = c.get("user");
  const eui64 = c.req.param("eui64").toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 40);
  if (!/^[0-9a-f]{16}$/.test(eui64)) return c.json({ error: "Unknown desk." }, 400);
  if (!name) {
    await c.env.DB.prepare("DELETE FROM desk_names WHERE eui64 = ?").bind(eui64).run();
    return c.json({ eui64, name: null });
  }
  // Only desks someone has actually scanned can be named.
  const seen = await c.env.DB.prepare("SELECT 1 FROM checkins WHERE desk_eui64 = ? LIMIT 1").bind(eui64).first();
  if (!seen) return c.json({ error: "Scan this desk before naming it." }, 404);
  await c.env.DB.prepare(
    `INSERT INTO desk_names (eui64, name, named_by) VALUES (?, ?, ?)
     ON CONFLICT (eui64) DO UPDATE SET name = excluded.name, named_by = excluded.named_by, updated_at = datetime('now')`,
  )
    .bind(eui64, name, user.id)
    .run();
  return c.json({ eui64, name });
});

/* ---------- Push reminders ---------- */

app.get("/push/key", async (c) => c.json({ publicKey: (await getVapidKeys(c.env.DB)).publicKey }));

app.post("/push/subscribe", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const endpoint = String(body.endpoint ?? "");
  const p256dh = String(body.keys?.p256dh ?? "");
  const auth = String(body.keys?.auth ?? "");
  if (!endpoint.startsWith("https://") || !p256dh || !auth) return c.json({ error: "That push subscription is not valid." }, 400);
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  )
    .bind(endpoint, user.id, p256dh, auth)
    .run();
  return c.json(await summary(c));
});

app.post("/push/unsubscribe", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?")
    .bind(user.id, String(body.endpoint ?? ""))
    .run();
  return c.json(await summary(c));
});

/* ---------- Calendar sync ---------- */

app.get("/calendar-link", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT calendar_token FROM users WHERE id = ?").bind(user.id).first<{ calendar_token: string | null }>();
  return c.json({ token: row?.calendar_token ?? null });
});

// Creates the link, or replaces it so the old one stops working.
app.post("/calendar-link", async (c) => {
  const user = c.get("user");
  const token = randomHex(20);
  await c.env.DB.prepare("UPDATE users SET calendar_token = ? WHERE id = ?").bind(token, user.id).run();
  return c.json({ token });
});
