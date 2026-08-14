import { NextResponse } from "next/server";
import { getBuildMetadata } from "@/lib/buildMetadata";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(getBuildMetadata(), {
    headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
  });
}
