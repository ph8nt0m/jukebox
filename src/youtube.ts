export type Track = {
  videoId: string;
  title: string;
  channel: string;
  duration: number; // 초, 모르면 0
  thumb: string;
};

const VIDEO_ID = /^[\w-]{11}$/;

export function isVideoId(v: unknown): v is string {
  return typeof v === "string" && VIDEO_ID.test(v);
}

/** youtube.com/watch?v=, youtu.be/, music.youtube.com, shorts/, embed/ 링크에서 영상 ID 를 뽑는다. */
export function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (isVideoId(s)) return s;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return isVideoId(id) ? id : null;
  }
  if (host === "youtube.com" || host === "music.youtube.com") {
    const v = url.searchParams.get("v");
    if (isVideoId(v)) return v;
    const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/);
    if (m) return m[1];
  }
  return null;
}

function parseDuration(iso: string | undefined): number {
  const m = iso?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const [, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

type VideosResponse = {
  items?: {
    id: string;
    snippet: { title: string; channelTitle: string; thumbnails?: Record<string, { url: string }> };
    contentDetails: { duration: string };
    status?: { embeddable?: boolean };
  }[];
};

async function videosById(ids: string[], key: string): Promise<Track[]> {
  if (ids.length === 0) return [];
  const u = new URL("https://www.googleapis.com/youtube/v3/videos");
  u.searchParams.set("part", "snippet,contentDetails,status");
  u.searchParams.set("id", ids.join(","));
  u.searchParams.set("key", key);
  const res = await fetch(u);
  if (!res.ok) throw new Error(`YouTube videos.list ${res.status}`);
  const body = (await res.json()) as VideosResponse;
  const byId = new Map(
    (body.items ?? [])
      .filter((v) => v.status?.embeddable !== false)
      .map((v) => [
        v.id,
        {
          videoId: v.id,
          title: v.snippet.title,
          channel: v.snippet.channelTitle,
          duration: parseDuration(v.contentDetails.duration),
          thumb: v.snippet.thumbnails?.medium?.url ?? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
        } satisfies Track,
      ]),
  );
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/** 검색 1회 = search.list 100 units + videos.list 1 unit. 같은 검색어는 하루 캐시한다. */
export type SearchPage = { items: Track[]; next: string | null };

/** 한 쪽(25곡) 검색. search.list 는 결과 수와 관계없이 한 번에 100 units 라 한 쪽을 넉넉히 받는다. next 로 다음 쪽. */
export async function search(q: string, key: string, ctx: ExecutionContext, pageToken = ""): Promise<SearchPage> {
  const norm = q.trim().toLowerCase().replace(/\s+/g, " ");
  const cacheKey = new Request(`https://jukebox.cache/search2?q=${encodeURIComponent(norm)}&page=${encodeURIComponent(pageToken)}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return (await hit.json()) as SearchPage;

  const u = new URL("https://www.googleapis.com/youtube/v3/search");
  u.searchParams.set("part", "id");
  u.searchParams.set("type", "video");
  u.searchParams.set("videoEmbeddable", "true");
  u.searchParams.set("videoCategoryId", "10"); // 음악 — 뉴스·숏츠가 섞이지 않게
  u.searchParams.set("maxResults", "25");
  if (pageToken) u.searchParams.set("pageToken", pageToken);
  u.searchParams.set("q", norm);
  u.searchParams.set("key", key);
  const res = await fetch(u);
  if (!res.ok) throw new Error(`YouTube search.list ${res.status}`);
  const body = (await res.json()) as { items?: { id: { videoId?: string } }[]; nextPageToken?: string };
  const ids = (body.items ?? []).flatMap((i) => (isVideoId(i.id.videoId) ? [i.id.videoId] : []));
  const page: SearchPage = { items: await videosById(ids, key), next: body.nextPageToken ?? null };

  ctx.waitUntil(
    cache.put(cacheKey, new Response(JSON.stringify(page), { headers: { "Cache-Control": "max-age=86400" } })),
  );
  return page;
}

/** 링크로 넣은 곡의 제목을 찾는다. API 키가 없으면 키가 필요 없는 oEmbed 로 제목만 얻는다. */
export async function resolve(videoId: string, key: string | undefined): Promise<Track | null> {
  if (key) {
    const [t] = await videosById([videoId], key);
    return t ?? null;
  }
  const u = new URL("https://www.youtube.com/oembed");
  u.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`);
  u.searchParams.set("format", "json");
  const res = await fetch(u);
  if (!res.ok) return null;
  const o = (await res.json()) as { title: string; author_name: string };
  return {
    videoId,
    title: o.title,
    channel: o.author_name,
    duration: 0,
    thumb: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
  };
}
