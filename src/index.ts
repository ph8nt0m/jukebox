import { renderSVG } from "uqr";
import { parseVideoId, resolve, search } from "./youtube";

export { Room } from "./room";

export interface Env {
  ROOM: DurableObjectNamespace<import("./room").Room>;
  ASSETS: Fetcher;
  YOUTUBE_API_KEY?: string;
  /** 관리자 화면(/admin) 비밀번호. 없으면 관리자 화면을 막는다. */
  ADMIN_PASSWORD?: string;
}

const STATIC = new Set(["/app.js", "/player.js", "/admin.js", "/common.js", "/style.css"]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

const ADMIN_COOKIE = "jb_admin";

async function sha256(text: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** 관리자 쿠키 값: 비밀번호에서 만든다(비밀번호를 바꾸면 기존 로그인이 풀린다). */
async function adminToken(env: Env) {
  const d = await sha256(`jukebox-admin:${env.ADMIN_PASSWORD}`);
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sameSecret(a: string, b: string) {
  return crypto.subtle.timingSafeEqual(await sha256(a), await sha256(b));
}

async function isAdmin(req: Request, env: Env) {
  if (!env.ADMIN_PASSWORD) return false;
  const cookie = req.headers.get("Cookie") ?? "";
  const got = cookie.match(new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE}=([0-9a-f]{64})`))?.[1];
  return !!got && (await sameSecret(got, await adminToken(env)));
}

// 손님은 `/`, 모니터는 `/tv` — 접근 제어 없음. 관리자 화면 `/admin` 만 비밀번호로 막는다.
export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const asset = (p: string) => env.ASSETS.fetch(new Request(new URL(p, url), req));

    if (path === "/") return asset("/index.html");
    if (path === "/tv") return asset("/player.html");
    if (path === "/admin") return asset("/admin.html");

    if (path === "/api/admin/login" && req.method === "POST") {
      if (!env.ADMIN_PASSWORD) return json({ error: "관리자 비밀번호가 설정되지 않았어요." }, 503);
      const body = (await req.json().catch(() => ({}))) as { password?: unknown };
      const pw = typeof body.password === "string" ? body.password : "";
      if (!(await sameSecret(pw, env.ADMIN_PASSWORD))) {
        await new Promise((r) => setTimeout(r, 1000)); // 마구 대입하기 늦추기
        return json({ error: "비밀번호가 맞지 않아요." }, 401);
      }
      const cookie = `${ADMIN_COOKIE}=${await adminToken(env)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${30 * 24 * 3600}`;
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Set-Cookie": cookie } });
    }
    if (path === "/api/admin/logout" && req.method === "POST") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", "Set-Cookie": `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` },
      });
    }
    if (path === "/api/admin/me") return (await isAdmin(req, env)) ? json({ ok: true }) : json({ error: "로그인이 필요해요." }, 401);
    if (STATIC.has(path)) return asset(path);

    // 예전 키 주소(/r/<키>/…)로 들어오면 새 주소로 보낸다.
    const old = path.match(/^\/r\/[^/]+(\/player)?\/?$/);
    if (old) return Response.redirect(new URL(old[1] ? "/tv" : "/", url).toString(), 301);

    if (path === "/ws") {
      // 관리자 연결은 쿠키를 여기서 확인한다(DO 는 role=admin 을 믿는다).
      if (url.searchParams.get("role") === "admin" && !(await isAdmin(req, env))) return new Response("Unauthorized", { status: 401 });
      return env.ROOM.get(env.ROOM.idFromName("main")).fetch(req);
    }

    if (path === "/qr.svg") {
      const svg = renderSVG(new URL("/", url).toString(), { border: 2 });
      return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
    }

    if (path === "/api/search") {
      const q = url.searchParams.get("q")?.trim() ?? "";
      if (!q) return json({ items: [], next: null });
      if (!env.YOUTUBE_API_KEY) {
        return json({ error: "검색이 설정되지 않았습니다. 유튜브 링크를 붙여넣어 주세요." }, 503);
      }
      try {
        const page = (url.searchParams.get("page") ?? "").slice(0, 200);
        return json(await search(q.slice(0, 100), env.YOUTUBE_API_KEY, ctx, page));
      } catch (e) {
        console.error(e);
        return json({ error: "검색에 실패했습니다. 잠시 뒤 다시 시도하거나 링크를 붙여넣어 주세요." }, 502);
      }
    }

    if (path === "/api/lyrics") {
      const id = url.searchParams.get("videoId") ?? "";
      const lines = await env.ROOM.get(env.ROOM.idFromName("main")).lyrics(id);
      return json({ lines }, 200);
    }

    if (path === "/api/resolve") {
      const id = parseVideoId(url.searchParams.get("url") ?? "");
      if (!id) return json({ error: "유튜브 링크가 아닙니다." }, 400);
      const t = await resolve(id, env.YOUTUBE_API_KEY);
      return t ? json(t) : json({ error: "재생할 수 없는 영상입니다." }, 404);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
