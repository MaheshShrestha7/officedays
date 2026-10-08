import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { hashPassword, randomHex, sha256Hex, verifyPassword } from "./auth";
import { addDays, isValidDate, isValidTimezone, localDate, monthRange } from "./dates";
import { checkDeskQr } from "./qr";
import { progress, type Target } from "./stats";

export interface Env {
  DB: D1Database;
  QR_HOST: string;
  QR_PATH: string;
  QR_SITEKEY?: string;
  SIGNUP_CODE?: string;
}

interface User {
  id: number;
  email: string;
  name: string;
  timezone: string;
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
  await c.env.DB.prepare("INSERT INTO targets (user_id, period, days_required, effective_from) VALUES (?, 'week', 3, '0000-01-01')")
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

// Everything below needs a signed-in user.
app.use("*", async (c, next) => {
  const token = getCookie(c, COOKIE);
  const user = token
    ? await c.env.DB.prepare(
        `SELECT u.id, u.email, u.name, u.timezone FROM sessions s JOIN users u ON u.id = s.user_id
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
      `SELECT period, days_required, workdays FROM targets WHERE user_id = ? AND effective_from <= ?
       ORDER BY effective_from DESC, id DESC LIMIT 1`,
    )
    .bind(userId, date)
    .first<Target>();
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
  return { user, target, progress: progress(today, dates, target, leaveDates) };
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
  return c.json({ ...(await summary(c)), desk: result.desk, alreadyCheckedIn: !inserted });
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
  const period = body.period === "month" ? "month" : "week";
  const days = Number(body.days_required);
  const max = period === "week" ? 7 : 31;
  if (!Number.isInteger(days) || days < 0 || days > max) {
    return c.json({ error: `Days must be a whole number from 0 to ${max}.` }, 400);
  }
  const workdays = [...new Set(String(body.workdays ?? "12345").split(""))].filter((d) => /^[1-7]$/.test(d)).sort().join("");
  if (!workdays) return c.json({ error: "Pick at least one workday." }, 400);
  const timezone = isValidTimezone(String(body.timezone ?? "")) ? String(body.timezone) : user.timezone;
  const name = String(body.name ?? "").trim() || user.name;
  await c.env.DB.prepare("UPDATE users SET name = ?, timezone = ? WHERE id = ?").bind(name, timezone, user.id).run();
  c.set("user", { ...user, name, timezone });

  const today = localDate(timezone);
  const current = await currentTarget(c.env.DB, user.id, today);
  if (!current || current.period !== period || current.days_required !== days || current.workdays !== workdays) {
    await c.env.DB.prepare(
      "INSERT INTO targets (user_id, period, days_required, workdays, effective_from) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(user.id, period, days, workdays, today)
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
  const [checkins, leave] = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT local_date, desk_eui64, status FROM checkins WHERE user_id = ? AND local_date BETWEEN ? AND ? ORDER BY local_date",
    ).bind(user.id, from, to),
    c.env.DB.prepare("SELECT date, kind FROM leave_days WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date").bind(
      user.id,
      from,
      to,
    ),
  ]);
  return c.json({ checkins: checkins.results, leave: leave.results });
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
