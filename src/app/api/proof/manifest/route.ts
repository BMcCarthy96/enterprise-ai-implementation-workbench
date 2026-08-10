import { NextResponse } from "next/server";
import { getProofManifest } from "@/lib/proof";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getProofManifest(), {
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
