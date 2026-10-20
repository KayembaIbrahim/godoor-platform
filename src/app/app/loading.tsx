import { SkeletonList } from "@/components/Skeleton";

/**
 * Customer home. Data is fetched client-side from multiple endpoints, so the
 * first paint can run long before anything arrives. These placeholders keep
 * the layout from vanishing until every widget has loaded.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <SkeletonList rows={3} />
      <SkeletonGrid count={8} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCardRow key={i} />
        ))}
      </div>
    </div>
  );
}
