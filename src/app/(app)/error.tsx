"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[55vh] max-w-xl items-center justify-center">
      <section className="card w-full p-7 text-center" role="alert">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Workspace error</p>
        <h1 className="mt-3 text-xl font-semibold text-slate-950">We could not load this view</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Retry the request, or continue from a stable workspace surface. Unsaved changes were not applied.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" className="btn-primary" onClick={() => reset()}>Retry</button>
          <Link href="/dashboard" className="btn-secondary">Dashboard</Link>
        </div>
      </section>
    </div>
  );
}
