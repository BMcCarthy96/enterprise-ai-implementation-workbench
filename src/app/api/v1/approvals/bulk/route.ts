import { NextResponse } from "next/server";
import { withAuth, parseBody } from "@/lib/api";
import { BulkApprovalDecisionSchema } from "@/lib/apiSchemas";
import {
  decideApprovalsBulk,
  summarizeBulkDecision,
} from "@/server/services/approvals";

/**
 * Apply one decision to a selection from the approval queue.
 *
 * Returns 200 with per-item outcomes rather than failing the whole request:
 * items are independent audited transactions, so a stale selection yields
 * partial success (see `failed[]`) instead of discarding valid decisions.
 */
export const POST = withAuth("approvals.decide", async (req, { session }) => {
  const idempotencyKey = req.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 160) {
    return NextResponse.json({ error: "Idempotency-Key header is required" }, { status: 400 });
  }
  const body = await parseBody(req, BulkApprovalDecisionSchema);
  const result = await decideApprovalsBulk({
    approvalIds: body.approvalIds,
    orgId: session.orgId,
    decidedBy: session.userId,
    decision: body.decision,
    reasonCode: body.reasonCode,
    note: body.note,
    regenerate: body.regenerate,
    idempotencyKey,
  });

  return NextResponse.json({
    ...result,
    summary: summarizeBulkDecision(result, body.decision),
  });
});
