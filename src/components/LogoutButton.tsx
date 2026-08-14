"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className ?? "text-xs text-slate-400 hover:text-white"}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/auth/logout", { method: "POST" });
          router.push("/login");
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
