import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { searchWorkbench } from "@/server/services/search";

/**
 * Global search for the ⌘K palette. Open to any authenticated user; the result
 * types are gated by role inside searchWorkbench and every query is org-scoped.
 * Reads are not audited (consistent with the other GET endpoints).
 */
export const GET = withAuth(null, async (req, { session }) => {
  const query = req.nextUrl.searchParams.get("q") ?? "";
  const results = await searchWorkbench({
    orgId: session.orgId,
    role: session.role,
    query,
  });
  return NextResponse.json({ query: query.trim(), results });
});
