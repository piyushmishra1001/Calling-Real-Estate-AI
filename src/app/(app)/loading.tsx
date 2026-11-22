export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-6 h-8 w-56 rounded-[10px] bg-[var(--bg-soft-200)]" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl border border-[var(--border-default)] bg-white" />
        ))}
      </div>
      <div className="mt-6 h-56 rounded-2xl border border-[var(--border-default)] bg-white" />
    </div>
  );
}
