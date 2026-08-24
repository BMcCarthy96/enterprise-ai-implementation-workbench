import { NextResponse } from "next/server";
import { withAuth, parseBody } from "@/lib/api";
import { ApprovalDecisionSchema } from "@/lib/apiSchemas";
import { uuidParam } from "@/server/services/access";
import { decideApproval } from "@/server/services/approvals";

type Params = { approvalId: string };

export const POST = withAuth<Params>(
  "approvals.decide",
  async (req, { session }, params) => {
    const approvalId = uuidParam(params.approvalId, "approvalId");
    const body = await parseBody(req, ApprovalDecisionSchema);
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 160) {
      return NextResponse.json({ error: "Idempotency-Key header is required" }, { status: 400 });
    }
    const result = await decideApproval({
      approvalId,
      orgId: session.orgId,
      decidedBy: session.userId,
      decision: body.decision,
      reasonCode: body.reasonCode,
      note: body.note,
      regenerate: body.regenerate,
      idempotencyKey,
    });
    return NextResponse.json({
      ok: true,
      regenerationJobId: result.regenerationJobId,
      regenerationQueued: result.regenerationQueued === true,
    });
  },
);
