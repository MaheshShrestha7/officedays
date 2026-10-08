interface PeriodProgress { start: string; end: string; days: number; daysOff: number; required: number | null }
interface Summary {
  user: { name: string; email: string; timezone: string; remind_day: number | null; remind_hour: number };
  pushDevices: number;
  target: { period: "week" | "month"; days_required: number; workdays: string } | null;
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

/* ---------- Sign in ---------- */

function renderAuth(mode: "login" | "signup" = "login") {
  const signup = mode === "signup";
  app.innerHTML = `
    <div class="brand"><img src="/icon.svg" alt="" /><h1>OfficeDays</h1><p>Scan a desk QR, count your office days.</p></div>
    <div class="card">
      <div class="tabs" role="group">
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
  const r = 46, c = 2 * Math.PI * r;
  const goal = p.required;
  const frac = goal ? Math.min(p.days / goal, 1) : goal === 0 ? 1 : 0;
  const met = goal !== null && p.days >= goal;
  const color = met ? "var(--good)" : "var(--brand)";
  let hint = `No ${label.toLowerCase()} target`;
  if (goal !== null) {
    const left = Math.max(goal - p.days, 0);
    hint = left === 0 ? "Target met" : `${left} more day${left === 1 ? "" : "s"} to go`;
    if (p.daysOff) hint += ` · ${p.daysOff} off`;
  } else if (otherPeriod) {
    hint = `Target is per ${otherPeriod}`;
  }
  return `
    <div class="ring">
      <div class="label">${label}</div>
      <svg viewBox="0 0 112 112" role="img" aria-label="${p.days} of ${goal ?? "no"} days">
        <circle cx="56" cy="56" r="${r}" fill="none" stroke="var(--track)" stroke-width="10" />
        <circle cx="56" cy="56" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"
          stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}" transform="rotate(-90 56 56)" />
        <text x="56" y="60" text-anchor="middle" font-size="26" font-weight="700" fill="var(--ink)">${p.days}</text>
        <text x="56" y="78" text-anchor="middle" font-size="12" fill="var(--muted)">${goal !== null ? `of ${goal}` : "days"}</text>
      </svg>
      <div class="hint">${hint}</div>
    </div>`;
}

async function loadHome() {
  state = await api<Summary>("/me");
  renderHome();
}

async function renderHome() {
  if (!state) return;
  const { user, progress: p, target } = state;
  app.innerHTML = `
    <div class="top">
      <h1>Hi, ${esc(user.name.split(" ")[0])}</h1>
      <span><button class="link" id="stats" type="button">Stats</button><button class="link" id="settings" type="button">Settings</button></span>
    </div>
    <div class="card">
      <button class="scan-btn" id="scan" type="button">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/></svg>
        Scan desk QR
      </button>
      <p class="today ${p.checkedInToday ? "done" : ""}">${p.checkedInToday ? "You're checked in today" : "Not checked in today"}</p>
    </div>
    <div class="card rings">
      ${ring(p.week, "This week", target?.period === "month" ? "month" : "")}
      ${ring(p.month, "This month", target?.period === "week" ? "week" : "")}
    </div>
    <div class="card" id="calendar"></div>`;
  app.querySelector("#scan")!.addEventListener("click", openScanner);
  app.querySelector("#settings")!.addEventListener("click", renderSettings);
  app.querySelector("#stats")!.addEventListener("click", renderStats);
  renderCalendar();
}

/* ---------- Calendar ---------- */

const KIND_LABEL: Record<string, string> = { leave: "Leave", holiday: "Public holiday", sick: "Sick" };
const iso = (d: Date) => d.toISOString().slice(0, 10);

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
  const first = calMonth;
  const last = iso(new Date(Date.UTC(+first.slice(0, 4), +first.slice(5, 7), 0)));
  const title = new Date(`${first}T12:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const workdays = state.target?.workdays ?? "12345";

  el.innerHTML = `
    <div class="cal-head">
      <button class="link" type="button" data-nav="-1" aria-label="Previous month">‹</button>
      <h2>${esc(title)}</h2>
      <button class="link" type="button" data-nav="1" aria-label="Next month">›</button>
    </div>
    <div class="cal-grid sub">Loading…</div>`;
  el.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((b) =>
    b.addEventListener("click", () => {
      calMonth = shiftMonth(first, Number(b.dataset.nav));
      renderCalendar();
    }),
  );

  const { checkins, leave } = await api<{ checkins: Checkin[]; leave: Leave[] }>(`/days?from=${first}&to=${last}`);
  if (calMonth !== first) return; // moved on while loading
  const office = new Map(checkins.map((c) => [c.local_date, c]));
  const off = new Map(leave.map((l) => [l.date, l.kind]));

  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells: string[] = ["M", "T", "W", "T", "F", "S", "S"].map((d) => `<div class="cal-dow">${d}</div>`);
  for (let i = 0; i < lead; i++) cells.push("<div></div>");
  for (let day = 1; day <= +last.slice(8); day++) {
    const date = `${first.slice(0, 8)}${String(day).padStart(2, "0")}`;
    const wd = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const c = office.get(date);
    const k = off.get(date);
    const cls = [
      "cal-day",
      c ? (c.status === "manual" ? "is-manual" : "is-office") : "",
      k ? "is-off" : "",
      date === today ? "is-today" : "",
      date > today ? "is-future" : "",
      workdays.includes(String(wd)) ? "" : "is-weekend",
    ].join(" ");
    const label = c ? (c.status === "manual" ? "office, added by hand" : "office") : k ? KIND_LABEL[k] : "no entry";
    cells.push(`<button type="button" class="${cls}" data-date="${date}" aria-label="${prettyDate(date)}: ${label}">
      ${day}${k ? `<span class="tag">${k === "holiday" ? "H" : k === "sick" ? "S" : "L"}</span>` : ""}</button>`);
  }
  el.querySelector(".cal-grid")!.outerHTML = `<div class="cal-grid">${cells.join("")}</div>
    <p class="legend"><span class="dot office"></span>Office <span class="dot manual"></span>Added by hand <span class="dot off"></span>Leave, holiday or sick</p>
    <p class="sub" style="margin:4px 0 0">Tap a day to add a missed office day or mark time off.</p>`;
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
  const options: [string, string][] = [
    ["office", "Office day"],
    ["leave", "Leave"],
    ["holiday", "Public holiday"],
    ["sick", "Sick"],
    ["none", "Clear"],
  ];
  const dlg = document.createElement("dialog");
  dlg.className = "sheet";
  dlg.innerHTML = `
    <h2 style="color:var(--ink);font-size:17px">${prettyDate(date)}</h2>
    <p class="sub" style="margin:0 0 12px">${esc(now)}</p>
    <div class="sheet-options">
      ${options
        .filter(([t]) => !(t === "office" && future) && !(t === "none" && current === "none"))
        .map(([t, l]) => `<button type="button" class="ghost${t === current ? " is-current" : ""}" data-type="${t}" ${t === current ? "disabled" : ""}>${t === current ? `✓ ${l}` : l}</button>`)
        .join("")}
    </div>
    ${checkin?.desk_eui64 ? `<button type="button" class="link full" data-desk>${checkin.desk_name ? "Rename desk" : "Name this desk"}</button>` : ""}
    <button type="button" class="link full" data-close>Cancel</button>`;
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
    <video playsinline muted></video>
    <div class="frame" aria-hidden="true"></div>
    <div class="bar"><p id="scan-msg">Point the camera at the QR on your desk</p><button type="button">Cancel</button></div>`;
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
  overlay.querySelector("button")!.addEventListener("click", close);

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

function renderSettings() {
  if (!state) return;
  const { user, target } = state;
  const zones: string[] = (Intl as any).supportedValuesOf?.("timeZone") ?? [user.timezone];
  if (!zones.includes(user.timezone)) zones.unshift(user.timezone);
  app.innerHTML = `
    <div class="top"><h1>Settings</h1><button class="link" id="back" type="button">Done</button></div>
    <form class="card" id="form">
      <h2>Office target</h2>
      <div class="row">
        <div>
          <label for="days">Days</label>
          <input id="days" name="days_required" type="number" inputmode="numeric" min="0" max="31" value="${target?.days_required ?? 3}" />
        </div>
        <div>
          <label for="period">Per</label>
          <select id="period" name="period">
            <option value="week" ${target?.period !== "month" ? "selected" : ""}>week</option>
            <option value="month" ${target?.period === "month" ? "selected" : ""}>month</option>
          </select>
        </div>
      </div>
      <fieldset class="workdays">
        <legend>Workdays</legend>
        ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
          .map((d, i) => `<label><input type="checkbox" name="wd" value="${i + 1}" ${(target?.workdays ?? "12345").includes(String(i + 1)) ? "checked" : ""} /><span>${d}</span></label>`)
          .join("")}
      </fieldset>
      <p class="sub" style="margin:6px 0 0">Leave, holidays and sick days on a workday lower that week's or month's target.</p>
      <h2 style="margin-top:20px">You</h2>
      <label for="name">Name</label>
      <input id="name" name="name" value="${esc(user.name)}" />
      <label for="tz">Timezone</label>
      <select id="tz" name="timezone">${zones.map((z) => `<option ${z === user.timezone ? "selected" : ""}>${esc(z)}</option>`).join("")}</select>
      <p class="error" id="err"></p>
      <button class="full" type="submit">Save</button>
    </form>
    <div class="card" id="reminders"></div>
    <div class="card" id="calsync"></div>
    <div class="card">
      <h2>App</h2>
      <div class="stack">
        <button class="ghost" id="install" type="button" hidden>Install app</button>
        <p class="sub" id="install-ios" hidden style="margin:0">To install: tap the Share button in Safari, then <b>Add to Home Screen</b>.</p>
        <a class="btn ghost" href="/api/export.csv" download>Export my days (CSV)</a>
      </div>
      <p class="sub" style="margin:16px 0 12px">Signed in as ${esc(user.email)}</p>
      <button class="ghost" id="logout" type="button">Sign out</button>
    </div>`;
  app.querySelector("#back")!.addEventListener("click", renderHome);
  setupInstall();
  renderReminders();
  renderCalendarSync();
  app.querySelector("#logout")!.addEventListener("click", async () => {
    await api("/logout", { method: "POST" });
    state = null;
    renderAuth();
  });
  const form = app.querySelector<HTMLFormElement>("#form")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const body = Object.fromEntries(data) as Record<string, string>;
    body.workdays = data.getAll("wd").join("");
    try {
      state = await api<Summary>("/settings", {
        method: "PUT",
        body: JSON.stringify({ ...body, days_required: Number(body.days_required) }),
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
      <h2 style="color:var(--ink);font-size:17px">${current ? "Rename this desk" : "Name this desk?"}</h2>
      <p class="sub" style="margin:0 0 4px">Use the number printed on the desk label, like 24.002. Everyone who scans this desk will see it.</p>
      <label for="desk-name">Desk name</label>
      <input id="desk-name" name="name" maxlength="40" autocomplete="off" value="${esc(current ?? "")}" placeholder="24.002" />
      <div class="sheet-options" style="margin-top:16px">
        <button type="submit">Save</button>
        <button type="button" class="link" data-close>${current ? "Cancel" : "Skip"}</button>
      </div>
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
  streakUnit: "week" | "month";
  hit: { met: number; total: number };
  totalDays: number;
  topDesks: { eui64: string; name: string | null; days: number; last: string }[];
}

function monthChart(months: PeriodResult[]): string {
  const W = 340, H = 150, top = 22, bottom = 22, left = 4, right = 4;
  const max = Math.max(4, ...months.map((m) => m.days), ...months.map((m) => m.required ?? 0));
  const step = (W - left - right) / months.length;
  const bw = Math.min(22, step - 4);
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  const label = (m: PeriodResult) =>
    new Date(`${m.start}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
  const bars = months.map((m, i) => {
    const x = left + i * step + (step - bw) / 2;
    const h = Math.max(H - bottom - y(m.days), m.days ? 2 : 0);
    const last = i === months.length - 1;
    const r = Math.min(4, h / 2);
    const path = h
      ? `M${x},${H - bottom} V${H - bottom - h + r} q0,-${r} ${r},-${r} H${x + bw - r} q${r},0 ${r},${r} V${H - bottom} Z`
      : "";
    return `<g class="bar">
      <rect x="${left + i * step}" y="${top}" width="${step}" height="${H - top}" fill="transparent" />
      ${path ? `<path d="${path}" fill="var(--brand)" opacity="${last ? 1 : 0.75}" />` : ""}
      ${m.required !== null ? `<line x1="${x - 2}" x2="${x + bw + 2}" y1="${y(m.required)}" y2="${y(m.required)}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="3 2" />` : ""}
      ${last || m.days === max ? `<text x="${x + bw / 2}" y="${H - bottom - h - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--ink)">${m.days}</text>` : ""}
      <text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${label(m)}</text>
      <title>${label(m)}: ${m.days} office day${m.days === 1 ? "" : "s"}${m.required !== null ? ` of ${m.required}` : ""}</title>
    </g>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Office days per month">
    <line x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}" stroke="var(--line)" />
    ${bars.join("")}
  </svg>`;
}

async function renderStats() {
  app.innerHTML = `
    <div class="top" id="statsview"><h1>Stats</h1><button class="link" id="back" type="button">Done</button></div>
    <div class="card sub">Loading…</div>`;
  app.querySelector("#back")!.addEventListener("click", renderHome);
  const s = await api<Stats>("/stats");
  if (!app.querySelector("#statsview")) return;
  const rate = s.hit.total ? Math.round((100 * s.hit.met) / s.hit.total) : null;
  const unit = s.streakUnit;
  const weeks = s.weeks.slice(-12);
  const anyMonthlyTarget = s.months.some((m) => m.required !== null);
  app.innerHTML = `
    <div class="top" id="statsview"><h1>Stats</h1><button class="link" id="back" type="button">Done</button></div>
    <div class="tiles">
      <div class="tile"><div class="big">${s.streak}</div><div class="sub">${unit}${s.streak === 1 ? "" : "s"} in a row on target</div></div>
      <div class="tile"><div class="big">${rate === null ? "–" : `${rate}%`}</div><div class="sub">${rate === null ? "no finished " + unit + "s yet" : `${s.hit.met} of ${s.hit.total} ${unit}s on target`}</div></div>
      <div class="tile"><div class="big">${s.totalDays}</div><div class="sub">office days in the last year</div></div>
    </div>
    <div class="card">
      <h2>Office days per month</h2>
      ${monthChart(s.months)}
      ${anyMonthlyTarget ? `<p class="legend"><span class="dash"></span>Monthly target</p>` : ""}
    </div>
    <div class="card">
      <h2>Recent weeks</h2>
      <div class="weeks">${weeks
        .map((w) => {
          const cls = w.met === true ? "met" : w.met === false ? "missed" : "open";
          const date = new Date(`${w.start}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
          const status = w.met === true ? "on target" : w.met === false ? "missed" : w.required === null ? "no weekly target" : "in progress";
          return `<div class="wk ${cls}" title="Week of ${date}: ${w.days} day${w.days === 1 ? "" : "s"}, ${status}">
            <span class="n">${w.days}${w.required !== null ? `<small>/${w.required}</small>` : ""}</span><span class="d">${date}</span></div>`;
        })
        .join("")}</div>
      <p class="legend"><span class="dot office"></span>On target <span class="dot missed"></span>Missed <span class="dot off"></span>In progress</p>
    </div>
    <div class="card">
      <h2>Your desks</h2>
      <ul class="list">${s.topDesks.length
        ? s.topDesks
            .map((d) => `<li><span>${d.name ? `Desk ${esc(d.name)}` : `Unnamed desk …${d.eui64.slice(-4)}`}<br />
              <span class="sub">${d.days} day${d.days === 1 ? "" : "s"} · last ${prettyDate(d.last)}</span></span>
              <button class="link" type="button" data-desk="${d.eui64}" data-name="${esc(d.name ?? "")}">${d.name ? "Rename" : "Name it"}</button></li>`)
            .join("")
        : `<li class="sub">Scan a desk to see it here.</li>`}</ul>
    </div>`;
  app.querySelector("#back")!.addEventListener("click", renderHome);
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
      period: target?.period ?? "week",
      days_required: target?.days_required ?? 3,
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
    <h2>Reminders</h2>
    <p class="sub" style="margin:0 0 12px">A notification on your chosen day if you're behind your target. Nothing is sent when you're on track.</p>
    ${!supported
      ? `<p class="sub" style="margin:0">${ios && !isStandalone() ? "On iPhone, install the app first (Share, then Add to Home Screen), then open it from your home screen to turn on reminders." : "This browser can't show notifications."}</p>`
      : `<div class="row">
          <div><label for="rday">Day</label><select id="rday">${DAY_NAMES.map((d, i) => `<option value="${i + 1}" ${(remind_day ?? 4) === i + 1 ? "selected" : ""}>${d}</option>`).join("")}</select></div>
          <div><label for="rhour">Time</label><select id="rhour">${hours.map((h) => `<option value="${h}" ${remind_hour === h ? "selected" : ""}>${hourLabel(h)}</option>`).join("")}</select></div>
        </div>
        <button class="${on ? "ghost" : ""} full" id="rtoggle" type="button">${on ? "Turn off reminders" : "Turn on reminders"}</button>
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
    <p class="sub" style="margin:0 0 12px">Show your office days and days off in Google, Outlook or Apple Calendar. Keep the link private: anyone with it can see your days.</p>
    ${url
      ? `<input readonly value="${esc(url)}" id="calurl" aria-label="Calendar link" />
         <div class="stack" style="margin-top:8px">
           <button type="button" id="calcopy">Copy link</button>
           <a class="btn ghost" href="${esc(url.replace(/^https?:/, "webcal:"))}">Open in my calendar app</a>
           <button type="button" class="link" id="calreset">Reset link (the old one stops working)</button>
         </div>
         <p class="sub" style="margin:8px 0 0">Google Calendar: Other calendars, +, From URL, then paste. Outlook: Add calendar, Subscribe from web.</p>`
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
