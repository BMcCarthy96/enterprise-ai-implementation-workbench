export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f2f6fb] px-6">
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm" role="status" aria-live="polite">
        <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-cyan-600 motion-reduce:animate-none" />
        Loading Workbench…
      </div>
    </main>
  );
}
