import { NextResponse } from "next/server";
import { buildOpenApiDocument } from "@/lib/openapi";

/** Public, read-only API contract. */
export async function GET() {
  return NextResponse.json(buildOpenApiDocument());
}
