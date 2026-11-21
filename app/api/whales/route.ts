import { getWhales } from "@/lib/whales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const data = await getWhales(fresh);
  return Response.json(data, {
    headers: {
      "Cache-Control": fresh ? "no-store" : "public, s-maxage=8, stale-while-revalidate=30",
    },
  });
}
