// Server-side proxy for Sui gRPC-Web calls. The node token stays on the server;
// the browser only ever talks to our own origin.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = (process.env.SUI_GRPC_UPSTREAM ?? "https://sui-mainnet.core.chainstack.com").replace(/\/+$/, "");
const FALLBACK = "https://fullnode.mainnet.sui.io:443";
const TOKEN = process.env.CHAINSTACK_SUI_TOKEN ?? "";

const ALLOWED_HOSTS = new Set(["voltswap.org", "www.voltswap.org", "beta.voltswap.org", "voltswap-v2.vercel.app"]);
const FORWARD_REQ = ["content-type", "x-grpc-web", "x-user-agent", "grpc-timeout", "accept"];
const FORWARD_RES = ["content-type", "grpc-status", "grpc-message", "cache-control"];

function originAllowed(req: Request): boolean {
  const o = req.headers.get("origin") ?? req.headers.get("referer");
  if (!o) return false;
  try {
    const u = new URL(o);
    return ALLOWED_HOSTS.has(u.hostname) || u.hostname === "localhost" || u.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  if (!originAllowed(req)) return new Response("Forbidden", { status: 403 });

  const { path } = await ctx.params;
  const target = path.join("/");
  // Only Sui gRPC services (e.g. sui.rpc.v2.LedgerService/GetBalance).
  if (!/^sui\.rpc\.[A-Za-z0-9_.]+\/[A-Za-z0-9_]+$/.test(target)) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  for (const h of FORWARD_REQ) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const base = TOKEN ? UPSTREAM : FALLBACK;
  if (TOKEN) headers.set("x-token", TOKEN);

  try {
    const up = await fetch(`${base}/${target}`, {
      method: "POST",
      headers,
      body: await req.arrayBuffer(),
      cache: "no-store",
    });
    const out = new Headers();
    for (const h of FORWARD_RES) {
      const v = up.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(up.body, { status: up.status, headers: out });
  } catch {
    return new Response("Upstream unavailable", { status: 502 });
  }
}
