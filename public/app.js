import { connect, esc, floatEmoji, fmt, icons, lyricsView, searchList } from "./common.js";

const $ = (id) => document.getElementById(id);
let state = { current: null, queue: [], paused: false, volume: 70 };
let progress = { id: null, t: 0, d: 0, at: 0 };

// 투표·「내 곡」 구분용 익명 기기 id(이름과 무관한 무작위 값). 한 기기 한 표.
const voter = localStorage.getItem("jukeboxVoter") || crypto.randomUUID();
localStorage.setItem("jukeboxVoter", voter);
const need = () => state.votesNeeded || 3;

// 고정 아이콘
$("brandIcon").innerHTML = icons.note;
$("skipIcon").innerHTML = icons.next;
$("volIcon").innerHTML = icons.volume;
$("searchIcon").innerHTML = icons.search;
let online = true;

const send = connect(
  "guest",
  onMessage,
  (up) => {
    if (!up) banner("서버 연결이 끊겼어요. 다시 연결하는 중…");
  },
  { voter },
);

function onMessage(msg) {
  if (msg.type === "state") {
    state = msg.state;
    online = !!msg.playerOnline;
    banner(online ? "" : "모니터 플레이어가 꺼져 있어요. 곡은 쌓이고, 플레이어가 켜지면 재생돼요.");
    render();
  } else if (msg.type === "emoji") {
    floatEmoji(msg.e);
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
  const sub = c ? c.channel : "아래에서 곡을 검색해 넣어 주세요";
  $("nowThumb").src = c ? c.thumb : "";
  $("hero").classList.toggle("empty", !c);
  $("backdrop").style.backgroundImage = c ? `url("${c.thumb}")` : "none";
  $("nowLabel").innerHTML = c?.auto ? `${icons.robot}<span>자동 재생 — 대기열이 비어서 골랐어요</span>` : c?.mine ? "지금 재생 · 내 곡" : "지금 재생";
  $("nowTitle").textContent = c ? c.title : "대기열이 비어 있어요";
  $("nowSub").textContent = sub;
  $("live").classList.toggle("off", !online);
  $("live").textContent = online ? "모니터 연결됨" : "모니터 꺼짐";

  const playIcon = state.paused || !c ? icons.play : icons.pause;
  $("playPause").innerHTML = playIcon;
  $("miniPlay").innerHTML = playIcon;
  $("playPause").disabled = $("miniPlay").disabled = $("skip").disabled = !c;

  const skipNeed = state.skipNeeded || need();
  const votesShown = c && !c.mine && skipNeed > 1;
  $("skip").classList.toggle("voted", !!state.mySkipVote);
  $("skipCount").hidden = !votesShown;
  $("skipCount").textContent = votesShown ? `${state.skipVotes || 0}/${skipNeed}` : "";
  $("skip").title = c?.mine ? "내가 넣은 곡은 바로 넘길 수 있어요" : c?.auto ? "자동 재생 곡은 한 명만 눌러도 넘어가요" : state.mySkipVote ? "다시 누르면 투표 취소" : `${skipNeed}명이 누르면 다음 곡으로`;

  if (document.activeElement !== $("volume")) $("volume").value = state.volume;
  $("volume").style.setProperty("--fill", `${state.volume}%`);

  $("miniArt").src = c ? c.thumb : "";
  $("miniTitle").textContent = c ? c.title : "대기열이 비어 있어요";
  $("miniSub").textContent = sub;
  $("mini").hidden = heroVisible || !c;

  renderQueue();
  renderProgress();
}

function renderQueue() {
  $("count").textContent = state.queue.length ? `${state.queue.length}곡` : "";
  $("clear").hidden = state.queue.length === 0;
  $("clear").textContent = `모두 비우기 ${state.clearVotes || 0}/${need()}`;
  $("clear").classList.toggle("voted", !!state.myClearVote);
  $("queue").innerHTML = state.queue.length
    ? state.queue
        .map(
          (i, n) => `<li class="track" data-id="${esc(i.id)}">
          <span class="idx">${n + 1}</span>
          <img class="thumb" src="${esc(i.thumb)}" alt="" loading="lazy" />
          <div class="meta">
            <div class="t">${esc(i.title)}</div>
            <div class="s">${i.mine ? `<span class="tag">내 곡</span>` : ""}${[esc(i.channel), i.duration ? fmt(i.duration) : ""].filter(Boolean).join(" · ")}</div>
          </div>
          <div class="acts">
            <button data-act="up" class="react up ${i.myReaction === 1 ? "on" : ""}" title="${i.mine ? "내 곡 — 수만 오르고 자리는 그대로" : "따봉 — 한 칸 위로"}">${icons.up}<span>${i.up}</span></button>
            <button data-act="down" class="react down ${i.myReaction === -1 ? "on" : ""}" title="${i.mine ? "내 곡 — 자리는 그대로" : "붐따 — 한 칸 아래로"}, ${need()}개면 사라져요">${icons.down}<span>${i.down}/${need()}</span></button>
            ${i.mine ? `<button data-act="remove" class="icon" title="내가 넣은 곡 — 바로 빼기">${icons.close}</button>` : ""}
          </div></li>`,
        )
        .join("")
    : `<li class="empty">다음 곡이 없어요. 아래에서 검색해 첫 곡을 넣어 보세요.</li>`;
}

/** 모니터가 보낸 재생 위치를 지금 시각까지 이어 계산한 값(초). */
function playedSeconds() {
  const c = state.current;
  if (!c || progress.id !== c.id) return 0;
  return progress.t + (state.paused ? 0 : (Date.now() - progress.at) / 1000);
}

function renderProgress() {
  const c = state.current;
  const on = c && progress.id === c.id;
  const d = on && progress.d ? progress.d : c?.duration || 0;
  const t = playedSeconds();
  const pct = d ? `${Math.min(100, (t / d) * 100)}%` : "0%";
  $("nowBar").style.width = pct;
  $("miniBar").style.width = pct;
  $("nowT").textContent = c ? fmt(Math.min(t, d || t)) : "0:00";
  $("nowD").textContent = d ? fmt(d) : "";
}
setInterval(renderProgress, 1000);

// 가사: 지금 줄을 위쪽 1/3 에 두고, 줄이 바뀌면 부드럽게 밀어 올린다.
const lyrics = lyricsView($("lyrics"), { anchor: 0.3 });
setInterval(() => lyrics.update(online ? state.current?.videoId ?? null : null, playedSeconds()), 250);

$("playPause").onclick = $("miniPlay").onclick = () => send({ type: state.paused ? "play" : "pause" });
$("volume").oninput = (e) => e.target.style.setProperty("--fill", `${e.target.value}%`);

// 위 「지금 재생」이 화면 밖으로 나가면 아래 미니 재생 바를 띄운다.
let heroVisible = true;
new IntersectionObserver(([en]) => {
  heroVisible = en.isIntersecting;
  $("mini").hidden = heroVisible || !state.current;
}).observe(
  document.querySelector(".transport"),
);
$("skip").onclick = () => {
  const c = state.current;
  if (!c) return;
  send({ type: "skip", id: c.id });
  if (!c.mine && !c.auto) toast(state.mySkipVote ? "스킵 투표를 취소했어요" : "스킵에 투표했어요");
};
$("volume").onchange = (e) => send({ type: "volume", v: Number(e.target.value) });
$("clear").onclick = () => {
  if (!state.myClearVote && !confirm(`다음 곡을 모두 비우는 데 투표할까요? ${need()}명이 누르면 비워져요.`)) return;
  send({ type: "clear" });
};
$("queue").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const id = b.closest("li").dataset.id;
  if (b.dataset.act === "remove") send({ type: "remove", id });
  if (b.dataset.act === "up") send({ type: "react", id, v: 1 });
  if (b.dataset.act === "down") send({ type: "react", id, v: -1 });
};

// 이모지 반응 — 모니터와 모두의 화면에 떠오른다
$("emojis").onclick = (e) => {
  const b = e.target.closest("button[data-e]");
  if (!b) return;
  send({ type: "emoji", e: b.dataset.e });
  b.classList.remove("pop");
  void b.offsetWidth; // 애니메이션 다시 시작
  b.classList.add("pop");
};

// 검색 · 링크 붙여넣기 — 끝까지 내리면 다음 결과를 이어 불러온다.
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
              ? `<span class="nope" title="라이브는 넣을 수 없어요">라이브</span>`
              : `<button class="add" data-n="${n}" aria-label="대기열에 넣기">${icons.plus}</button>`
          }</div></li>`,
});

$("results").onclick = (e) => {
  const b = e.target.closest("button.add");
  if (!b || b.disabled) return;
  const t = results.get(Number(b.dataset.n));
  send({ type: "add", videoId: t.videoId, title: t.title, channel: t.channel, duration: t.duration });
  b.innerHTML = icons.check;
  b.classList.add("done");
  b.disabled = true;
  toast(`「${t.title}」 넣는 중…`);
};
