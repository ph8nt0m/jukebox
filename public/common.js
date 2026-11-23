// 손님·플레이어 공용: 끊기면 다시 붙는 WebSocket, 시간 표시, HTML 이스케이프.

export function connect(role, onMessage, onStatus, params = {}) {
  let ws;
  let retry = 0;
  const queue = [];
  const url = new URL(`ws?role=${role}`, location.href);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";

  function open() {
    ws = new WebSocket(url);
    ws.onopen = () => {
      retry = 0;
      onStatus?.(true);
      while (queue.length) ws.send(queue.shift());
    };
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      onStatus?.(false);
      setTimeout(open, Math.min(10000, 500 * 2 ** retry++));
    };
  }
  open();

  return function send(msg) {
    const data = JSON.stringify(msg);
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
    else queue.push(data);
  };
}

export function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// 화면 아이콘(SVG). currentColor 를 따른다.
const svg = (d, vb = "0 0 24 24") => `<svg viewBox="${vb}" aria-hidden="true" fill="currentColor">${d}</svg>`;
export const icons = {
  play: svg('<path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z"/>'),
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'),
  next: svg('<path d="M5 5.5v13a1 1 0 0 0 1.55.83L15 13.7V18a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v4.3L6.55 4.67A1 1 0 0 0 5 5.5z"/>'),
  search: svg('<path d="M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.25 4.24a1 1 0 0 1-1.42 1.42l-4.24-4.25A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"/>'),
  plus: svg('<path d="M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1z"/>'),
  check: svg('<path d="M9.5 16.17 5.33 12a1 1 0 0 0-1.41 1.41l4.87 4.88a1 1 0 0 0 1.42 0L20.08 8.41A1 1 0 0 0 18.67 7L9.5 16.17z"/>'),
  close: svg('<path d="M6.7 5.3 12 10.6l5.3-5.3a1 1 0 1 1 1.4 1.4L13.4 12l5.3 5.3a1 1 0 0 1-1.4 1.4L12 13.4l-5.3 5.3a1 1 0 0 1-1.4-1.4l5.3-5.3-5.3-5.3a1 1 0 0 1 1.4-1.4z"/>'),
  up: svg('<path d="M2 21h3V9H2v12zm19.7-9.6c.2-.4.3-.8.3-1.3 0-1.7-1.3-3-3-3h-4.8l.7-3.4v-.3c0-.5-.2-1-.5-1.3L13.3 1 7.6 6.6C7.2 7 7 7.5 7 8v11c0 1.1.9 2 2 2h8.3c.8 0 1.5-.5 1.8-1.2l2.6-8.4z"/>'),
  down: svg('<path d="M22 3h-3v12h3V3zM2.3 12.6c-.2.4-.3.8-.3 1.3 0 1.7 1.3 3 3 3h4.8l-.7 3.4v.3c0 .5.2 1 .5 1.3l1.1 1.1 5.7-5.6c.4-.4.6-.9.6-1.4V5c0-1.1-.9-2-2-2H6.7c-.8 0-1.5.5-1.8 1.2l-2.6 8.4z"/>'),
  volume: svg('<path d="M4 9v6h4l5 5V4L8 9H4zm12.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z"/>'),
  note: svg('<path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>'),
  top: svg('<path d="M5 4a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1zm6.3 3.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1-1.4 1.4L13 10.4V20a1 1 0 1 1-2 0v-9.6l-3.3 3.3a1 1 0 0 1-1.4-1.4l5-5z"/>'),
  chevUp: svg('<path d="M11.3 8.3a1 1 0 0 1 1.4 0l6 6a1 1 0 0 1-1.4 1.4L12 10.4l-5.3 5.3a1 1 0 0 1-1.4-1.4l6-6z"/>'),
  chevDown: svg('<path d="M5.3 8.3a1 1 0 0 1 1.4 0l5.3 5.3 5.3-5.3a1 1 0 1 1 1.4 1.4l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.4z"/>'),
  reset: svg('<path d="M12 5a7 7 0 1 1-6.93 8H3.05A9 9 0 1 0 6 5.3V3a1 1 0 0 0-2 0v5a1 1 0 0 0 1 1h5a1 1 0 0 0 0-2H7.4A6.97 6.97 0 0 1 12 5z"/>'),
  trash: svg('<path d="M9 3a1 1 0 0 0-1 1v1H4a1 1 0 0 0 0 2h1v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7h1a1 1 0 1 0 0-2h-4V4a1 1 0 0 0-1-1H9zm1 6a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1zm4 0a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1z"/>'),
  robot: svg('<path d="M12 2a1 1 0 0 1 1 1v1h4a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h4V3a1 1 0 0 1 1-1zM9 9.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM8 15a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2H8z"/>'),
};

// 이모지 n 개가 화면 아래에서 조금씩 시차를 두고 떠오른다(#emojiLayer 필요).
export function floatEmoji(e, n = 1) {
  const layer = document.getElementById("emojiLayer");
  const x = 10 + Math.random() * 80; // 한 묶음은 비슷한 자리에서 퍼진다
  for (let i = 0; i < n; i++) {
    setTimeout(() => {
      if (layer.childElementCount > 120) return;
      const el = document.createElement("span");
      el.className = "floater";
      el.textContent = e;
      el.style.left = `${Math.min(95, Math.max(2, x + (Math.random() - 0.5) * 24))}%`;
      el.style.setProperty("--drift", `${(Math.random() - 0.5) * 180}px`);
      el.style.setProperty("--size", (0.75 + Math.random() * 0.5).toFixed(2));
      el.style.animationDuration = `${2.8 + Math.random() * 1.6}s`;
      el.addEventListener("animationend", () => el.remove());
      layer.appendChild(el);
    }, i * 90);
  }
}

// 검색 한 번에 불러오는 쪽 수 상한. 쪽마다 YouTube 할당량 101 units(하루 10,000 을 회사 전체가 나눠 씀)라 약 100곡에서 멈춘다.
const MAX_PAGES = 4;

// 검색·링크 붙여넣기 목록. 목록 끝에 닿으면 다음 쪽을 이어 불러온다(무한 스크롤, MAX_PAGES 쪽까지).
// row(track, index, isLink) 가 한 줄 HTML 을 돌려준다. 돌려주는 get(n) 으로 n 번째 곡을 꺼낸다.
export function searchList({ form, input, list, row }) {
  let items = [];
  let next = null;
  let pages = 0;
  let query = "";
  let isLink = false;
  let loading = false;
  let run = 0; // 새 검색을 하면 이전 검색의 늦은 응답은 버린다

  // 목록 끝 표지. 쪽마다 새로 만들어 관찰한다(같은 요소를 다시 붙이면 교차 알림이 다시 오지 않을 때가 있다).
  let sentinel = null;
  const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && more(), { rootMargin: "400px 0px" });
  function dropSentinel() {
    io.disconnect();
    sentinel?.remove();
    sentinel = null;
  }

  function paint(from) {
    dropSentinel();
    if (from === 0) list.innerHTML = items.length ? "" : `<li class="empty">결과가 없어요</li>`;
    list.insertAdjacentHTML("beforeend", items.slice(from).map((t, i) => row(t, from + i, isLink)).join(""));
    if (next) {
      sentinel = document.createElement("li");
      sentinel.className = "empty loading more";
      sentinel.textContent = "더 불러오는 중…";
      list.appendChild(sentinel);
      io.observe(sentinel);
    }
  }

  async function fetchPage(token) {
    const url = isLink
      ? `api/resolve?url=${encodeURIComponent(query)}`
      : `api/search?q=${encodeURIComponent(query)}${token ? `&page=${encodeURIComponent(token)}` : ""}`;
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    return isLink ? { items: [body], next: null } : body;
  }

  async function more() {
    if (loading || !next) return;
    loading = true;
    const mine = run;
    try {
      const page = await fetchPage(next);
      if (mine !== run) return;
      const from = items.length;
      const seen = new Set(items.map((t) => t.videoId));
      items = items.concat(page.items.filter((t) => !seen.has(t.videoId)));
      next = ++pages < MAX_PAGES ? page.next : null;
      paint(from);
    } catch (err) {
      if (mine !== run) return;
      next = null;
      dropSentinel();
      list.insertAdjacentHTML("beforeend", `<li class="empty">${esc(err.message || "더 불러오지 못했어요")}</li>`);
    } finally {
      if (mine === run) loading = false;
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    input.blur();
    const mine = ++run;
    dropSentinel();
    query = q;
    isLink = /youtu\.?be/.test(q);
    items = [];
    next = null;
    loading = true;
    list.innerHTML = `<li class="empty loading">${isLink ? "링크 확인 중…" : "검색 중…"}</li>`;
    try {
      const page = await fetchPage("");
      if (mine !== run) return;
      items = page.items;
      pages = 1;
      next = page.next;
      paint(0);
    } catch (err) {
      if (mine !== run) return;
      list.innerHTML = `<li class="empty">${esc(err.message || "실패했어요")}</li>`;
    } finally {
      if (mine === run) loading = false;
    }
  });

  return { get: (n) => items[n] };
}

// 가사: 서버(/api/lyrics)가 찾아 둔 싱크 가사를 곡마다 한 번 받아 온다. 없으면 null.
const lyricCache = new Map();
export function fetchLyrics(videoId) {
  if (!lyricCache.has(videoId)) {
    lyricCache.set(
      videoId,
      fetch(`api/lyrics?videoId=${encodeURIComponent(videoId)}`)
        .then((r) => {
          if (!r.ok) throw new Error(`lyrics ${r.status}`);
          return r.json();
        })
        .then((b) => (Array.isArray(b.lines) && b.lines.length ? b.lines : null))
        .catch(() => {
          // 네트워크·서버 오류는 기억하지 않고 잠시 뒤 다시 묻는다(「가사 없음」만 기억한다).
          setTimeout(() => lyricCache.delete(videoId), 15000);
          return null;
        }),
    );
  }
  return lyricCache.get(videoId);
}

/** t 초에 부르는 줄 번호(첫 줄 전이면 -1). */
export function lyricIndex(lines, t) {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t + 0.2) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * 가사 표시기. 곡의 모든 줄을 세로로 한 번 그려 두고, 줄이 바뀌면 목록을 부드럽게 밀어 올려
 * 지금 줄을 box 안 anchor 높이(0 = 맨 위, 1 = 맨 아래)에 맞춘다. 지금 줄은 밝게·조금 크게 바뀐다.
 * update(videoId, t) 를 자주 불러 준다. 가사가 없는 곡이면 box 를 숨긴다.
 */
export function lyricsView(box, { anchor = 0.35 } = {}) {
  let videoId = null;
  let lines = null;
  let index = null;
  const track = document.createElement("div");
  track.className = "ly-track";
  box.replaceChildren(track);

  function place(animate) {
    const i = Math.max(0, index ?? 0);
    const el = track.children[i];
    if (!el) return;
    const y = box.clientHeight * anchor - (el.offsetTop + el.offsetHeight / 2);
    track.style.transition = animate ? "" : "none";
    track.style.transform = `translateY(${Math.round(y)}px)`;
    if (!animate) void track.offsetHeight; // 즉시 적용한 뒤 다음부터 다시 애니메이션
    track.style.transition = "";
  }

  function setIndex(i) {
    if (i === index) return;
    const prev = index;
    index = i;
    const rows = track.children;
    for (let k = 0; k < rows.length; k++) {
      rows[k].classList.toggle("cur", k === i);
      rows[k].classList.toggle("past", k < i);
      rows[k].classList.toggle("soon", k === i + 1);
    }
    // 한두 줄 넘어가면 흐르듯, 크게 건너뛰면(처음·되감기) 바로 맞춘다.
    place(prev !== null && Math.abs(i - prev) <= 3);
  }

  function build(l) {
    lines = l;
    index = null;
    track.innerHTML = l.map((line) => `<div class="ly">${esc(line.text) || "♪"}</div>`).join("");
    box.hidden = false;
    setIndex(-1);
  }

  new ResizeObserver(() => lines && place(false)).observe(box);

  return {
    update(id, t) {
      if (id !== videoId) {
        videoId = id;
        lines = null;
        index = null;
        track.innerHTML = "";
        box.hidden = true;
        if (!id) return;
        fetchLyrics(id).then((l) => {
          if (videoId === id && l) build(l);
        });
        return;
      }
      if (lines) setIndex(lyricIndex(lines, t));
    },
  };
}
