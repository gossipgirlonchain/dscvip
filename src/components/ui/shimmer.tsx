export function Shimmer({ className = "" }: { className?: string }) {
  return (
    <div className={`shimmer rounded-[var(--radius-card)] ${className}`} />
  );
}

export function ShimmerCard() {
  return (
    <div className="bg-surface rounded-[var(--radius-card)] p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Shimmer className="w-10 h-10 rounded-full" />
        <div className="space-y-2 flex-1">
          <Shimmer className="h-4 w-1/3 rounded-[var(--radius-pill)]" />
          <Shimmer className="h-3 w-1/4 rounded-[var(--radius-pill)]" />
        </div>
      </div>
      <Shimmer className="h-5 w-2/3 rounded-[var(--radius-pill)]" />
      <Shimmer className="h-4 w-full rounded-[var(--radius-pill)]" />
      <div className="flex justify-between items-center">
        <Shimmer className="h-8 w-20 rounded-[var(--radius-pill)]" />
        <Shimmer className="h-10 w-28 rounded-[var(--radius-button)]" />
      </div>
    </div>
  );
}
