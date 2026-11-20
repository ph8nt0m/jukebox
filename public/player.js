import { connect, esc, floatEmoji, fmt, icons, lyricsView } from "./common.js";

const $ = (id) => document.getElementById(id);
const S = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

let state = { current: null, queue: [], paused: false, volume: 70 };
let player = null;
let ready = false;
let loadedId = null; // 지금 플레이어에 올린 대기열 항목 id

$("brandIcon").innerHTML = icons.note;
$("startIcon").innerHTML = icons.play;

const send = connect("player", onMessage, (up) => {
  $("status").textContent = up ? "" : "서버 연결 끊김 — 다시 연결하는 중";
});

function onMessage(msg) {
  if (msg.type === "emoji") return floatEmoji(msg.e);
  if (msg.type !== "state") return;
  state = msg.state;
  render();
  sync();
}

// 브라우저 자동재생 제한 때문에 처음 한 번은 사람이 눌러야 소리가 난다.
$("start").onclick = () => {
  $("start").hidden = true;
  document.documentElement.requestFullscreen?.().catch(() => {});
  navigator.wakeLock?.request("screen").catch(() => {});
  createPlayer();
};
// 화면이 다시 보일 때 wake lock 이 풀려 있으면 다시 잡는다.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") navigator.wakeLock?.request("screen").catch(() => {});
});

function createPlayer() {
  const make = () => {
    player = new YT.Player("yt", {
      width: "100%",
      height: "100%",
      playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, modestbranding: 1, cc_load_policy: 0, iv_load_policy: 3 },
      events: {
        onReady: () => {
          ready = true;
          sync();
        },
        onStateChange: (e) => {
          if (e.data === S.PLAYING && state.paused) player.pauseVideo();
          // 영상 자체 자막은 끈다(가사와 겹친다).
          if (e.data === S.PLAYING) player.unloadModule?.("captions");
          if (e.data === S.ENDED && loadedId) send({ type: "ended", id: loadedId });
        },
        // 임베드 금지·삭제된 영상 등 → 다음 곡으로
        onError: () => loadedId && send({ type: "error", id: loadedId }),
      },
    });
  };
  if (window.YT?.Player) make();
  else window.onYouTubeIframeAPIReady = make;
}

function sync() {
  if (!ready) return;
  const c = state.current;
  if (!c) {
    if (loadedId) player.stopVideo();
    loadedId = null;
    return;
  }
  if (c.id !== loadedId) {
    loadedId = c.id;
    player.loadVideoById(c.videoId);
  }
  player.setVolume(state.volume);
  const ps = player.getPlayerState();
  if (state.paused && ps === S.PLAYING) player.pauseVideo();
  if (!state.paused && (ps === S.PAUSED || ps === S.CUED)) player.playVideo();
}

setInterval(() => {
  if (!ready || !loadedId) return;
  const ps = player.getPlayerState();
  if (ps === S.PLAYING || ps === S.PAUSED) {
    send({ type: "progress", id: loadedId, t: player.getCurrentTime(), d: player.getDuration() });
    const d = player.getDuration();
    $("nowBar").style.width = d ? `${(player.getCurrentTime() / d) * 100}%` : "0%";
  }
  // 「오래 안 시작하면 넘기기」는 두지 않는다 — 광고 재생 중인지 IFrame API 로 알 수 없어서
  // 긴 광고 도중에 곡을 건너뛰게 된다. 재생 불가는 onError 가, 멈춤은 사람의 스킵이 맡는다.
}, 2000);

function render() {
  const c = state.current;
  $("tvBackdrop").style.backgroundImage = c ? `url("${c.thumb}")` : "none";
  $("nowLabel").innerHTML = c?.auto ? `${icons.robot}<span>자동 재생</span>` : state.paused && c ? "일시정지" : "지금 재생";
  $("nowTitle").textContent = c ? c.title : "대기열이 비어 있어요";
  $("nowSub").textContent = c
    ? `${c.channel}${state.skipVotes ? ` · 스킵 투표 ${state.skipVotes}/${state.skipNeeded}` : ""}`
    : "QR 을 찍어 첫 곡을 넣어 주세요";
  if (!c) $("nowBar").style.width = "0%";
  const shown = state.queue.slice(0, 6);
  $("queue").innerHTML = shown.length
    ? shown
        .map(
          (i, n) => `<li>
          <span class="idx">${n + 1}</span>
          <img src="${esc(i.thumb)}" alt="" />
          <div class="meta"><div class="t">${esc(i.title)}</div>
            <div class="s">${[esc(i.channel), i.duration ? fmt(i.duration) : ""].filter(Boolean).join(" · ")}${i.up ? ` · 👍 ${i.up}` : ""}</div></div>
        </li>`,
        )
        .join("") + (state.queue.length > shown.length ? `<li class="more">외 ${state.queue.length - shown.length}곡</li>` : "")
    : `<li class="more">다음 곡이 없어요</li>`;
}

// 가사: 플레이어의 실제 재생 위치에 맞춰 지금 줄을 크게 띄운다.
const lyrics = lyricsView($("lyrics"), { anchor: 0.5 });
setInterval(() => {
  const c = state.current;
  const t = ready && loadedId ? player.getCurrentTime?.() || 0 : 0;
  lyrics.update(c && ready ? c.videoId : null, t);
}, 200);

// 손님이 보낸 이모지를 화면 아래에서 위로 띄운다.
