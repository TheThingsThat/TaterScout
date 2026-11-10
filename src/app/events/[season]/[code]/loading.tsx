// Shown at once on navigation while the page's FIRST reads and predictions run, so
// a click visibly lands instead of seeming to do nothing.
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1240px] space-y-7 px-5 pb-6 pt-10 sm:px-8">
      <div className="h-[170px] animate-pulse rounded-[20px] border border-border bg-surface" />
      <div className="card h-40 animate-pulse" />
    </div>
  );
}
