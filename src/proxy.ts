import { NextRequest, NextResponse } from "next/server";

/** Catalogue reads, local layout preferences and registered service controls. */
export function proxy(request: NextRequest) {
  const port = process.env.PORT || "4176";
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const host = request.headers.get("host")?.toLowerCase();
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const pathname = request.nextUrl.pathname;
  const layoutWrite = pathname === "/api/hub/layout" && request.method === "PUT";
  const serviceWrite = pathname === "/api/hub/services" && request.method === "POST";
  const localWrite = layoutWrite || serviceWrite;
  if (!host || !allowed.has(host)) return NextResponse.json({ error: "仅允许本机访问" }, { status: 403 });
  if (site === "cross-site" || site === "same-site") return NextResponse.json({ error: "跨站访问已拒绝" }, { status: 403 });
  if (origin) {
    try {
      const source = new URL(origin);
      if (source.origin !== origin || source.host.toLowerCase() !== host || source.protocol !== request.nextUrl.protocol) return NextResponse.json({ error: "跨站访问已拒绝" }, { status: 403 });
    } catch { return NextResponse.json({ error: "无效来源" }, { status: 403 }); }
  } else if (localWrite) {
    return NextResponse.json({ error: "本机操作需要同源访问" }, { status: 403 });
  }
  if (localWrite) {
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return NextResponse.json({ error: "本机操作需要 JSON" }, { status: 415 });
    return NextResponse.next();
  }
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.json({ error: "仅允许保存布局或启停已登记服务" }, { status: 405 });
  if (pathname === "/" || pathname === "/hub" || pathname === "/api/hub/catalog" || pathname === "/api/hub/asset" || pathname === "/api/hub/members" || pathname === "/api/hub/layout" || pathname === "/api/hub/services" || pathname.startsWith("/_next/") || pathname === "/favicon.ico") return NextResponse.next();
  return NextResponse.json({ error: "此入口未启用" }, { status: 404 });
}
export const config = { matcher: ["/:path*"] };
