"use client";

import { canvasBackground, paletteFromFilter } from "@/lib/filter-gradient";
import type { FilterResponse } from "@/lib/api";

interface Props {
  filter: Pick<FilterResponse, "id" | "prompt" | "params">;
  /** Overlay the actual preview image at low opacity so there's a hint of the real grade. */
  previewUrl?: string | null;
  className?: string;
  /** If false, render static (no animation) — useful for dense grids. */
  animated?: boolean;
}

/**
 * The "AI-painted canvas" — a vertically elongated frame whose body is a
 * gradient derived from the filter's color grade (real LutParams when present,
 * deterministic-from-prompt otherwise). When given a previewUrl, we layer the
 * actual preview image on top at low opacity for extra authenticity.
 */
export function FilterCanvas({ filter, previewUrl, className, animated = true }: Props) {
  const palette = paletteFromFilter(filter);
  const bg = canvasBackground(palette);

  return (
    <div
      className={`relative overflow-hidden ${className ?? ""}`}
      style={{
        aspectRatio: "3 / 5",
        borderRadius: 20,
        backgroundColor: "#0e0d0c",
        boxShadow:
          "inset 0 0 0 1px rgb(255 255 255 / 0.06), 0 10px 30px -15px rgb(0 0 0 / 0.6)",
      }}
    >
      {/* The painted canvas */}
      <div
        aria-hidden
        className={animated ? "filter-canvas-anim absolute inset-0" : "absolute inset-0"}
        style={{ background: bg, filter: "saturate(1.1)" }}
      />

      {/* Optional real preview layered on top — barely visible, evocative */}
      {previewUrl && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={previewUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity: 0.22, mixBlendMode: "overlay" }}
        />
      )}

      {/* Inner frame / paspartú — reinforces the "rectangular frame" feel */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-2 rounded-[14px]"
        style={{ boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.08)" }}
      />

      {/* Soft film grain so it doesn't look CG */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 mix-blend-overlay"
        style={{
          opacity: 0.25 + palette.grain * 0.4,
          backgroundImage:
            "radial-gradient(rgb(255 255 255 / 0.3) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
        }}
      />
    </div>
  );
}
