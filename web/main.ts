interface PeriodProgress { start: string; end: string; days: number; daysOff: number; required: number | null }
interface Summary {
  user: { name: string; email: string; timezone: string; remind_day: number | null; remind_hour: number };
  pushDevices: number;
  target: { week_days: number | null; month_days: number | null; workdays: string } | null;
  /** Buy Me a Coffee link, or null when none is set up. */
  coffee: string | null;
  progress: { today: string; checkedInToday: boolean; week: PeriodProgress; month: PeriodProgress };
}
interface Checkin { local_date: string; desk_eui64: string | null; desk_name?: string | null; status: string }
interface Leave { date: string; kind: "leave" | "holiday" | "sick" }

const app = document.getElementById("app")!;
let state: Summary | null = null;
/** First day of the month shown in the calendar, "YYYY-MM-01". */
let calMonth: string | null = null;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    credentials: "same-origin",
  });
  const data: any = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/login") {
    state = null;
    renderAuth();
  }
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data as T;
}

function toast(msg: string, bad = false) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = `toast${bad ? " bad" : ""}`;
  el.setAttribute("role", "status");
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

function prettyDate(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  });
}

const deskName = (eui?: string | null, name?: string | null) =>
  name ? `desk ${name}` : eui ? `desk …${eui.slice(-4)}` : "added by hand";

const svg = (body: string, width = 2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  scan: svg('<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>'),
  home: svg('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'),
  stats: svg('<path d="M5 20V11M12 20V5M19 20v-6"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  left: svg('<path d="M15 6l-6 6 6 6"/>', 2.4),
  right: svg('<path d="M9 6l6 6-6 6"/>', 2.4),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>', 2.4),
  office: svg('<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3"/>'),
  leave: svg('<path d="M10 14l-6-2 1-2 7 1 4-6a1.5 1.5 0 0 1 2.5 1.5L16 12l2 7-2 1-3-5-3 3v3l-1.5.5L7 18l-3-1.5L4.5 15H8z"/>'),
  holiday: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  sick: svg('<path d="M14 4v10.5a4 4 0 1 1-4 0V4a2 2 0 1 1 4 0z"/><path d="M12 17v-6"/>'),
};

type Tab = "home" | "stats" | "settings";

/** The bottom bar on the three main screens. */
function tabbar(active: Tab): string {
  const tabs: [Tab, string, string][] = [["home", "Home", ICON.home], ["stats", "Stats", ICON.stats], ["settings", "Settings", ICON.gear]];
  return `<nav class="tabbar" aria-label="Main"><div>${tabs
    .map(([t, l, i]) => `<button type="button" data-tab="${t}" ${t === active ? 'aria-current="page"' : ""}>${i}${l}</button>`)
    .join("")}</div></nav>`;
}

function wireTabs() {
  app.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.getAttribute("aria-current")) return;
      ({ home: renderHome, stats: renderStats, settings: renderSettings })[b.dataset.tab as Tab]();
      scrollTo(0, 0);
    }),
  );
}

/* ---------- Sign in ---------- */

function renderAuth(mode: "login" | "signup" = "login") {
  const signup = mode === "signup";
  app.classList.add("no-tabs");
  app.innerHTML = `
    <div class="brand"><img src="/icon.svg" alt="" /><h1>OfficeDays</h1><p>Scan a desk QR, count your office days.</p></div>
    <div class="card">
      <div class="seg" role="group">
        <button type="button" data-mode="login" aria-pressed="${!signup}">Sign in</button>
        <button type="button" data-mode="signup" aria-pressed="${signup}">Create account</button>
      </div>
      <form id="auth">
        ${signup ? `<label for="name">Your name</label><input id="name" name="name" autocomplete="name" required />` : ""}
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" required />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" minlength="8" required
          autocomplete="${signup ? "new-password" : "current-password"}" />
        ${signup ? `<label for="code">Invite code</label><input id="code" name="code" autocomplete="off" />` : ""}
        <p class="error" id="err"></p>
        <button class="full" type="submit">${signup ? "Create account" : "Sign in"}</button>
      </form>
    </div>`;
  app.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => renderAuth(b.dataset.mode as "login" | "signup")),
  );
  const form = app.querySelector<HTMLFormElement>("#auth")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]") as HTMLButtonElement;
    btn.disabled = true;
    const body = Object.fromEntries(new FormData(form)) as Record<string, string>;
    body.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      await api(signup ? "/signup" : "/login", { method: "POST", body: JSON.stringify(body) });
      await loadHome();
    } catch (err) {
      app.querySelector("#err")!.textContent = (err as Error).message;
      btn.disabled = false;
    }
  });
}

/* ---------- Home ---------- */

function ring(p: PeriodProgress, label: string, otherPeriod: string): string {
  const r = 45, c = 2 * Math.PI * r;
  const goal = p.required;
  const frac = goal ? Math.min(p.days / goal, 1) : goal === 0 ? 1 : 0;
  let hint = `No ${label.toLowerCase()} target`;
  if (goal !== null) {
    const left = Math.max(goal - p.days, 0);
    hint = left === 0 ? "Target met" : `${left} more to go`;
    if (p.daysOff) hint += ` · ${p.daysOff} off`;
  } else if (otherPeriod) {
    hint = `Target is per ${otherPeriod}`;
  }
  return `
    <div class="card ring-card">
      <span class="label">${label}</span>
      <div class="ring" role="img" aria-label="${p.days} of ${goal ?? "no"} days">
        <svg viewBox="0 0 112 112" aria-hidden="true">
          <circle cx="56" cy="56" r="${r}" fill="none" stroke="var(--track)" stroke-width="9" />
          ${frac > 0 ? `<circle cx="56" cy="56" r="${r}" fill="none" stroke="var(--brand)" stroke-width="9" stroke-linecap="round" stroke-dasharray="${c * frac} ${c}" />` : ""}
        </svg>
        <div class="core"><span class="num">${p.days}</span><span class="of">${goal !== null ? `of ${goal}` : "days"}</span></div>
      </div>
      <span class="hint">${hint}</span>
    </div>`;
}

async function loadHome() {
  state = await api<Summary>("/me");
  renderHome();
}

async function renderHome() {
  if (!state) return;
  const { user, progress: p, target } = state;
  const todayLabel = new Date(`${p.today}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });
  app.classList.remove("no-tabs");
  app.innerHTML = `
    <div class="top"><div><small>${esc(todayLabel)}</small><h1>Hi, ${esc(user.name.split(" ")[0])}</h1></div></div>
    <section class="card hero">
      <div class="scan-well">
        <button class="scan-btn" id="scan" type="button">${ICON.scan}Scan desk</button>
      </div>
      <span class="pill ${p.checkedInToday ? "ok" : ""}"><span class="dot"></span>${p.checkedInToday ? "You're checked in today" : "Not checked in today"}</span>
    </section>
    <div class="duo">
      ${ring(p.week, "This week", target?.month_days != null ? "month" : "")}
      ${ring(p.month, "This month", target?.week_days != null ? "week" : "")}
    </div>
    <section class="card" id="calendar"></section>
    ${tabbar("home")}`;
  app.querySelector("#scan")!.addEventListener("click", openScanner);
  wireTabs();
  renderCalendar();
}

/* ---------- Calendar ---------- */

const KIND_LABEL: Record<string, string> = { leave: "Leave", holiday: "Public holiday", sick: "Sick" };
const KIND_TAG: Record<string, string> = { leave: "L", holiday: "H", sick: "S" };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDay = (d: string, n = 1) => iso(new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000));
const isoWeekday = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** A week of a month, cut at the month's edges and scored on that month's days only. */
interface MonthWeek { start: string; end: string; days: number; required: number | null; met: boolean | null }
interface MonthDays { checkins: Checkin[]; leave: Leave[]; weeks: MonthWeek[] }

function monthBounds(first: string): { first: string; last: string } {
  return { first, last: iso(new Date(Date.UTC(+first.slice(0, 4), +first.slice(5, 7), 0))) };
}

function fetchMonth(first: string): Promise<MonthDays> {
  const { last } = monthBounds(first);
  return api<MonthDays>(`/days?from=${first}&to=${last}`);
}

/** How each day of a month reads: office, a day off, a missed workday, or nothing yet. */
function dayKinds(data: MonthDays, workdays: string) {
  const office = new Map(data.checkins.map((c) => [c.local_date, c]));
  const off = new Map(data.leave.map((l) => [l.date, l.kind]));
  // A workday with nothing recorded shows as missed only once its week is over below target.
  const missed = new Set<string>();
  for (const w of data.weeks) {
    if (w.met !== false) continue;
    for (let d = w.start; d <= w.end; d = addDay(d)) {
      if (workdays.includes(String(isoWeekday(d))) && !office.has(d) && !off.has(d)) missed.add(d);
    }
  }
  return { office, off, missed };
}

function shiftMonth(first: string, by: number): string {
  const d = new Date(`${first}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return iso(d);
}

async function renderCalendar() {
  const el = app.querySelector<HTMLElement>("#calendar");
  if (!el || !state) return;
  const today = state.progress.today;
  calMonth ??= `${today.slice(0, 7)}-01`;
  const { first, last } = monthBounds(calMonth);
  const title = new Date(`${first}T12:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const workdays = state.target?.workdays ?? "12345";

  el.innerHTML = `
    <div class="cal-head">
      <button class="icon-btn" type="button" data-nav="-1" aria-label="Previous month">${ICON.left}</button>
      <h2>${esc(title)}</h2>
      <button class="icon-btn" type="button" data-nav="1" aria-label="Next month">${ICON.right}</button>
    </div>
    <div class="cal-grid sub">Loading…</div>`;
  el.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((b) =>
    b.addEventListener("click", () => {
      calMonth = shiftMonth(first, Number(b.dataset.nav));
      renderCalendar();
    }),
  );

  const data = await fetchMonth(first);
  if (calMonth !== first) return; // moved on while loading
  const { office, off, missed } = dayKinds(data, workdays);

  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells: string[] = ["M", "T", "W", "T", "F", "S", "S"].map((d) => `<div class="cal-dow">${d}</div>`);
  for (let i = 0; i < lead; i++) cells.push("<div></div>");
  for (let day = 1; day <= +last.slice(8); day++) {
    const date = `${first.slice(0, 8)}${String(day).padStart(2, "0")}`;
    const c = office.get(date);
    const k = off.get(date);
    const cls = [
      "cal-day",
      c ? (c.status === "manual" ? "is-manual" : "is-office") : "",
      k ? `is-${k}` : "",
      missed.has(date) ? "is-missed" : "",
      date === today ? "is-today" : "",
      date > today ? "is-future" : "",
      workdays.includes(String(isoWeekday(date))) ? "" : "is-weekend",
    ].join(" ");
    const label = c
      ? (c.status === "manual" ? "office, added by hand" : "office")
      : k ? KIND_LABEL[k] : missed.has(date) ? "no office, week missed" : "no entry";
    cells.push(`<button type="button" class="${cls}" data-date="${date}" aria-label="${prettyDate(date)}: ${label}">
      ${day}${k ? `<span class="tag">${KIND_TAG[k]}</span>` : ""}</button>`);
  }
  el.querySelector(".cal-grid")!.outerHTML = `<div class="cal-grid">${cells.join("")}</div>
    <p class="legend">
      <span><i class="k-office"></i>Office</span><span><i class="k-manual"></i>Added by hand</span>
      <span><i class="k-leave"></i>Leave</span><span><i class="k-holiday"></i>Holiday</span><span><i class="k-sick"></i>Sick</span>
      <span><i class="k-missed"></i>No office, week missed</span>
    </p>
    <p class="sub">Tap a day to add a missed office day or mark time off.</p>`;
  el.querySelectorAll<HTMLButtonElement>("[data-date]").forEach((b) =>
    b.addEventListener("click", () => {
      const d = b.dataset.date!;
      openDaySheet(d, office.get(d) ?? null, off.get(d) ?? null);
    }),
  );
}

function openDaySheet(date: string, checkin: Checkin | null, kind: string | null) {
  const future = !!state && date > state.progress.today;
  const current = checkin ? "office" : kind ?? "none";
  const now = checkin
    ? checkin.status === "manual" ? "Office day, added by hand" : `Office day, scanned at ${deskName(checkin.desk_eui64, checkin.desk_name)}`
    : kind ? KIND_LABEL[kind] : "Nothing recorded";
  const options: [keyof typeof ICON, string][] = [
    ["office", "Office day"],
    ["leave", "Leave"],
    ["holiday", "Public holiday"],
    ["sick", "Sick"],
  ];
  const dlg = document.createElement("dialog");
  dlg.className = "sheet";
  dlg.innerHTML = `
    <div class="grab"></div>
    <div class="row"><h3>${prettyDate(date)}</h3>
      <button type="button" class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <p class="sub">${esc(now)}</p>
    <div class="choices">
      ${options
        .map(([t, l]) => `<button type="button" class="choice" data-type="${t}" aria-pressed="${t === current}"
          ${t === "office" && future && current !== "office" ? 'disabled title="Office days can\'t be in the future"' : ""}>${ICON[t]}${l}</button>`)
        .join("")}
    </div>
    ${current !== "none" ? `<button type="button" class="ghost full" data-type="none">Clear this day</button>` : ""}
    ${checkin?.desk_eui64 ? `<button type="button" class="link full" data-desk>${checkin.desk_name ? "Rename desk" : "Name this desk"}</button>` : ""}`;
  document.body.append(dlg);
  dlg.querySelector("[data-desk]")?.addEventListener("click", () => {
    dlg.close();
    openDeskName(checkin!.desk_eui64!, checkin!.desk_name ?? null);
  });
  dlg.addEventListener("close", () => dlg.remove());
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close(); // backdrop tap
  });
  dlg.querySelector("[data-close]")!.addEventListener("click", () => dlg.close());
  dlg.querySelectorAll<HTMLButtonElement>("[data-type]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (b.dataset.type === current) return dlg.close();
      try {
        state = await api<Summary>(`/days/${date}`, { method: "PUT", body: JSON.stringify({ type: b.dataset.type }) });
        dlg.close();
        renderHome();
      } catch (err) {
        dlg.close();
        toast((err as Error).message, true);
      }
    }),
  );
  dlg.showModal();
}

/* ---------- Scanner ---------- */

async function openScanner() {
  const overlay = document.createElement("div");
  overlay.className = "scanner";
  overlay.innerHTML = `
    <div class="top"><h1>Scan desk QR</h1>
      <button type="button" class="icon-btn" data-close aria-label="Close scanner">${ICON.close}</button></div>
    <div class="viewfinder">
      <video playsinline muted></video>
      <div class="qr" aria-hidden="true"><span class="corner c1"></span><span class="corner c2"></span><span class="corner c3"></span><span class="corner c4"></span></div>
      <span class="line" aria-hidden="true"></span>
    </div>
    <p id="scan-msg">Point the camera at the QR on your desk</p>
    <button type="button" class="ghost" data-close>Cancel</button>`;
  document.body.append(overlay);
  const video = overlay.querySelector("video")!;
  const msg = overlay.querySelector("#scan-msg")!;
  let stream: MediaStream | null = null;
  let done = false;

  const close = () => {
    done = true;
    stream?.getTracks().forEach((t) => t.stop());
    overlay.remove();
  };
  overlay.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch {
    msg.textContent = "Camera access is needed to scan. Allow it in your browser settings and try again.";
    return;
  }
  if (done) return close();
  video.srcObject = stream;
  await video.play();

  // Native detector where available (Android Chrome), jsQR everywhere else (iOS Safari).
  const Detector = (window as any).BarcodeDetector;
  const native = Detector ? new Detector({ formats: ["qr_code"] }) : null;
  const jsQR = native ? null : (await import("jsqr")).default;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  let busy = false;

  const tick = async () => {
    if (done) return;
    if (!busy && video.readyState >= 2) {
      busy = true;
      let text: string | null = null;
      try {
        if (native) {
          const codes = await native.detect(video);
          text = codes[0]?.rawValue ?? null;
        } else {
          const scale = Math.min(1, 800 / video.videoWidth);
          canvas.width = video.videoWidth * scale;
          canvas.height = video.videoHeight * scale;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          text = jsQR!(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? null;
        }
      } catch {
        text = null;
      }
      if (text) {
        await submit(text);
        return;
      }
      busy = false;
    }
    requestAnimationFrame(tick);
  };

  const submit = async (qr: string) => {
    msg.textContent = "Checking…";
    try {
      const res = await api<Summary & { alreadyCheckedIn: boolean; desk: string; deskName: string | null }>("/checkin", {
        method: "POST",
        body: JSON.stringify({ qr }),
      });
      navigator.vibrate?.(80);
      state = res;
      close();
      const w = res.progress.week;
      toast(res.alreadyCheckedIn
        ? "Already checked in today"
        : `Checked in at ${deskName(res.desk, res.deskName)}. ${w.days}${w.required !== null ? ` of ${w.required}` : ""} this week.`);
      renderHome();
      if (!res.deskName) openDeskName(res.desk, null);
    } catch (err) {
      msg.textContent = (err as Error).message;
      // Let them try another code after a short pause.
      setTimeout(() => {
        if (done) return;
        msg.textContent = "Point the camera at the QR on your desk";
        busy = false;
        requestAnimationFrame(tick);
      }, 2500);
    }
  };

  requestAnimationFrame(tick);
}

/* ---------- Settings ---------- */

function stepper(name: string, label: string, value: number, max: number): string {
  const kind = name.split("_")[0];
  return `
    <div id="t-${kind}">
      <label for="${name}">${label}</label>
      <div class="stepper">
        <button type="button" class="icon-btn" data-step="-1" aria-label="One day fewer">−</button>
        <input id="${name}" name="${name}" type="number" inputmode="numeric" min="0" max="${max}" value="${value}" />
        <button type="button" class="icon-btn" data-step="1" aria-label="One day more">+</button>
      </div>
    </div>`;
}

function renderSettings() {
  if (!state) return;
  const { user, target } = state;
  const zones: string[] = (Intl as any).supportedValuesOf?.("timeZone") ?? [user.timezone];
  if (!zones.includes(user.timezone)) zones.unshift(user.timezone);
  const per = target?.week_days != null && target?.month_days != null ? "both" : target?.month_days != null ? "month" : "week";
  app.classList.remove("no-tabs");
  app.innerHTML = `
    <div class="top"><h1>Settings</h1></div>
    <form class="stack" id="form" style="gap:18px">
      <section class="card">
        <h2>Office target</h2>
        <div>
          <label id="per">Per</label>
          <div class="seg seg-3" role="radiogroup" aria-labelledby="per">
            <label><input type="radio" name="per" value="week" ${per === "week" ? "checked" : ""} /><span>Week</span></label>
            <label><input type="radio" name="per" value="month" ${per === "month" ? "checked" : ""} /><span>Month</span></label>
            <label><input type="radio" name="per" value="both" ${per === "both" ? "checked" : ""} /><span>Both</span></label>
          </div>
        </div>
        <div class="split" id="targets">
          ${stepper("week_days", "Days a week", target?.week_days ?? 3, 7)}
          ${stepper("month_days", "Days a month", target?.month_days ?? 12, 31)}
        </div>
        <fieldset class="days">
          <legend>Workdays</legend>
          ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
            .map((d, i) => `<label><input type="checkbox" name="wd" value="${i + 1}" ${(target?.workdays ?? "12345").includes(String(i + 1)) ? "checked" : ""} /><span>${d}</span></label>`)
            .join("")}
        </fieldset>
        <p class="hint">Leave, holidays and sick days on a workday lower that week's or month's target.</p>
      </section>
      <section class="card">
        <h2>You</h2>
        <div><label for="name">Name</label><input id="name" name="name" value="${esc(user.name)}" /></div>
        <div><label for="tz">Timezone</label>
          <select id="tz" name="timezone">${zones.map((z) => `<option ${z === user.timezone ? "selected" : ""}>${esc(z)}</option>`).join("")}</select></div>
        <p class="error" id="err"></p>
        <button class="full" type="submit">Save</button>
      </section>
    </form>
    <section class="card" id="reminders"></section>
    <section class="card" id="calsync"></section>
    <section class="card">
      <h2>App</h2>
      <button class="list-row" id="install" type="button" hidden><span>Install on this phone<small>Adds OfficeDays to your home screen</small></span><span class="chev">›</span></button>
      <p class="hint" id="install-ios" hidden>To install: tap the Share button in Safari, then <b>Add to Home Screen</b>.</p>
      <a class="list-row" href="/api/export.csv" download><span>Export my days<small>A CSV file of every day recorded</small></span><span class="chev">›</span></a>
      <hr class="groove" />
      ${state.coffee ? `<a class="list-row" href="${esc(state.coffee)}" target="_blank" rel="noopener"><span>Buy me a coffee ☕<small>Enjoying OfficeDays? Say thanks with a coffee</small></span><span class="chev">›</span></a>
      <hr class="groove" />` : ""}
      <button class="list-row" id="logout" type="button"><span>Sign out<small>Signed in as ${esc(user.email)}</small></span><span class="chev">›</span></button>
    </section>
    ${tabbar("settings")}`;
  wireTabs();
  setupInstall();
  renderReminders();
  renderCalendarSync();
  app.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((b) =>
    b.addEventListener("click", () => {
      const input = b.parentElement!.querySelector("input")!;
      input.value = String(Math.min(Number(input.max), Math.max(0, (Number(input.value) || 0) + Number(b.dataset.step))));
    }),
  );
  // Only the steppers for the chosen period(s) are shown.
  const showTargets = () => {
    const chosen = (app.querySelector<HTMLInputElement>('input[name="per"]:checked')?.value ?? "week");
    for (const kind of ["week", "month"]) {
      app.querySelector<HTMLElement>(`#t-${kind}`)!.hidden = chosen !== kind && chosen !== "both";
    }
    app.querySelector<HTMLElement>("#targets")!.classList.toggle("one", chosen !== "both");
  };
  app.querySelectorAll('input[name="per"]').forEach((r) => r.addEventListener("change", showTargets));
  showTargets();
  app.querySelector("#logout")!.addEventListener("click", async () => {
    await api("/logout", { method: "POST" });
    state = null;
    renderAuth();
  });
  const form = app.querySelector<HTMLFormElement>("#form")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const per = String(data.get("per") ?? "week");
    try {
      state = await api<Summary>("/settings", {
        method: "PUT",
        body: JSON.stringify({
          name: data.get("name"),
          timezone: data.get("timezone"),
          workdays: data.getAll("wd").join(""),
          week_days: per === "month" ? null : Number(data.get("week_days")),
          month_days: per === "week" ? null : Number(data.get("month_days")),
        }),
      });
      toast("Saved");
      renderHome();
    } catch (err) {
      app.querySelector("#err")!.textContent = (err as Error).message;
    }
  });
}

/* ---------- Install (PWA) ---------- */

let installPrompt: any = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // show our own button instead of the mini-infobar
  installPrompt = e;
  setupInstall();
});

const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;

function setupInstall() {
  const btn = app.querySelector<HTMLButtonElement>("#install");
  const ios = app.querySelector<HTMLElement>("#install-ios");
  if (!btn || !ios || isStandalone()) return;
  if (installPrompt) {
    btn.hidden = false;
    btn.onclick = async () => {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      installPrompt = null;
      btn.hidden = true;
      if (outcome === "accepted") toast("Installed. Open OfficeDays from your home screen.");
    };
  } else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
    ios.hidden = false;
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

/* ---------- Desk names ---------- */

function openDeskName(eui64: string, current: string | null) {
  const dlg = document.createElement("dialog");
  dlg.className = "sheet";
  dlg.innerHTML = `
    <form method="dialog" id="desk-form">
      <div class="grab"></div>
      <h3>${current ? "Rename this desk" : "Name this desk?"}</h3>
      <p class="sub">Use the number printed on the desk label, like 24.002. Everyone who scans this desk will see it.</p>
      <div><label for="desk-name">Desk name</label>
      <input id="desk-name" name="name" maxlength="40" autocomplete="off" value="${esc(current ?? "")}" placeholder="24.002" /></div>
      <button type="submit" class="full">Save</button>
      <button type="button" class="link full" data-close>${current ? "Cancel" : "Skip"}</button>
    </form>`;
  document.body.append(dlg);
  dlg.addEventListener("close", () => dlg.remove());
  dlg.querySelector("[data-close]")!.addEventListener("click", () => dlg.close());
  dlg.querySelector("form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = (dlg.querySelector("#desk-name") as HTMLInputElement).value.trim();
    try {
      await api(`/desks/${eui64}`, { method: "PUT", body: JSON.stringify({ name }) });
      dlg.close();
      if (name) toast(`Saved as desk ${name}`);
      if (app.querySelector("#calendar")) renderCalendar();
      if (app.querySelector("#statsview")) renderStats();
    } catch (err) {
      toast((err as Error).message, true);
    }
  });
  dlg.showModal();
  (dlg.querySelector("#desk-name") as HTMLInputElement).focus();
}

/* ---------- Stats ---------- */

interface PeriodResult { start: string; end: string; days: number; required: number | null; met: boolean | null }
interface Stats {
  weeks: PeriodResult[];
  months: PeriodResult[];
  streak: number;
  bestStreak: number;
  streakUnit: "week" | "month";
  hit: { met: number; total: number };
  totalDays: number;
  /** Office days per weekday, Monday first. */
  weekdays: number[];
  topDesks: { eui64: string; name: string | null; days: number; last: string }[];
}

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function statsHero(s: Stats): string {
  const rate = s.hit.total ? Math.round((100 * s.hit.met) / s.hit.total) : null;
  const unit = s.streakUnit;
  const c = 2 * Math.PI * 58;
  let tip = "";
  const p = state?.progress;
  const period = p && (unit === "week" ? p.week : p.month);
  if (period && period.required !== null) {
    const left = period.required - period.days;
    tip = left <= 0 ? `This ${unit}'s target is met` : `${plural(left, "more office day")} meets this ${unit}'s target`;
  }
  return `
    <section class="card st-hero" style="--i:0">
      <div class="st-gauge" role="img" aria-label="${rate ?? 0}% of ${unit}s on target">
        <svg viewBox="0 0 140 140" aria-hidden="true">
          <defs><linearGradient id="g-gauge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--brand-hi)" /><stop offset="1" stop-color="var(--brand)" /></linearGradient></defs>
          <circle cx="70" cy="70" r="58" fill="none" stroke="var(--track)" stroke-width="12" />
          ${rate ? `<circle class="st-arc" cx="70" cy="70" r="58" fill="none" stroke="url(#g-gauge)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(c * rate) / 100} ${c}" />` : ""}
        </svg>
        <div class="st-core">${rate === null ? `<b>–</b><span>no finished ${unit}s yet</span>` : `<b data-to="${rate}" data-suffix="%">${rate}%</b><span>${unit}s on target</span>`}</div>
      </div>
      <div class="st-facts">
        <div class="st-fact"><b data-to="${s.totalDays}">${s.totalDays}</b><span>office days in the last year</span></div>
        <div class="st-fact"><b data-to="${s.bestStreak}">${s.bestStreak}</b><span>${unit}s, your best streak</span></div>
        ${tip ? `<span class="pill st-tip">${esc(tip)}</span>` : ""}
      </div>
    </section>`;
}

/** This month, one row per week (cut at the month's edges) and one cell per workday. */
function monthByWeek(data: MonthDays, first: string, today: string, workdays: string): string {
  const { office, off, missed } = dayKinds(data, workdays);
  const cols = [...workdays].map(Number).sort();
  const monthName = new Date(`${first}T12:00:00Z`).toLocaleDateString(undefined, { month: "long", timeZone: "UTC" });
  const short = new Date(`${first}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
  const rows = data.weeks.map((w, i) => {
    const monday = addDay(w.start, 1 - isoWeekday(w.start));
    const cells = cols.map((wd) => {
      const d = addDay(monday, wd - 1);
      if (d < w.start || d > w.end) return `<span class="mw-c blank"></span>`;
      const c = office.get(d);
      const k = off.get(d);
      const cls = c ? (c.status === "manual" ? "manual" : "office") : k ? k : missed.has(d) ? "missed" : d === today ? "today" : d > today ? "future" : "";
      return `<span class="mw-c ${cls}">${+d.slice(8)}${k ? `<sup>${KIND_TAG[k]}</sup>` : ""}</span>`;
    });
    const running = w.start <= today && today <= w.end;
    const status = w.met === true ? "met" : w.met === false ? "missed" : running ? "now" : "later";
    const word = w.met === true ? "On target" : w.met === false ? "Missed" : running ? "This week" : w.start > today ? "Coming up" : "Open";
    const score = w.required !== null ? `${w.days}/${w.required}` : plural(w.days, "day");
    const label = w.start === w.end ? `${+w.start.slice(8)}` : `${+w.start.slice(8)}–${+w.end.slice(8)}`;
    return `<div class="mw-row" style="--i:${i}"><span class="mw-l">${label}</span>${cells.join("")}<span class="mw-s ${status}"><b>${score}</b>${word}</span></div>`;
  });
  return `
    <section class="card" style="--i:1">
      <div class="row"><h2>${esc(monthName)} by week</h2>${state?.target?.week_days != null ? `<span class="hint">Target ${state.target.week_days} a week</span>` : ""}</div>
      <div class="mw" style="--cols:${cols.length}">
        <span class="mw-l">${esc(short)}</span>${cols.map((wd) => `<span class="mw-h">${WEEKDAY_SHORT[wd - 1][0]}</span>`).join("")}<span></span>
        ${rows.join("")}
      </div>
      <p class="legend"><span><i class="k-office"></i>Office</span><span><i class="k-leave"></i>Leave</span><span><i class="k-holiday"></i>Holiday</span><span><i class="k-sick"></i>Sick</span><span><i class="k-missed"></i>No office, week missed</span></p>
    </section>`;
}

function monthBars(months: PeriodResult[], today: string): string {
  const shown = months.slice(-6);
  const target = shown.reduce<number | null>((m, x) => (x.required === null ? m : Math.max(m ?? 0, x.required)), null);
  const max = Math.max(4, target ?? 0, ...shown.map((m) => m.days));
  const plot = 100;
  const name = (m: PeriodResult) => new Date(`${m.start}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
  return `
    <section class="card" style="--i:2">
      <div class="row"><h2>Office days per month</h2>${target !== null ? `<span class="legend"><span><i class="k-line"></i>target</span></span>` : ""}</div>
      <div class="st-months" style="--n:${shown.length}">
        ${target !== null ? `<div class="st-target" style="bottom:${28 + (plot * target) / max}px"></div>` : ""}
        ${shown
          .map((m, i) => `<div class="st-mcol${m.end >= today ? " live" : ""}" style="--i:${i}">
            <em>${m.days}</em><i style="height:${Math.max((plot * m.days) / max, m.days ? 6 : 0)}px"></i><span>${name(m)}</span></div>`)
          .join("")}
      </div>
    </section>`;
}

function usualDays(weekdays: number[], workdays: string): string {
  const cols = [...workdays].map(Number).sort();
  const counts = cols.map((wd) => weekdays[wd - 1] ?? 0);
  const max = Math.max(...counts, 1);
  const top = counts.some((n) => n > 0) ? cols[counts.indexOf(max)] : null;
  const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return `
    <section class="card" style="--i:3">
      <h2>Your usual days</h2>
      <div class="st-rhythm" style="--n:${cols.length}">
        ${cols
          .map((wd, i) => `<div class="st-r${wd === top ? " top" : ""}" style="--i:${i}"><i style="height:${Math.max((84 * counts[i]) / max, 8)}px"></i><b>${counts[i]}</b><span>${WEEKDAY_SHORT[wd - 1]}</span></div>`)
          .join("")}
      </div>
      <p class="hint">${top ? `${names[top - 1]} is your most common office day.` : "Your office days will show here."}</p>
    </section>`;
}

function deskCard(desks: Stats["topDesks"]): string {
  const total = desks.reduce((n, d) => n + d.days, 0);
  return `
    <section class="card" style="--i:4">
      <h2>Your desks</h2>
      ${desks.length
        ? desks
            .map((d, i) => {
              const pct = Math.round((100 * d.days) / total);
              return `${i ? '<hr class="groove" />' : ""}<div class="st-desk" style="--i:${i}">
                <div class="row"><b>${d.name ? `Desk ${esc(d.name)}` : `Unnamed desk …${d.eui64.slice(-4)}`}</b>
                  <button class="ghost" type="button" data-desk="${d.eui64}" data-name="${esc(d.name ?? "")}">${d.name ? "Rename" : "Name it"}</button></div>
                <div class="st-share"><i style="width:${pct}%"></i></div>
                <span>${plural(d.days, "day")} · ${pct}% · last ${prettyDate(d.last)}</span>
              </div>`;
            })
            .join("")
        : `<p class="hint">Scan a desk to see it here.</p>`}
    </section>`;
}

/** Counts the hero numbers up from zero. */
function countUp(root: HTMLElement) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.querySelectorAll<HTMLElement>("[data-to]").forEach((el) => {
    const to = Number(el.dataset.to), suffix = el.dataset.suffix ?? "";
    let t0: number | null = null;
    const step = (t: number) => {
      t0 ??= t;
      const k = Math.min(1, (t - t0) / 1100);
      el.textContent = `${Math.round(to * (1 - Math.pow(1 - k, 3)))}${suffix}`;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

async function renderStats() {
  if (!state) return;
  app.classList.remove("no-tabs");
  app.innerHTML = `
    <div class="top" id="statsview"><h1>Stats</h1></div>
    <section class="card"><p class="sub">Loading…</p></section>
    ${tabbar("stats")}`;
  wireTabs();
  const today = state.progress.today;
  const first = `${today.slice(0, 7)}-01`;
  const [s, month] = await Promise.all([api<Stats>("/stats"), fetchMonth(first)]);
  if (!app.querySelector("#statsview")) return;
  const workdays = state.target?.workdays ?? "12345";
  app.innerHTML = `
    <div class="top" id="statsview"><h1>Stats</h1></div>
    <div class="stack stats" style="gap:18px">
      ${statsHero(s)}
      ${monthByWeek(month, first, today, workdays)}
      ${monthBars(s.months, today)}
      ${usualDays(s.weekdays, workdays)}
      ${deskCard(s.topDesks)}
    </div>
    ${tabbar("stats")}`;
  wireTabs();
  countUp(app);
  app.querySelectorAll<HTMLButtonElement>("[data-desk]").forEach((b) =>
    b.addEventListener("click", () => openDeskName(b.dataset.desk!, b.dataset.name || null)),
  );
}

/* ---------- Reminders (web push) ---------- */

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function b64ToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function currentPushSub(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function saveSettings(extra: Record<string, unknown>) {
  if (!state) return;
  const { user, target } = state;
  state = await api<Summary>("/settings", {
    method: "PUT",
    body: JSON.stringify({
      name: user.name,
      timezone: user.timezone,
      week_days: target ? target.week_days : 3,
      month_days: target ? target.month_days : null,
      workdays: target?.workdays ?? "12345",
      ...extra,
    }),
  });
}

async function renderReminders() {
  const el = app.querySelector<HTMLElement>("#reminders");
  if (!el || !state) return;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const sub = supported ? await currentPushSub() : null;
  const on = !!sub && state.user.remind_day !== null;
  const { remind_day, remind_hour } = state.user;
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const hourLabel = (h: number) => new Date(Date.UTC(2026, 0, 1, h)).toLocaleTimeString(undefined, { hour: "numeric", timeZone: "UTC" });

  el.innerHTML = `
    <div class="row"><h2 id="rlabel">Reminders</h2>
      ${supported ? `<button type="button" class="switch" id="rtoggle" role="switch" aria-checked="${on}" aria-labelledby="rlabel"></button>` : ""}</div>
    <p class="hint">A nudge on your chosen day if you're behind your target. Nothing is sent when you're on track.</p>
    ${!supported
      ? `<p class="hint">${ios && !isStandalone() ? "On iPhone, install the app first (Share, then Add to Home Screen), then open it from your home screen to turn on reminders." : "This browser can't show notifications."}</p>`
      : `<div class="split">
          <div><label for="rday">Day</label><select id="rday">${DAY_NAMES.map((d, i) => `<option value="${i + 1}" ${(remind_day ?? 4) === i + 1 ? "selected" : ""}>${d}</option>`).join("")}</select></div>
          <div><label for="rhour">Time</label><select id="rhour">${hours.map((h) => `<option value="${h}" ${remind_hour === h ? "selected" : ""}>${hourLabel(h)}</option>`).join("")}</select></div>
        </div>
        ${Notification.permission === "denied" ? `<p class="error">Notifications are blocked for this site. Allow them in your browser settings, then try again.</p>` : ""}`}`;
  if (!supported) return;

  const day = el.querySelector<HTMLSelectElement>("#rday")!;
  const hour = el.querySelector<HTMLSelectElement>("#rhour")!;
  const saveTime = async () => {
    if (!on) return;
    await saveSettings({ remind_day: Number(day.value), remind_hour: Number(hour.value) });
    toast("Reminder time saved");
  };
  day.addEventListener("change", saveTime);
  hour.addEventListener("change", saveTime);
  el.querySelector("#rtoggle")!.addEventListener("click", async () => {
    try {
      if (on) {
        await api("/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub!.endpoint }) });
        await sub!.unsubscribe();
        await saveSettings({ remind_day: null });
        toast("Reminders turned off");
      } else {
        if ((await Notification.requestPermission()) !== "granted") {
          toast("Notifications weren't allowed, so reminders can't be sent.", true);
          return renderReminders();
        }
        const { publicKey } = await api<{ publicKey: string }>("/push/key");
        const reg = await navigator.serviceWorker.ready;
        const fresh = (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
        await api("/push/subscribe", { method: "POST", body: JSON.stringify(fresh.toJSON()) });
        await saveSettings({ remind_day: Number(day.value), remind_hour: Number(hour.value) });
        toast(`Reminders on: ${DAY_NAMES[Number(day.value) - 1]} at ${hourLabel(Number(hour.value))} if you're behind`);
      }
    } catch (err) {
      toast((err as Error).message || "Couldn't change reminders.", true);
    }
    renderReminders();
  });
}

/* ---------- Calendar sync ---------- */

async function renderCalendarSync(token?: string | null) {
  const el = app.querySelector<HTMLElement>("#calsync");
  if (!el) return;
  if (token === undefined) token = (await api<{ token: string | null }>("/calendar-link")).token;
  const url = token ? `${location.origin}/api/calendar/${token}.ics` : null;
  el.innerHTML = `
    <h2>Calendar sync</h2>
    <p class="hint">Show your office days and days off in Google, Outlook or Apple Calendar. Keep the link private: anyone with it can see your days.</p>
    ${url
      ? `<input readonly value="${esc(url)}" id="calurl" aria-label="Calendar link" />
         <div class="split">
           <button type="button" id="calcopy">Copy link</button>
           <a class="btn ghost" href="${esc(url.replace(/^https?:/, "webcal:"))}">Open app</a>
         </div>
         <button type="button" class="link" id="calreset">Reset link (the old one stops working)</button>
         <p class="hint">Google Calendar: Other calendars, +, From URL, then paste. Outlook: Add calendar, Subscribe from web.</p>`
      : `<button type="button" id="calmake" class="full">Get my calendar link</button>`}`;
  el.querySelector("#calmake")?.addEventListener("click", async () => {
    renderCalendarSync((await api<{ token: string }>("/calendar-link", { method: "POST" })).token);
  });
  el.querySelector("#calreset")?.addEventListener("click", async () => {
    if (!confirm("Reset the link? Calendars using the old link will stop updating.")) return;
    renderCalendarSync((await api<{ token: string }>("/calendar-link", { method: "POST" })).token);
    toast("New link created");
  });
  el.querySelector("#calcopy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url!);
      toast("Link copied");
    } catch {
      (el.querySelector("#calurl") as HTMLInputElement).select();
    }
  });
}

/* ---------- Start ---------- */

// The app icon's "Scan desk" shortcut opens /?scan=1.
const wantsScan = new URLSearchParams(location.search).has("scan");
if (wantsScan) history.replaceState(null, "", "/");

loadHome()
  .then(() => {
    if (wantsScan) openScanner();
  })
  .catch(() => {
    if (!state) renderAuth();
  });
