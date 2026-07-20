"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RetryJobButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      className="btn-secondary text-xs"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/v1/jobs/${jobId}/retry`, { method: "POST" });
        router.refresh();
        setBusy(false);
      }}
    >
      {busy ? "Retrying..." : "Retry"}
    </button>
  );
}
