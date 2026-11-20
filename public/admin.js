import { connect, esc, fmt, icons, searchList } from "./common.js";

// 관리자 화면: 대기열 순서 바꾸기·빼기·표 초기화, 바로 넘기기, 모두 비우기, 맨 앞에도 넣기.
// 비밀번호는 서버가 확인하고 쿠키(HttpOnly)로 기억한다. 이 화면은 비밀번호를 저장하지 않는다.
const $ = (id) => document.getElementById(id);
let state = { current: null, queue: [], paused: false, volume: 70 };
let progress = { id: null, t: 0, d: 0, at: 0 };
let send = null;

$("brandIcon").innerHTML = icons.note;
$("volIcon").innerHTML = icons.volume;
$("searchIcon").innerHTML = icons.search;

async function boot() {
  const me = await fetch("api/admin/me").catch(() => null);
  if (me?.ok) start();
  else showLogin();
}

function showLogin() {
  $("login").hidden = false;
  $("panel").hidden = true;
  $("logout").hidden = $("live").hidden = true;
  $("pw").focus();
}

$("login").onsubmit = async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  $("loginError").hidden = true;
  const res = await fetch("api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: $("pw").value }),
  }).catch(() => null);
  btn.disabled = false;
  if (res?.ok) {
    $("pw").value = "";
    start();
    return;
  }
  const body = await res?.json().catch(() => null);
  $("loginError").textContent = body?.error || "로그인하지 못했어요.";
  $("loginError").hidden = false;
};

$("logout").onclick = async () => {
  await fetch("api/admin/logout", { method: "POST" }).catch(() => {});
  location.reload();
};

function start() {
  $("login").hidden = true;
  $("panel").hidden = false;
  $("logout").hidden = $("live").hidden = false;
  if (send) return;
  send = connect("admin", onMessage, (up) => {
    if (!up) banner("서버 연결이 끊겼어요. 다시 연결하는 중… 계속되면 새로고침해서 다시 로그인해 주세요.");
  });
}

function onMessage(msg) {
  if (msg.type === "state") {
    state = msg.state;
    banner(msg.playerOnline ? "" : "모니터 플레이어가 꺼져 있어요.");
    $("live").classList.toggle("off", !msg.playerOnline);
    $("live").textContent = msg.playerOnline ? "모니터 연결됨" : "모니터 꺼짐";
    render();
  } else if (msg.type === "notice") {
    toast(msg.message);
  } else if (msg.type === "progress") {
    progress = { ...msg, at: Date.now() };
    renderProgress();
  }
}

function banner(text) {
  $("banner").hidden = !text;
  $("banner").textContent = text;
}

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2000);
}

function render() {
  const c = state.current;
  $("nowThumb").src = c ? c.thumb : "";
  $("nowThumb").style.visibility = c ? "visible" : "hidden";
  $("nowLabel").innerHTML = c?.auto ? `${icons.robot}<span>자동 재생</span>` : state.paused ? "일시정지" : "지금 재생";
  $("nowTitle").textContent = c ? c.title : "재생 중인 곡이 없어요";
  $("nowSub").textContent = c ? c.channel : "";
  $("playPause").innerHTML = state.paused || !c ? icons.play : icons.pause;
  $("playPause").disabled = $("skip").disabled = !c;
  if (document.activeElement !== $("volume")) $("volume").value = state.volume;
  $("volume").style.setProperty("--fill", `${state.volume}%`);
  $("volText").textContent = state.volume;
  renderQueue();
  renderProgress();
}

function renderQueue() {
  const q = state.queue;
  $("count").textContent = q.length ? `${q.length}곡` : "";
  $("clear").disabled = q.length === 0;
  $("queue").innerHTML = q.length
    ? q
        .map(
          (i, n) => `<li class="track" data-id="${esc(i.id)}" data-n="${n}">
          <span class="idx">${n + 1}</span>
          <img class="thumb" src="${esc(i.thumb)}" alt="" loading="lazy" />
          <div class="meta">
            <div class="t">${esc(i.title)}</div>
            <div class="s">${[esc(i.channel), i.duration ? fmt(i.duration) : ""].filter(Boolean).join(" · ")}<span class="votes">👍${i.up} 👎${i.down}</span></div>
          </div>
          <div class="acts admin-acts">
            <button data-act="top" class="icon" title="맨 앞으로" ${n === 0 ? "disabled" : ""}>${icons.top}</button>
            <button data-act="up" class="icon" title="한 칸 위로" ${n === 0 ? "disabled" : ""}>${icons.chevUp}</button>
            <button data-act="down" class="icon" title="한 칸 아래로" ${n === q.length - 1 ? "disabled" : ""}>${icons.chevDown}</button>
            <button data-act="reset" class="icon" title="따봉·붐따 초기화" ${i.up || i.down ? "" : "disabled"}>${icons.reset}</button>
            <button data-act="remove" class="icon danger" title="빼기">${icons.trash}</button>
          </div></li>`,
        )
        .join("")
    : `<li class="empty">대기열이 비어 있어요</li>`;
}

function renderProgress() {
  const c = state.current;
  const on = c && progress.id === c.id;
  const d = on && progress.d ? progress.d : c?.duration || 0;
  const t = on ? progress.t + (state.paused ? 0 : (Date.now() - progress.at) / 1000) : 0;
  $("nowBar").style.width = d ? `${Math.min(100, (t / d) * 100)}%` : "0%";
  $("nowT").textContent = c ? fmt(Math.min(t, d || t)) : "0:00";
  $("nowD").textContent = d ? fmt(d) : "";
}
setInterval(renderProgress, 1000);

$("playPause").onclick = () => send?.({ type: state.paused ? "play" : "pause" });
$("skip").onclick = () => {
  const c = state.current;
  if (c && confirm(`「${c.title}」을(를) 바로 넘길까요?`)) send?.({ type: "admin-skip" });
};
$("volume").oninput = (e) => {
  e.target.style.setProperty("--fill", `${e.target.value}%`);
  $("volText").textContent = e.target.value;
};
$("volume").onchange = (e) => send?.({ type: "volume", v: Number(e.target.value) });
$("clear").onclick = () => {
  if (confirm(`대기열 ${state.queue.length}곡을 모두 비울까요?`)) send?.({ type: "admin-clear" });
};

$("queue").onclick = (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b || b.disabled) return;
  const li = b.closest("li");
  const id = li.dataset.id;
  const n = Number(li.dataset.n);
  const item = state.queue[n];
  switch (b.dataset.act) {
    case "top":
      return send?.({ type: "admin-move", id, to: 0 });
    case "up":
      return send?.({ type: "admin-move", id, to: n - 1 });
    case "down":
      return send?.({ type: "admin-move", id, to: n + 1 });
    case "reset":
      return send?.({ type: "admin-reset", id });
    case "remove":
      if (confirm(`「${item?.title ?? "이 곡"}」을(를) 뺄까요?`)) send?.({ type: "admin-remove", id });
  }
};

// 검색 · 링크 — 관리자는 맨 앞에도 넣을 수 있다(길이·중복 검사는 손님과 같다).
const results = searchList({
  form: $("searchForm"),
  input: $("q"),
  list: $("results"),
  row: (t, n, isLink) => `<li class="track">
          <img class="thumb" src="${esc(t.thumb)}" alt="" loading="lazy" />
          <div class="meta"><div class="t">${esc(t.title)}</div>
            <div class="s">${[esc(t.channel), t.duration ? fmt(t.duration) : ""].filter(Boolean).join(" · ")}</div></div>
          <div class="acts">${
            !isLink && !t.duration
              ? `<span class="nope">라이브</span>`
              : `<button class="pill" data-n="${n}" data-top="1" title="대기열 맨 앞에 넣기">맨 앞</button>
                 <button class="add" data-n="${n}" aria-label="대기열 끝에 넣기">${icons.plus}</button>`
          }</div></li>`,
});

$("results").onclick = (e) => {
  const b = e.target.closest("button[data-n]");
  if (!b || b.disabled) return;
  const t = results.get(Number(b.dataset.n));
  send?.({ type: "admin-add", videoId: t.videoId, title: t.title, channel: t.channel, duration: t.duration, top: !!b.dataset.top });
  for (const x of b.parentElement.querySelectorAll("button")) x.disabled = true;
  const add = b.parentElement.querySelector(".add");
  add.innerHTML = icons.check;
  add.classList.add("done");
};

boot();
