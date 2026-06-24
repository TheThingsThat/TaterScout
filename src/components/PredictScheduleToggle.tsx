"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

export default function PredictScheduleToggle({
  value,
  realAvailable,
}: {
  value: "real" | "sim";
  realAvailable: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function set(v: "real" | "sim") {
    const p = new URLSearchParams(sp.toString());
    p.set("sched", v);
    router.push(`${pathname}?${p.toString()}`, { scroll: false });
  }

  const opts: { v: "real" | "sim"; label: string; disabled?: boolean }[] = [
    { v: "real", label: "Real schedule", disabled: !realAvailable },
    { v: "sim", label: "Simulated" },
  ];

  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-[#232323]">
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => !o.disabled && set(o.v)}
          disabled={o.disabled}
          className="px-3 py-1.5 text-[12px] transition-colors disabled:opacity-30"
          style={
            value === o.v
              ? { background: "var(--accent)", color: "#fff" }
              : { background: "transparent", color: "#9aa0aa" }
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
