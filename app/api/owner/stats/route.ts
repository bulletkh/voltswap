import { getOwnerStats } from "@/lib/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Everything here is derived from public on-chain data about the treasury address.
export async function GET() {
  try {
    const data = await getOwnerStats();
    return Response.json(data, { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "failed" }, { status: 502 });
  }
}
