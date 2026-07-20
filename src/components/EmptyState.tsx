export function EmptyState({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-12 text-center">
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-gray-500">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
