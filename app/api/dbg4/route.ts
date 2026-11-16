export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const GQL = "https://graphql.mainnet.sui.io/graphql";
async function gql(query: string, variables?: unknown) {
  const r = await fetch(GQL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20000) });
  return r.json();
}
export async function GET(req: Request) {
  const u = new URL(req.url);
  const out: Record<string, unknown> = {};
  for (const o of (u.searchParams.get("objs") ?? "").split(",").filter(Boolean)) {
    out["obj:" + o] = await gql(`query($a:SuiAddress!){ object(address:$a){ asMoveObject{ contents{ type{ repr } } } } }`, { a: o });
  }
  for (const t of (u.searchParams.get("types") ?? "").split(",").filter(Boolean)) {
    const d = (await gql(`query($t:String){ events(last:3, filter:{type:$t}){ nodes{ contents{ type{ repr } json } } } }`, { t })) as { data?: { events: { nodes: { contents: { type: { repr: string }; json: unknown } }[] } }; errors?: unknown };
    out["ev:" + t] = d.data ? d.data.events.nodes.map((n) => ({ type: n.contents.type.repr, json: n.contents.json })) : d.errors;
  }
  return Response.json(out);
}
