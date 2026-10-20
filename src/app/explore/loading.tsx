export default function Loading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6">
      <div className="h-9 w-9 animate-spin rounded-full border-2 border-border border-t-primary border-t-transparent" />
      <p className="text-sm text-muted">Loading GoDoor…</p>
    </div>
  );
}
