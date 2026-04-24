"use client";

import { useCallback, useRef, useState } from "react";

interface Props {
  beforeUrl: string;
  afterUrl: string;
}

export function BeforeAfterSlider({ beforeUrl, afterUrl }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(50);

  const updateFromEvent = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const raw = ((clientX - rect.left) / rect.width) * 100;
    setPct(Math.max(0, Math.min(100, raw)));
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full select-none overflow-hidden rounded-[20px]"
      style={{ background: "#0e0d0c" }}
      onMouseMove={(e) => {
        if (e.buttons === 1) updateFromEvent(e.clientX);
      }}
      onMouseDown={(e) => updateFromEvent(e.clientX)}
      onTouchMove={(e) => updateFromEvent(e.touches[0].clientX)}
      onTouchStart={(e) => updateFromEvent(e.touches[0].clientX)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={afterUrl}
        alt="After"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={beforeUrl}
          alt="Before"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>

      {/* Handle */}
      <div
        className="pointer-events-none absolute inset-y-0 w-px"
        style={{ left: `${pct}%`, background: "rgb(248 244 233 / 0.9)" }}
      >
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            width: 34,
            height: 34,
            background: "rgb(248 244 233)",
            boxShadow:
              "0 4px 20px -4px rgb(0 0 0 / 0.5), inset 0 0 0 1px rgb(0 0 0 / 0.1)",
          }}
        >
          <div className="flex h-full w-full items-center justify-center text-paper">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M9 6 L3 12 L9 18" />
              <path d="M15 6 L21 12 L15 18" />
            </svg>
          </div>
        </div>
      </div>

      <span
        className="pointer-events-none absolute left-4 top-4 rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-widest"
        style={{ background: "rgb(0 0 0 / 0.5)", color: "rgb(248 244 233 / 0.8)" }}
      >
        Before
      </span>
      <span
        className="pointer-events-none absolute right-4 top-4 rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-widest"
        style={{ background: "rgb(234 198 126 / 0.2)", color: "rgb(234 198 126)" }}
      >
        After
      </span>
    </div>
  );
}
