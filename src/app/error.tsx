"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
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
    <main className="flex min-h-screen items-center justify-center bg-[#f2f6fb] px-6">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm" role="alert">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-sm font-bold text-rose-700">!</div>
        <h1 className="mt-4 text-xl font-semibold text-slate-950">That page hit an unexpected error</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Your workspace is safe. Try the request again, or return to the dashboard and continue from the last saved checkpoint.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" className="btn-primary" onClick={() => reset()}>Try again</button>
          <Link href="/dashboard" className="btn-secondary">Back to dashboard</Link>
        </div>
      </section>
    </main>
  );
}
