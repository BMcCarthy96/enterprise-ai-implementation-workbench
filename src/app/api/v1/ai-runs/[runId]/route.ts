import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { uuidParam } from "@/server/services/access";
import { getAiEvidencePacket } from "@/server/services/aiEvidence";

type Params = { runId: string };

export const GET = withAuth<Params>("audit.view", async (_req, { session }, params) => {
  const runId = uuidParam(params.runId, "runId");
  const packet = await getAiEvidencePacket(session.orgId, runId);
  if (!packet) {
    return NextResponse.json({ error: "AI run not found" }, { status: 404 });
  }
  return NextResponse.json(packet);
});
