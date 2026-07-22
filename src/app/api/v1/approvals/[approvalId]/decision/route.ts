import { NextResponse } from "next/server";
import { withAuth, parseBody } from "@/lib/api";
import { ApprovalDecisionSchema } from "@/lib/apiSchemas";
import { decideApproval } from "@/server/services/approvals";

type Params = { approvalId: string };

export const POST = withAuth<Params>(
  "approvals.decide",
  async (req, { session }, params) => {
    const body = await parseBody(req, ApprovalDecisionSchema);
    const result = await decideApproval({
      approvalId: params.approvalId,
      orgId: session.orgId,
      decidedBy: session.userId,
      decision: body.decision,
      reasonCode: body.reasonCode,
      note: body.note,
      regenerate: body.regenerate,
    });
    return NextResponse.json({
      ok: true,
      regenerationJobId: result.regenerationJobId,
    });
  },
);
