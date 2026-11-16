import { getWhales } from "@/lib/whales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const data = await getWhales();
  return Response.json(data, {
    headers: { "Cache-Control": "public, s-maxage=8, stale-while-revalidate=30" },
  });
}
