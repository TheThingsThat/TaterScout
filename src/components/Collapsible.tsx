"use client";

import { useState } from "react";

/** A collapsible (dropdown) section. The `header` is the click target; an
 *  optional `right` slot (e.g. a toggle) sits beside it and shows only when open. */
export default function Collapsible({
  header,
  right,
  defaultOpen = true,
  gap = "mb-3.5",
  children,
}: {
  header: React.ReactNode;
  right?: React.ReactNode;
  defaultOpen?: boolean;
  gap?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className={`flex items-center justify-between gap-3 ${gap}`}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-[#6b6f78] transition-transform"
            style={{ transform: open ? "rotate(90deg)" : "none" }}
          >
            <polyline points="9 6 15 12 9 18" />
          </svg>
          {header}
        </button>
        {open && right}
      </div>
      {open && children}
    </div>
  );
}
