import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f2f6fb] px-6">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">404 · Not found</p>
        <h1 className="mt-3 text-xl font-semibold text-slate-950">That checkpoint does not exist</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">The link may be stale or the project may have been removed. Use the dashboard or public proof hub to find a current path.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/dashboard" className="btn-primary">Open dashboard</Link>
          <Link href="/proof" className="btn-secondary">View proof hub</Link>
        </div>
      </section>
    </main>
  );
}
