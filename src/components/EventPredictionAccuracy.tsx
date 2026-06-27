export default function EventPredictionAccuracy({
  correct,
  total,
  ongoing,
}: {
  correct: number;
  total: number;
  ongoing: boolean;
}) {
  const pct = total ? Math.round((correct / total) * 100) : 0;
  return (
    <div className="overflow-hidden rounded-2xl border border-[#1a1a1a] bg-surface px-5 py-[18px]">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[34px] font-semibold leading-none tabular-nums text-accent">
          {pct}%
        </span>
        <span className="text-[13px] text-muted">winners called</span>
      </div>
      <div className="mt-1.5 text-[12px] text-[#6b6f78]">
        {correct} of {total} completed matches{ongoing ? " so far" : ""}
      </div>
      <p className="mt-3 text-[11px] text-[#52565e]">
        Each match&apos;s win probability uses pre-event EPA (the ratings entering the event), so
        this is an unbiased check — no hindsight.
      </p>
    </div>
  );
}
