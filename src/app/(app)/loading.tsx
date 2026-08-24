export default function AppLoading() {
  return (
    <div
      className="mx-auto max-w-7xl space-y-6"
      role="status"
      aria-live="polite"
      aria-label="Loading workspace"
    >
      <div className="h-8 w-52 animate-pulse rounded-lg bg-slate-200 motion-reduce:animate-none" />
      <div className="grid gap-4 md:grid-cols-3">
        {["one", "two", "three"].map((key) => (
          <div key={key} className="card h-28 animate-pulse bg-slate-100 motion-reduce:animate-none" />
        ))}
      </div>
      <div className="card min-h-64 animate-pulse bg-slate-100 motion-reduce:animate-none" />
      <span className="sr-only">Loading workspace content</span>
    </div>
  );
}
