import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GQL_URL = "https://graphql.mainnet.sui.io/graphql";

const QUERY = `
  query ($a: SuiAddress!, $after: String) {
    address(address: $a) {
      objects(first: 50, after: $after, filter: { type: "0x2::coin::Coin" }) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          address
          version
          digest
          contents {
            type { repr }
            json
          }
        }
      }
    }
  }
`;

function extractInnerCoinType(repr: string): string | null {
  const m = repr.match(/^0x0*2::coin::Coin<(.+)>$/i);
  return m ? m[1] : null;
}

export async function GET(req: NextRequest) {
  const owner = req.nextUrl.searchParams.get("owner")?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(owner)) {
    return Response.json({ error: "Invalid Sui address" }, { status: 400 });
  }

  const coins: {
    coinType: string;
    coinObjectId: string;
    balance: string;
    version: string;
    digest: string;
  }[] = [];

  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const r = await fetch(GQL_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { a: owner, after } }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) {
      return Response.json({ error: `Sui GraphQL ${r.status}` }, { status: 502 });
    }
    const j = (await r.json()) as {
      data?: {
        address?: {
          objects?: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: {
              address: string;
              version: number | string;
              digest: string;
              contents?: { type?: { repr?: string }; json?: { balance?: string } } | null;
            }[];
          };
        };
      };
      errors?: { message: string }[];
    };
    if (j.errors?.length) {
      return Response.json({ error: j.errors[0].message }, { status: 502 });
    }
    const objs = j.data?.address?.objects;
    if (!objs) break;

    for (const n of objs.nodes) {
      const repr = n.contents?.type?.repr;
      if (!repr) continue;
      const coinType = extractInnerCoinType(repr);
      if (!coinType) continue;
      coins.push({
        coinType,
        coinObjectId: n.address,
        balance: String(n.contents?.json?.balance ?? "0"),
        version: String(n.version),
        digest: n.digest,
      });
    }

    if (!objs.pageInfo.hasNextPage || !objs.pageInfo.endCursor) break;
    after = objs.pageInfo.endCursor;
  }

  return Response.json({ coins }, { headers: { "Cache-Control": "no-store" } });
}
