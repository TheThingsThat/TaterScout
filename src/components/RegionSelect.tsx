"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

export default function RegionSelect({
  regions,
  value,
}: {
  regions: string[];
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(sp.toString());
    const v = e.target.value;
    if (v) params.set("region", v);
    else params.delete("region");
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="relative">
      <select
        value={value}
        onChange={onChange}
        aria-label="Filter by region"
        className="cursor-pointer rounded-full border border-[#232323] bg-[#0c0c0c] py-[9px] pl-4 pr-9 text-[14px] text-foreground outline-none focus:border-accent"
      >
        <option value="">All regions</option>
        {regions.map((r) => (
          <option key={r} value={r} style={{ background: "#0c0c0c" }}>
            {r}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] text-[#6b6f78]">
        ▼
      </span>
    </div>
  );
}
