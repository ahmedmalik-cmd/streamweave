const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
let state = {
    session: { state: "stopped" },
    moments: [],
    messages: [],
    metrics: {},
    history: [],
    video: {},
  },
  view = "live",
  platform = "all",
  reviewFilter = "all",
  paused = false,
  selected = null,
  postPlatform = "tiktok",
  pausedMessages = [];
const drafts = new Map();
let chatTimer;
function rememberDraft() {
  if (selected && $("#post-copy"))
    drafts.set(`${selected}:${postPlatform}`, {
      copy: $("#post-copy").value,
      ready: $("#post-ready").checked,
    });
}
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const time = (t) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const icon = (n) => `<i data-lucide="${n}"></i>`;
const icons = () => window.lucide?.createIcons();
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").hidden = true), 6000);
}
async function api(url, method = "GET", data) {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(url === "/api/start" ? 200000 : 15000),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.error || "Request failed");
  return b;
}
function setView(next) {
  rememberDraft();
  window.scrollTo({ top: 0 });
  view = next;
  $("#live-view").hidden = next !== "live";
  $("#clips-view").hidden = next !== "clips";
  $$(".rail-button[data-view]").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === next),
  );
  $("#page-title").textContent = next === "live" ? "Live room" : "Clip review";
  $("#page-subtitle").textContent =
    next === "live"
      ? "One conversation. Every audience."
      : "Catch the signal. Shape the story.";
  if (next === "clips") renderQueue();
}
$$("[data-view]").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
function renderSession() {
  const running = state.session.state === "running",
    starting = state.session.state === "starting";
  $("#session-label").textContent = running
    ? state.session.mode === "demo"
      ? "DEMO SESSION"
      : "TWITCH SESSION"
    : starting
      ? "PREPARING SOURCE"
      : "SESSION OFFLINE";
  $("#session-light").classList.toggle("green", running);
  $("#session-button").innerHTML =
    icon(running || starting ? "square" : "play") +
    (running || starting ? "Stop session" : "Start session");
  $("#session-button").classList.toggle("danger", running || starting);
  $("#mark-button").hidden = !running;
  $("#demo-tag").hidden = state.session.mode !== "demo";
  icons();
}
function renderHealth() {
  for (const p of ["twitch", "youtube", "tiktok"]) {
    const h = state.health?.[p] || {};
    $(`#${p}-detail`).textContent = h.detail || "Not connected";
    const el = $(`#${p}-state`);
    el.textContent = h.state || "offline";
    el.className =
      "pill " +
      (h.state === "demo" ? "amber" : h.state === "connected" ? "good" : "");
  }
}
function renderMetrics() {
  const m = {
    warmup: state.session.state === "running" ? 30 : 0,
    ...state.metrics,
  };
  $("#ratio").innerHTML = `${(m.ratio || 0).toFixed(1)}<span>×</span>`;
  $("#window-count").textContent = m.count || 0;
  $("#unique-count").textContent = m.users || 0;
  $("#hype-count").textContent = Math.round((m.density || 0) * 100) + "%";
  $("#rate-footer").textContent = Math.round((m.rate || 0) * 60);
  $("#detector-state").textContent =
    state.session.state !== "running"
      ? "Standby"
      : m.warmup
        ? `Warm-up ${m.warmup}s`
        : m.cooldown
          ? `Cooldown ${m.cooldown}s`
          : "Armed";
  $("#detector-state").className =
    "pill " +
    (!m.warmup && !m.cooldown && state.session.state === "running"
      ? "good"
      : "");
  $("#signal-label").textContent =
    state.session.state !== "running"
      ? "Awaiting signal"
      : m.warmup
        ? "Learning the room"
        : m.ratio >= 2.4
          ? "Elevated audience activity"
          : "Watching for a spike";
  for (const [id, pass] of [
    ["ratio", m.ratio >= 2.4],
    ["users", m.users >= 4],
    ["hype", m.density >= 0.25],
    ["count", m.count >= 8],
  ])
    $(`#gate-${id}`).classList.toggle("passed", pass);
  const h = state.history || [],
    max = Math.max(3, ...h.map((p) => p.rate)) * 1.1;
  const points = h.map(
    (p, i) => `${(i * 440) / 89},${84 - (p.rate / max) * 78}`,
  );
  $("#chart-line").setAttribute(
    "d",
    points.length ? "M" + points.join(" L") : "",
  );
  $("#chart-area").setAttribute(
    "d",
    points.length
      ? `M0,88 L${points.join(" L")} L${((h.length - 1) * 440) / 89},88 Z`
      : "",
  );
  $("#baseline-line").setAttribute(
    "d",
    h.length
      ? "M" +
          h
            .map((p, i) => `${(i * 440) / 89},${84 - (p.baseline / max) * 78}`)
            .join(" L")
      : "",
  );
}
function renderChat() {
  const query = $("#search").value.toLowerCase(),
    feed = $("#chat-feed"),
    scroll = feed.scrollTop;
  const sourceMessages = paused ? pausedMessages : state.messages;
  const msgs = sourceMessages
    .filter(
      (m) =>
        (platform === "all" || m.platform === platform) &&
        (!query || `${m.user} ${m.text}`.toLowerCase().includes(query)),
    )
    .slice(-250);
  $("#chat-total").textContent =
    `${sourceMessages.length} messages${paused ? " · paused" : ""}`;
  feed.innerHTML = msgs.length
    ? msgs
        .map(
          (m) =>
            `<div class="message ${/omg|clutch|clip|wow|insane|pog|lets go/i.test(m.text) ? "hype" : ""}"><span class="platform ${m.platform}" title="${m.platform}${m.demo ? " (simulated)" : ""}">${{ twitch: "T", youtube: "Y", tiktok: "Tk" }[m.platform]}</span><div class="text"><strong>${esc(m.user)}</strong>${m.badge ? '<span class="mod">MOD</span>' : ""}${esc(m.text)}</div><time>${time(m.at)}</time></div>`,
        )
        .join("")
    : `<div class="empty">${icon("messages-square")}<h3>${query ? "No matching messages" : "The room is quiet"}</h3><p>${query ? "Try a different search or platform." : "Start a session to connect your audiences."}</p></div>`;
  if ($("#autoscroll").checked) feed.scrollTop = feed.scrollHeight;
  else feed.scrollTop = scroll;
  icons();
}
$("#platform-filters").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  platform = b.dataset.platform;
  $$("#platform-filters button").forEach((x) =>
    x.classList.toggle("active", x === b),
  );
  renderChat();
};
$("#search").oninput = renderChat;
$("#autoscroll").onchange = renderChat;
$("#pause-chat").onclick = () => {
  paused = !paused;
  if (paused) pausedMessages = [...state.messages];
  const b = $("#pause-chat");
  b.innerHTML = icon(paused ? "play" : "pause");
  b.title = paused ? "Resume chat" : "Pause chat";
  b.setAttribute("aria-label", b.title);
  b.classList.toggle("active", paused);
  renderChat();
  icons();
};
function renderVideo() {
  const v = state.video;
  $("#buffer-detail").textContent = v.detail || "No source running";
  $("#buffer-time").textContent = `${v.seconds || 0}s / 240s`;
  $("#buffer-progress").value = v.seconds || 0;
  const active = v.state === "buffering";
  $("#preview-placeholder").hidden = active;
  const el = $("#source-video");
  el.hidden = !active;
  $(".preview-panel .pill").textContent =
    state.session.mode === "twitch"
      ? "VIDEO NOT CONNECTED"
      : "SYNTHETIC SOURCE";
  if (active && el.paused) {
    if (!el.getAttribute("src")) el.src = "/media/demo.mp4";
    el.poster = "/media/poster.jpg";
    el.play().catch(() => {});
  }
  if (!active) el.pause();
}
function renderLatest() {
  const m = state.moments[0];
  $("#rail-count").textContent = state.moments.filter(
    (m) => m.review === "pending",
  ).length;
  if (!m) return;
  $("#latest-moment").innerHTML =
    `<button class="latest-item"><span class="score-box">${m.score}</span><span><strong>${esc(m.title)}</strong><small>${esc(m.reason)}</small></span><span class="pill">${esc(m.videoState)}</span></button>`;
  $("#latest-moment button").onclick = () => {
    rememberDraft();
    reviewFilter = "all";
    $$("#review-filters button").forEach((b) =>
      b.classList.toggle("active", b.dataset.review === "all"),
    );
    selected = m.id;
    setView("clips");
  };
}
function current() {
  return state.moments.find((m) => m.id === selected);
}
function renderQueue(detail = true) {
  const previous = selected;
  const list = state.moments.filter(
    (m) => reviewFilter === "all" || m.review === reviewFilter,
  );
  if (!list.some((m) => m.id === selected)) {
    rememberDraft();
    selected = list[0]?.id || null;
  }
  $("#moment-list").innerHTML = list.length
    ? list
        .map(
          (m) =>
            `<button class="moment-card ${selected === m.id ? "selected" : ""}" data-id="${m.id}">${m.poster ? `<img src="${m.poster}" alt="Synthetic demo clip thumbnail">` : '<div class="empty">' + icon("film") + "</div>"}<div class="card-body"><h3>${esc(m.title)}</h3><small>${time(m.at)} · ${m.duration ? m.duration + "s" : "Capture pending"} · DEMO VIDEO</small><div class="card-meta"><span class="pill ${m.review === "approved" ? "good" : ""}">${esc(m.review)}</span><span>Hype <b>${m.score}</b></span></div></div></button>`,
        )
        .join("")
    : `<div class="empty">${icon("clapperboard")}<h3>No moments yet</h3><p>Audience spikes will appear here with their chat evidence.</p></div>`;
  $$(".moment-card").forEach(
    (b) =>
      (b.onclick = () => {
        rememberDraft();
        selected = b.dataset.id;
        renderQueue();
      }),
  );
  for (const card of $$(".moment-card")) {
    const m = state.moments.find((m) => m.id === card.dataset.id);
    if (!m.duration)
      card.querySelector("small").textContent =
        `${time(m.at)} · ${m.videoState} · DEMO VIDEO`;
    if (m?.mediaSource === "none")
      card.querySelector("small").textContent =
        `${time(m.at)} · Chat evidence only`;
  }
  if (detail || previous !== selected) renderDetail();
  icons();
}
function renderDetail() {
  const m = current(),
    target = $("#review-detail");
  if (!m) {
    target.innerHTML = `<div class="empty">${icon("scan-line")}<h3>A good moment starts with a signal.</h3><p>Run the demo session to capture the first audience spike.</p></div>`;
    return;
  }
  const ready = m.videoState === "ready";
  target.innerHTML = `<div class="review-title"><input class="title-input" id="moment-title" value="${esc(m.title)}" maxlength="120" aria-label="Moment title"><span class="pill amber">SYNTHETIC VIDEO</span></div><div class="review-player">${ready ? `<video id="clip-player" controls playsinline preload="metadata" poster="${m.poster}" src="${m.wide}"></video>` : `<div class="empty">${icon(["error", "cancelled", "unavailable"].includes(m.videoState) ? "circle-alert" : "film")}<h3>${esc(m.videoState)}</h3><p>${esc(m.videoError || (m.videoState === "collecting" ? "Collecting the 12-second tail of this moment." : "Rendering and verifying both video formats."))}</p>${["collecting", "rendering"].includes(m.videoState) ? '<button id="cancel-clip">Cancel capture</button>' : ""}</div>`}</div><div class="review-actions"><div>${ready ? `<a class="download" href="${m.wide}" download>${icon("download")} 16:9 MP4</a><a class="download" href="${m.vertical}" download>${icon("download")} 9:16 MP4</a><button class="icon-button" id="switch-format" title="Preview vertical version" aria-label="Preview vertical version">${icon("smartphone")}</button>` : ""}</div><div><button id="reject" ${m.review === "rejected" ? "disabled" : ""}>${icon("x")} Reject</button><button id="approve" class="primary" ${!ready || m.review === "approved" ? "disabled" : ""}>${icon("check")} ${m.review === "approved" ? "Approved" : "Approve"}</button></div></div><div class="review-columns"><section class="evidence"><h3>${icon("activity")} Why it triggered <span class="pill good">${m.score} / 100</span></h3><p>${esc(m.reason)}<br>Detected ${time(m.at)} · ${m.source === "chat spike" ? "Automatic detection" : "Manual marker"}</p><div class="evidence-chat">${m.chats
    .slice(-12)
    .map((c) => `<div><b>${esc(c.user)}</b>${esc(c.text)}</div>`)
    .join(
      "",
    )}</div></section><section class="post-editor"><h3>${icon("send")} Post package</h3><div class="segments" id="post-tabs">${["tiktok", "shorts", "reels"].map((p) => `<button data-post="${p}" class="${p === postPlatform ? "active" : ""}">${{ tiktok: "TikTok", shorts: "Shorts", reels: "Reels" }[p]} ${m.posts[p].ready ? "✓" : ""}</button>`).join("")}</div><textarea id="post-copy" maxlength="2200" aria-label="Post caption">${esc(m.posts[postPlatform].copy)}</textarea><div class="post-controls"><label><input type="checkbox" id="post-ready" ${m.posts[postPlatform].ready ? "checked" : ""}> Copy ready</label><button id="save-post">${icon("save")} Save copy</button></div><p class="post-note">Template draft · Review before publishing. Nothing is sent externally.</p><a class="download" href="/api/moments/${m.id}/package" download>${icon("package")} Export package JSON</a></section></div>`;
  const savedDraft = drafts.get(`${m.id}:${postPlatform}`);
  if (m.mediaSource === "none")
    target.querySelector(".review-title .pill").textContent =
      "NO VIDEO CONNECTED";
  if (savedDraft) {
    $("#post-copy").value = savedDraft.copy;
    $("#post-ready").checked = savedDraft.ready;
  }
  $("#post-copy").oninput = rememberDraft;
  $("#post-ready").onchange = rememberDraft;
  $("#moment-title").onchange = async (e) => {
    try {
      await api(`/api/moments/${m.id}`, "PATCH", { title: e.target.value });
      toast("Title saved");
    } catch (e) {
      toast(e.message);
    }
  };
  for (const action of ["approve", "reject"])
    $("#" + action).onclick = async () => {
      try {
        await api(`/api/moments/${m.id}`, "PATCH", {
          review: action === "approve" ? "approved" : "rejected",
        });
        renderQueue();
        toast(action === "approve" ? "Moment approved" : "Moment rejected");
      } catch (e) {
        toast(e.message);
      }
    };
  if ($("#cancel-clip"))
    $("#cancel-clip").onclick = async () => {
      try {
        await api(`/api/moments/${m.id}/cancel`, "POST");
      } catch (e) {
        toast(e.message);
      }
    };
  if (ready)
    $("#switch-format").onclick = () => {
      const player = $("#clip-player"),
        vertical = player.getAttribute("src") === m.wide;
      player.src = vertical ? m.vertical : m.wide;
      $("#switch-format").title = vertical
        ? "Preview wide version"
        : "Preview vertical version";
      $("#switch-format").setAttribute("aria-label", $("#switch-format").title);
    };
  $("#post-tabs").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    rememberDraft();
    postPlatform = b.dataset.post;
    renderDetail();
    icons();
  };
  $("#save-post").onclick = async () => {
    try {
      await saveDraft();
      toast("Post copy saved locally");
    } catch (e) {
      toast(e.message);
    }
  };
  icons();
}
async function saveDraft() {
  const m = current();
  if (!m || !$("#post-copy")) return;
  const draft = {
    copy: $("#post-copy").value,
    ready: $("#post-ready").checked,
  };
  m.posts[postPlatform] = draft;
  await api(`/api/moments/${m.id}`, "PATCH", {
    posts: { [postPlatform]: draft },
  });
  drafts.delete(`${m.id}:${postPlatform}`);
}
$("#review-filters").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  reviewFilter = b.dataset.review;
  $$("#review-filters button").forEach((x) =>
    x.classList.toggle("active", x === b),
  );
  renderQueue();
};
function openSetup() {
  $("#channel").value = state.settings?.channel || "";
  $("#setup").showModal();
}
$("#open-settings").onclick = openSetup;
$("#close-setup").onclick = () => $("#setup").close();
$("#mark-button").onclick = async () => {
  try {
    await api("/api/mark", "POST");
    toast("Moment marked. Cutting the clip.");
  } catch (e) {
    toast(e.message);
  }
};
$("#session-button").onclick = async () => {
  if (state.session.state === "stopped") return openSetup();
  try {
    await api("/api/stop", "POST");
    toast("Session stopped. Captures cancelled.");
  } catch (e) {
    toast(e.message);
  }
};
$("#setup-form").onsubmit = async (e) => {
  e.preventDefault();
  const button = $("#launch");
  button.disabled = true;
  button.textContent = "Preparing session…";
  try {
    const mode = new FormData(e.target).get("mode");
    await api("/api/start", "POST", {
      mode,
      channel: $("#channel").value.trim(),
    });
    $("#setup").close();
    toast("Session started");
  } catch (e) {
    toast(e.message);
  } finally {
    button.disabled = false;
    button.innerHTML = icon("play") + " Launch session";
    icons();
  }
};
function sync(s) {
  rememberDraft();
  state = s;
  renderSession();
  renderHealth();
  renderMetrics();
  renderChat();
  renderVideo();
  renderLatest();
  if (view === "clips") renderQueue();
  $("#setup-status").textContent = s.capabilities.ffmpeg
    ? "FFmpeg available. Demo clips are encoded and verified on this device."
    : "FFmpeg missing. Set FFMPEG_PATH before starting the demo.";
}
async function init() {
  try {
    sync(await api("/api/state"));
    if (!state.settings.setup) openSetup();
  } catch (e) {
    toast(e.message);
  }
  // Quick tunnels do not support SSE. Poll remotely without replacing the player.
  if (!["localhost", "127.0.0.1"].includes(location.hostname)) {
    const poll = async () => {
      try {
        const fresh = await api("/api/state");
        const old = current();
        const next = fresh.moments.find((m) => m.id === selected);
        state = fresh;
        renderSession();
        renderHealth();
        renderMetrics();
        renderChat();
        renderVideo();
        renderLatest();
        if (view === "clips")
          renderQueue(
            !old ||
              !next ||
              old.videoState !== next.videoState ||
              old.review !== next.review,
          );
        $("#server-health").textContent = "Remote connection";
      } catch {
        $("#server-health").textContent = "Reconnecting to Windows PC…";
      }
      setTimeout(poll, 2000);
    };
    setTimeout(poll, 2000);
    return;
  }
  const events = new EventSource("/api/events");
  events.onopen = async () => {
    $("#server-health").innerHTML =
      '<span class="dot green"></span> Local connection';
    try {
      sync(await api("/api/state"));
    } catch {}
  };
  events.onerror = () => {
    $("#server-health").textContent = "Reconnecting to local server…";
  };
  for (const type of [
    "chat",
    "metrics",
    "moment",
    "session",
    "health",
    "video",
  ])
    events.addEventListener(type, (e) => {
      const value = JSON.parse(e.data);
      if (type === "chat") {
        state.messages.push(value);
        state.messages = state.messages.slice(-600);
        if (!paused && !chatTimer)
          chatTimer = setTimeout(() => {
            chatTimer = null;
            renderChat();
          }, 100);
      }
      if (type === "metrics") {
        state.metrics = value.metrics;
        state.history = value.history;
        renderMetrics();
      }
      if (type === "moment") {
        const old = state.moments.find((m) => m.id === value.id);
        state.moments = [
          value,
          ...state.moments.filter((m) => m.id !== value.id),
        ].sort((a, b) => b.at - a.at);
        renderLatest();
        if (view === "clips")
          renderQueue(
            selected === value.id &&
              (!old ||
                old.videoState !== value.videoState ||
                old.review !== value.review),
          );
        if (!old) toast(`Moment detected · ${value.score}/100 hype`);
      }
      if (type === "session") {
        state.session = value;
        if (value.state === "running") {
          state.messages = [];
          state.history = [];
          renderChat();
        }
        renderSession();
        renderMetrics();
      }
      if (type === "health") {
        state.health = value;
        renderHealth();
      }
      if (type === "video") {
        state.video = value;
        renderVideo();
      }
    });
}
setInterval(() => {
  const seconds =
    state.session.state === "running"
      ? Math.floor((Date.now() - state.session.started) / 1000)
      : 0;
  $("#elapsed").textContent =
    `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}, 1000);
icons();
init();
