import { DurableObject } from "cloudflare:workers";
import { isVideoId, resolve } from "./youtube";
import { findLyrics, type LyricLine } from "./lyrics";
import type { Env } from "./index";

export type Item = {
  id: string;
  videoId: string;
  title: string;
  channel: string;
  duration: number;
  thumb: string;
  /** 넣은 기기의 익명 id. 밖으로 내보내지 않고 「내 곡인지」만 알려 준다. */
  by?: string;
  /** 넣은 순서. 따봉·붐따 점수가 같으면 먼저 넣은 곡이 앞이다. */
  seq?: number;
  /** 대기열에 있는 동안 받은 따봉 수(재생을 시작할 때 고정). 자동 재생 고르기에 쓴다. */
  likes?: number;
  /** 대기열이 비어 자동으로 고른 곡 */
  auto?: boolean;
};

/** 재생 기록 한 줄. 자동 재생 후보 고르기에 쓴다. */
type Played = Pick<Item, "videoId" | "title" | "channel" | "duration" | "thumb"> & {
  likes: number;
  playedAt: number;
  /** 스킵·재생 오류로 끝났으면 true — 자동 재생 후보에서 뺀다 */
  skipped: boolean;
};

type State = {
  current: Item | null;
  queue: Item[];
  paused: boolean;
  volume: number;
  /** 지금 곡 스킵에 투표한 기기. 곡이 바뀌면 비운다. */
  skipVotes: string[];
  /** 대기열 곡 id → { 기기: 1(따봉) | -1(붐따) }. 곡이 대기열을 떠나면 지운다. */
  reactions: Record<string, Record<string, 1 | -1>>;
  /** 다음에 넣을 곡의 seq */
  nextSeq: number;
  /** 「모두 비우기」에 투표한 기기. 비우거나 곡이 바뀌면 비운다. */
  clearVotes: string[];
  /** 손님이 마지막으로 접속·조작한 시각. 1시간 넘게 없으면 자동 재생을 멈춘다(빈 사무실에서 밤새 틀지 않게). */
  lastActivity: number;
};

/** 서버 코드 판 번호. 배포 뒤 DO 가 새 코드로 바뀌었는지 `/ws` 첫 state 의 `codeVersion` 으로 확인한다. 서버를 고치면 올린다. */
const CODE_VERSION = 5;
const MAX_QUEUE = 300;
/** 스킵·모두 비우기에 필요한 표 수, 그리고 곡을 없애는 붐따 수 */
export const VOTES_NEEDED = 3;
const HOUR = 60 * 60 * 1000;
const WEEK = 7 * 24 * HOUR;
const MAX_HISTORY = 500;
/** 이모지 반응: 고를 수 있는 것과 기기당 1초에 보낼 수 있는 수 */
const EMOJIS = ["🔥", "👏", "😂", "💃", "❤️", "🙌"];
const EMOJI_PER_SEC = 3;

const EMPTY: State = {
  current: null,
  queue: [],
  paused: false,
  volume: 70,
  skipVotes: [],
  reactions: {},
  nextSeq: 1,
  clearVotes: [],
  lastActivity: 0,
};

type Msg = Record<string, unknown> & { type?: unknown };
type Attachment = { voter: string };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** 표를 넣거나(없으면) 빼고(있으면) 새 목록을 돌려준다. */
const toggle = (votes: string[], voter: string) =>
  votes.includes(voter) ? votes.filter((v) => v !== voter) : [...votes, voter];

/** 방 하나(=모니터 하나)의 대기열 정본. 손님·플레이어가 WebSocket 으로 붙는다. */
export class Room extends DurableObject<Env> {
  private state: State = EMPTY;
  private history: Played[] = [];
  /** 이모지 연타 막기(메모리만, 잠들면 비워져도 된다) */
  private emojiTimes = new Map<string, number[]>();
  /** 같은 곡 가사를 동시에 여러 번 찾지 않게(메모리만) */
  private lyricJobs = new Map<string, Promise<LyricLine[] | null>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<Partial<State>>("state");
      this.state = { ...structuredClone(EMPTY), ...saved };
      this.history = (await ctx.storage.get<Played[]>("history")) ?? [];
      delete (this.state as { removeVotes?: unknown }).removeVotes; // 붐따로 바뀌기 전 빼기 투표
      delete (this.state as { adds?: unknown }).adds; // 없앤 「1시간에 5곡」 제한의 기록
      for (const i of this.state.queue) i.seq ??= this.state.nextSeq++;
      // 익명 전환 전에 저장된 신청자 이름을 지운다.
      for (const i of [this.state.current, ...this.state.queue]) if (i) delete (i as { addedBy?: string }).addedBy;
      // 없앤 모니터 연결 코드 기능이 남긴 값을 지운다.
      const pairs = await ctx.storage.list({ prefix: "pair:" });
      if (pairs.size) await ctx.storage.delete([...pairs.keys()]);
    });
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const url = new URL(req.url);
    // role=admin 은 Worker 가 관리자 쿠키를 확인한 뒤에만 넘어온다.
    const asked = url.searchParams.get("role");
    const role = asked === "player" || asked === "admin" ? asked : "guest";
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ voter: role === "admin" ? "" : str(url.searchParams.get("voter"), 64) } satisfies Attachment);
    if (role === "guest") this.state.lastActivity = Date.now();
    if (role === "player") this.broadcast();
    else server.send(this.snapshot(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > 4096) return;
    let msg: Msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const s = this.state;
    const id = str(msg.id, 64);
    const voter = (ws.deserializeAttachment() as Attachment | null)?.voter || str(msg.voter, 64);
    const notice = (message: string) => safeSend(ws, JSON.stringify({ type: "notice", message }));
    const tags = this.ctx.getTags(ws);
    if (tags.includes("guest")) s.lastActivity = Date.now();
    if (typeof msg.type === "string" && msg.type.startsWith("admin-")) {
      if (!tags.includes("admin")) return;
      if (!(await this.adminAction(msg, notice))) return;
      this.pruneVotes();
      await this.ctx.storage.put("state", this.state);
      this.broadcast();
      return;
    }

    switch (msg.type) {
      case "emoji": {
        // 모니터와 모든 손님 화면에 띄울 이모지. 저장하지 않고 흘리기만 한다(보낸 사람도 받는다).
        const e = EMOJIS.includes(msg.e as string) ? (msg.e as string) : null;
        if (!e || !voter) return;
        const now = Date.now();
        const times = (this.emojiTimes.get(voter) ?? []).filter((t) => now - t < 1000);
        if (times.length >= EMOJI_PER_SEC) return;
        this.emojiTimes.set(voter, [...times, now]);
        // n: 한 번에 터뜨릴 개수(1~5). 꾹 누르면 손님 화면이 이 메시지를 0.35초마다 보낸다.
        const n = Math.min(5, Math.max(1, Math.floor(Number(msg.n) || 1)));
        const out = JSON.stringify({ type: "emoji", e, n });
        for (const p of this.ctx.getWebSockets()) safeSend(p, out);
        return;
      }
      case "progress": {
        // 플레이어가 몇 초마다 보내는 재생 위치. 저장하지 않고 손님에게만 흘린다.
        if (!this.ctx.getTags(ws).includes("player")) return;
        const out = JSON.stringify({ type: "progress", id, t: Number(msg.t) || 0, d: Number(msg.d) || 0 });
        for (const g of [...this.ctx.getWebSockets("guest"), ...this.ctx.getWebSockets("admin")]) safeSend(g, out);
        return;
      }
      case "add": {
        if (!isVideoId(msg.videoId)) return;
        if (s.queue.length >= MAX_QUEUE) return notice("대기열이 가득 찼어요.");
        // 중복은 YouTube 조회 전에 본다(할당량 아끼기).
        const unfair = this.checkFair(msg.videoId, voter);
        if (unfair) return notice(unfair);
        const track = await this.checkTrack(msg.videoId, msg);
        if (typeof track === "string") return notice(track);
        // await 사이에 같은 곡이 들어왔을 수 있어 다시 본다.
        const again = this.checkFair(msg.videoId, voter);
        if (again) return notice(again);
        const item: Item = { id: crypto.randomUUID(), ...track, by: voter, seq: this.state.nextSeq++ };
        // await 사이에 상태가 바뀌었을 수 있으니 this.state 를 다시 본다.
        if (this.state.current) this.state.queue.push(item);
        else {
          this.state.current = item;
          this.state.paused = false;
        }
        break;
      }
      case "remove": {
        // 내가 넣은 곡만 바로 뺄 수 있다. 남의 곡은 붐따 VOTES_NEEDED 개로 사라진다.
        const item = s.queue.find((i) => i.id === id);
        if (!item || !voter || item.by !== voter) return;
        s.queue = s.queue.filter((i) => i !== item);
        break;
      }
      case "react": {
        // 따봉(1)은 한 칸 위로, 붐따(-1)는 한 칸 아래로. 같은 걸 다시 누르면 취소(한 칸 되돌림),
        // 반대를 누르면 바꾼다(두 칸). 내 곡에도 누를 수 있지만 자리는 안 바뀐다. 붐따가 VOTES_NEEDED 개 모이면 사라진다.
        const item = s.queue.find((i) => i.id === id);
        const v = msg.v === 1 || msg.v === -1 ? msg.v : null;
        if (!item || !voter || !v) return;
        const r = (s.reactions[id] ??= {});
        const before = r[voter] ?? 0;
        if (before === v) delete r[voter];
        else r[voter] = v;
        const downs = Object.values(r).filter((x) => x === -1).length;
        if (downs >= VOTES_NEEDED) s.queue = s.queue.filter((i) => i !== item);
        // 내 곡에 누른 표는 수만 오르고 자리는 그대로다(스스로 끌어올리지 못하게).
        else if (item.by !== voter) this.move(item, before - (r[voter] ?? 0));
        break;
      }
      case "skip": {
        // 내 곡은 바로, 자동 재생 곡은 1표, 남의 곡은 VOTES_NEEDED 표가 모이면 넘긴다. 다시 누르면 취소.
        if (s.current?.id !== id || !voter) return;
        if (s.current.by === voter) {
          this.advance(true);
          break;
        }
        s.skipVotes = toggle(s.skipVotes, voter);
        if (s.skipVotes.length >= this.skipNeeded()) this.advance(true);
        break;
      }
      case "clear": {
        if (!voter || s.queue.length === 0) return;
        s.clearVotes = toggle(s.clearVotes, voter);
        if (s.clearVotes.length >= VOTES_NEEDED) {
          s.queue = [];
          s.clearVotes = [];
        }
        break;
      }
      // 곡 끝·재생 오류는 "지금 곡이 id 일 때만" 넘긴다 — 중복 보고가 와도 한 곡만 넘어간다.
      case "ended":
      case "error": {
        if (s.current?.id !== id) return;
        this.advance(msg.type === "error");
        break;
      }
      case "pause":
        s.paused = true;
        break;
      case "play":
        s.paused = false;
        break;
      case "volume":
        s.volume = Math.max(0, Math.min(100, Math.round(Number(msg.v) || 0)));
        break;
      default:
        return;
    }
    this.pruneVotes();
    await this.ctx.storage.put("state", this.state);
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      // 1005·1006 은 보낼 수 없는 예약 코드다.
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {}
    if (this.ctx.getTags(ws).includes("player")) this.broadcast(ws);
  }

  async webSocketError(ws: WebSocket) {
    if (this.ctx.getTags(ws).includes("player")) this.broadcast(ws);
  }

  /**
   * 지금·대기열 곡(또는 최근 재생 곡)의 싱크 가사. 찾은 결과는 DO 저장소에 7일(못 찾음은 1일) 두어
   * 모니터·손님 여럿이 열어도 가사 DB 에는 곡당 한 번만 묻는다.
   */
  async lyrics(videoId: string): Promise<LyricLine[] | null> {
    if (!isVideoId(videoId)) return null;
    const key = `lyrics:${videoId}`;
    const cached = await this.ctx.storage.get<{ lines: LyricLine[] | null; at: number }>(key);
    if (cached && Date.now() - cached.at < (cached.lines ? WEEK : 24 * HOUR)) return cached.lines;
    const item =
      [this.state.current, ...this.state.queue].find((i) => i?.videoId === videoId) ??
      [...this.history].reverse().find((h) => h.videoId === videoId);
    if (!item) return null;
    let job = this.lyricJobs.get(videoId);
    if (!job) {
      job = findLyrics(item.title, item.channel, item.duration)
        .catch(() => null)
        .then(async (lines) => {
          await this.ctx.storage.put(key, { lines, at: Date.now() });
          return lines;
        })
        .finally(() => this.lyricJobs.delete(videoId));
      this.lyricJobs.set(videoId, job);
    }
    return job;
  }

  /** 관리자 명령. 상태를 바꿨으면 true. 표 수·공정 장치 제한 없이 바로 적용한다. */
  private async adminAction(msg: Msg, notice: (m: string) => void): Promise<boolean> {
    const s = this.state;
    const id = str(msg.id, 64);
    const item = s.queue.find((i) => i.id === id);
    switch (msg.type) {
      case "admin-move": {
        // to: 옮길 자리(0 = 맨 앞)
        if (!item) return false;
        const to = Math.floor(Number(msg.to));
        if (!Number.isFinite(to)) return false;
        this.move(item, Math.max(0, to) - s.queue.indexOf(item));
        return true;
      }
      case "admin-remove":
        if (!item) return false;
        s.queue = s.queue.filter((i) => i !== item);
        return true;
      case "admin-reset":
        // 그 곡의 따봉·붐따를 모두 지운다(자리는 그대로).
        if (!item) return false;
        delete s.reactions[id];
        return true;
      case "admin-skip":
        if (!s.current) return false;
        this.advance(true);
        return true;
      case "admin-clear":
        s.queue = [];
        s.clearVotes = [];
        return true;
      case "admin-add": {
        // 손님과 같은 길이·중복 검사로 넣는다. top 이면 맨 앞에.
        if (!isVideoId(msg.videoId)) return false;
        if (s.queue.length >= MAX_QUEUE) return notice("대기열이 가득 찼어요."), false;
        const videoId = msg.videoId as string;
        const dup = () => s.current?.videoId === videoId || s.queue.some((i) => i.videoId === videoId);
        if (dup()) return notice("이미 대기열에 있는 곡이에요."), false;
        const track = await this.checkTrack(videoId, msg);
        if (typeof track === "string") return notice(track), false;
        if (dup()) return notice("이미 대기열에 있는 곡이에요."), false;
        const added: Item = { id: crypto.randomUUID(), ...track, seq: s.nextSeq++ };
        if (!s.current) {
          s.current = added;
          s.paused = false;
        } else if (msg.top) s.queue.unshift(added);
        else s.queue.push(added);
        notice(`「${added.title}」 넣었어요.`);
        return true;
      }
      default:
        return false;
    }
  }

  /** 넣을 곡의 길이를 YouTube 에 직접 확인한다(손님이 보낸 길이는 믿지 않는다). 거절이면 안내 문구. */
  private async checkTrack(videoId: string, msg: Msg): Promise<Omit<Item, "id" | "by"> | string> {
    const key = this.env.YOUTUBE_API_KEY;
    const t = key
      ? await resolve(videoId, key).catch(() => null)
      : {
          videoId,
          title: str(msg.title, 200) || videoId,
          channel: str(msg.channel, 100),
          duration: Math.max(0, Math.floor(Number(msg.duration) || 0)),
          thumb: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        };
    if (!t) return "재생할 수 없는 영상이에요.";
    if (key && t.duration === 0) return "라이브처럼 길이를 알 수 없는 영상은 넣을 수 없어요.";
    return t;
  }

  /** 이미 대기열·지금 재생에 있는 곡은 다시 넣지 못한다. 통과면 null. */
  private checkFair(videoId: string, voter: string): string | null {
    const s = this.state;
    if (!voter) return "새로고침한 뒤 다시 넣어 주세요.";
    if (s.current?.videoId === videoId || s.queue.some((i) => i.videoId === videoId)) return "이미 대기열에 있는 곡이에요.";
    return null;
  }

  private skipNeeded() {
    return this.state.current?.auto ? 1 : VOTES_NEEDED;
  }

  /** 지금 곡을 기록하고 다음 곡으로. 대기열이 비면 자동 재생 곡을 고른다. */
  private advance(skipped = false) {
    const s = this.state;
    if (s.current) this.record(s.current, skipped);
    const next = s.queue.shift() ?? null;
    if (next) next.likes = Object.values(s.reactions[next.id] ?? {}).filter((x) => x === 1).length;
    s.current = next ?? this.pickAuto();
    s.paused = false;
    s.skipVotes = [];
    s.clearVotes = [];
  }

  private record(item: Item, skipped: boolean) {
    const { videoId, title, channel, duration, thumb } = item;
    this.history.push({ videoId, title, channel, duration, thumb, likes: item.likes ?? 0, playedAt: Date.now(), skipped });
    if (this.history.length > MAX_HISTORY) this.history = this.history.slice(-MAX_HISTORY);
    void this.ctx.storage.put("history", this.history);
  }

  /** 지난 7일 재생 기록에서 고른다. 따봉을 많이 받은 곡일수록 잘 뽑히고, 최근 1시간 곡·마지막에 스킵된 곡은 뺀다. */
  private pickAuto(): Item | null {
    const now = Date.now();
    if (now - this.state.lastActivity > HOUR) return null;
    const recent = new Set(this.history.filter((h) => now - h.playedAt < HOUR).map((h) => h.videoId));
    const byVideo = new Map<string, { last: Played; likes: number }>();
    for (const h of this.history) {
      if (now - h.playedAt > WEEK) continue;
      const c = byVideo.get(h.videoId) ?? { last: h, likes: 0 };
      c.last = h;
      c.likes += h.likes;
      byVideo.set(h.videoId, c);
    }
    const pool = [...byVideo.values()].filter((c) => !recent.has(c.last.videoId) && !c.last.skipped);
    if (pool.length === 0) return null;
    let r = Math.random() * pool.reduce((a, c) => a + 1 + c.likes, 0);
    const pick = pool.find((c) => (r -= 1 + c.likes) < 0) ?? pool[pool.length - 1];
    const { videoId, title, channel, duration, thumb } = pick.last;
    return { id: crypto.randomUUID(), videoId, title, channel, duration, thumb, auto: true, likes: 0 };
  }

  /** 대기열을 떠난 곡의 따봉·붐따를 지운다. */
  private pruneVotes() {
    const ids = new Set(this.state.queue.map((i) => i.id));
    for (const k of Object.keys(this.state.reactions)) if (!ids.has(k)) delete this.state.reactions[k];
  }

  /** 대기열에서 by 칸 옮긴다(음수 = 위로). 맨 위·맨 아래에서 멈춘다. */
  private move(item: Item, by: number) {
    const q = this.state.queue;
    const from = q.indexOf(item);
    const to = Math.max(0, Math.min(q.length - 1, from + by));
    if (from < 0 || to === from) return;
    q.splice(from, 1);
    q.splice(to, 0, item);
  }

  /** 받는 기기마다 「내 곡·내 표」를 표시해 보낸다. 다른 기기 id 는 내보내지 않는다. */
  private snapshot(to: WebSocket, closing?: WebSocket) {
    const voter = (to.deserializeAttachment() as Attachment | null)?.voter || "";
    const s = this.state;
    const view = (i: Item) => {
      const r = Object.values(s.reactions[i.id] ?? {});
      const { by, seq, likes, ...rest } = i;
      return {
        ...rest,
        mine: !!voter && by === voter,
        up: r.filter((x) => x === 1).length,
        down: r.filter((x) => x === -1).length,
        myReaction: s.reactions[i.id]?.[voter] ?? 0,
      };
    };
    const playerOnline = this.ctx
      .getWebSockets("player")
      .some((w) => w !== closing && w.readyState === WebSocket.OPEN);
    const state = {
      current: s.current && view(s.current),
      queue: s.queue.map(view),
      paused: s.paused,
      volume: s.volume,
      skipVotes: s.skipVotes.length,
      skipNeeded: this.skipNeeded(),
      mySkipVote: s.skipVotes.includes(voter),
      clearVotes: s.clearVotes.length,
      myClearVote: s.clearVotes.includes(voter),
      votesNeeded: VOTES_NEEDED,
      codeVersion: CODE_VERSION,
    };
    return JSON.stringify({ type: "state", state, playerOnline });
  }

  private broadcast(closing?: WebSocket) {
    for (const w of this.ctx.getWebSockets()) if (w !== closing) safeSend(w, this.snapshot(w, closing));
  }
}

function safeSend(ws: WebSocket, data: string) {
  try {
    ws.send(data);
  } catch {}
}
