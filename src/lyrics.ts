// 재생 시간에 맞춘 가사(LRC)를 공개 가사 DB LRCLIB(https://lrclib.net, 키 없음)에서 찾는다.
// 유튜브 제목은 「가수 - 곡 (Official MV)」, 「가수 '곡' MV」, 「곡」(Topic 채널) 처럼 제각각이라
// 꾸밈말을 걷어 낸 몇 가지 검색어로 찾고, 영상 길이와 가장 가까운 싱크 가사를 고른다.

export type LyricLine = { t: number; text: string };

type Candidate = { trackName: string; artistName: string; duration: number; syncedLyrics: string | null; instrumental?: boolean };

const UA = "jukebox-worker/1.0 (internal office jukebox)";
/** 영상 길이와 가사 곡 길이 차이가 이보다 크면 다른 곡으로 본다(뮤직비디오 앞뒤 장면을 감안해 넉넉히). */
const MAX_DIFF = 45;

const NOISE =
  /\b(official|music|video|m\/?v|mv|audio|lyrics?|lyric video|visuali[sz]er|performance|live|clip|hd|4k|remaster(ed)?|full|ver\.?|version|teaser|special|color coded)\b|가사|뮤직비디오|공식|직캠/gi;

const NOISE_ONE = new RegExp(NOISE.source, "i"); // test 용(g 플래그는 lastIndex 를 남긴다)

/** 괄호·꺾쇠 안의 꾸밈말과 「|」 뒤를 걷어 낸다. */
function clean(s: string) {
  return s
    .replace(/\s*[|｜].*$/, "")
    .replace(/[\[(【（][^\])】）]*[\])】）]/g, (m) => (NOISE_ONE.test(m) || /feat|ft\./i.test(m) ? " " : m))
    .replace(NOISE, " ")
    .replace(/["“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 검색어 후보들. 앞의 것일수록 정확하다. */
export function queries(title: string, channel: string): string[] {
  const out: string[] = [];
  const t = clean(title);
  const topic = channel.match(/^(.*) - Topic$/)?.[1];
  if (topic) out.push(`${topic} ${t}`);
  // 가수 'Song' 꼴(케이팝 공식 채널)
  const quoted = t.match(/^(.*?)\s*['‘’]([^'‘’]+)['‘’]/);
  if (quoted) out.push(`${quoted[1].replace(/\([^)]*\)/g, "").trim()} ${quoted[2]}`);
  // 가수 - Song 꼴
  const dash = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) out.push(`${dash[1].replace(/\([^)]*\)/g, "").trim()} ${dash[2].replace(/\([^)]*\)/g, "").trim()}`);
  out.push(t);
  // 「영문 제목 (한글 제목)」: 괄호를 뺀 것과 괄호 안 것으로도 찾는다.
  const paren = t.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (paren) {
    const artist = topic ? `${topic} ` : "";
    out.push(`${artist}${paren[1]}`, `${artist}${paren[2]}`);
  }
  if (!topic && channel && !/vevo|official|labels|music|entertainment|records|1thek|stone|mnet|kbs|sbs|mbc/i.test(channel)) {
    out.push(`${channel} ${t}`);
  }
  return [...new Set(out.map((q) => q.replace(/\s+/g, " ").trim()).filter((q) => q.length >= 2))].slice(0, 5);
}

export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const s of stamps) lines.push({ t: Number(s[1]) * 60 + Number(s[2]), text });
  }
  return lines.sort((a, b) => a.t - b.t);
}

/** 찾으면 줄 목록, 없으면 null. */
export async function findLyrics(title: string, channel: string, duration: number): Promise<LyricLine[] | null> {
  for (const q of queries(title, channel)) {
    const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, { headers: { "User-Agent": UA } }).catch(() => null);
    if (!res?.ok) continue;
    const list = ((await res.json().catch(() => [])) as Candidate[]).filter((c) => c.syncedLyrics && !c.instrumental);
    if (!list.length) continue;
    const scored = list
      .map((c) => ({ c, diff: duration ? Math.abs(c.duration - duration) : 0 }))
      .filter((x) => x.diff <= MAX_DIFF)
      .sort((a, b) => a.diff - b.diff);
    const best = scored[0]?.c;
    if (best?.syncedLyrics) {
      const lines = parseLrc(best.syncedLyrics);
      if (lines.length >= 4) return lines;
    }
  }
  return null;
}
