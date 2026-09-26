import { NextResponse } from "next/server";
import { privateKnowledgeStats } from "@/lib/private-knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await privateKnowledgeStats(), { headers: { "Cache-Control": "no-store" } });
}
