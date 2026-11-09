const SKELETON_GRID_CLASS =
  "grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

export default function Loading() {
  return (
    <div className="lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div className="hidden rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/[0.03] lg:block">
        <div className="h-6 w-40 animate-pulse rounded bg-gray-200" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-8 w-full animate-pulse rounded bg-gray-100"
            />
          ))}
        </div>
        <div className="mt-5 h-3 w-24 animate-pulse rounded bg-gray-200" />
        <div className="mt-3 space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="h-6 w-full animate-pulse rounded bg-gray-100"
            />
          ))}
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="h-8 w-40 animate-pulse rounded bg-gray-200" />
        <div className="h-10 w-full animate-pulse rounded bg-gray-200" />
        <div className="h-24 w-full animate-pulse rounded bg-gray-200 sm:h-16" />
        <div className={SKELETON_GRID_CLASS} aria-label="Loading listings">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/[0.03]"
            >
              <div className="aspect-square animate-pulse bg-gray-200" />
              <div className="space-y-2 p-3">
                <div className="h-5 w-20 animate-pulse rounded bg-gray-200" />
                <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-gray-200" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
