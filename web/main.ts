interface PeriodProgress { start: string; end: string; days: number; required: number | null }
interface Summary {
  user: { name: string; email: string; timezone: string };
  target: { period: "week" | "month"; days_required: number } | null;
  progress: { today: string; checkedInToday: boolean; week: PeriodProgress; month: PeriodProgress };
}
interface Checkin { local_date: string; desk_eui64: string | null; scanned_at: string; status: string }

const app = document.getElementById("app")!;
let state: Summary | null = null;

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

const deskName = (eui?: string | null) => (eui ? `Desk …${eui.slice(-4)}` : "Added manually");

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
      <button class="link" id="settings" type="button">Settings</button>
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
    <div class="card">
      <h2>Recent office days</h2>
      <ul class="list" id="history"><li class="sub">Loading…</li></ul>
    </div>`;
  app.querySelector("#scan")!.addEventListener("click", openScanner);
  app.querySelector("#settings")!.addEventListener("click", renderSettings);

  const { checkins } = await api<{ checkins: Checkin[] }>("/checkins");
  const list = app.querySelector("#history");
  if (!list) return;
  list.innerHTML = checkins.length
    ? checkins.slice(0, 30).map((c) => `
        <li>
          <span>${prettyDate(c.local_date)}<br /><span class="sub">${esc(deskName(c.desk_eui64))}</span></span>
          ${c.local_date === p.today ? `<button class="link" data-undo="${c.local_date}" type="button">Undo</button>` : ""}
        </li>`).join("")
    : `<li class="sub">No office days yet. Scan a desk QR when you're in.</li>`;
  list.querySelectorAll<HTMLButtonElement>("[data-undo]").forEach((b) =>
    b.addEventListener("click", async () => {
      state = await api<Summary>(`/checkins/${b.dataset.undo}`, { method: "DELETE" });
      toast("Removed today's check-in");
      renderHome();
    }),
  );
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
      const res = await api<Summary & { alreadyCheckedIn: boolean; desk: string }>("/checkin", {
        method: "POST",
        body: JSON.stringify({ qr }),
      });
      navigator.vibrate?.(80);
      state = res;
      close();
      const w = res.progress.week;
      toast(res.alreadyCheckedIn
        ? "Already checked in today"
        : `Checked in at ${deskName(res.desk).toLowerCase()}. ${w.days}${w.required !== null ? ` of ${w.required}` : ""} this week.`);
      renderHome();
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
      <h2 style="margin-top:20px">You</h2>
      <label for="name">Name</label>
      <input id="name" name="name" value="${esc(user.name)}" />
      <label for="tz">Timezone</label>
      <select id="tz" name="timezone">${zones.map((z) => `<option ${z === user.timezone ? "selected" : ""}>${esc(z)}</option>`).join("")}</select>
      <p class="error" id="err"></p>
      <button class="full" type="submit">Save</button>
    </form>
    <div class="card">
      <p class="sub" style="margin:0 0 12px">Signed in as ${esc(user.email)}</p>
      <button class="ghost" id="logout" type="button">Sign out</button>
    </div>`;
  app.querySelector("#back")!.addEventListener("click", renderHome);
  app.querySelector("#logout")!.addEventListener("click", async () => {
    await api("/logout", { method: "POST" });
    state = null;
    renderAuth();
  });
  const form = app.querySelector<HTMLFormElement>("#form")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form)) as Record<string, string>;
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

/* ---------- Start ---------- */

loadHome().catch(() => {
  if (!state) renderAuth();
});
