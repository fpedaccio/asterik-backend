/**
 * Derive an "AI-imagined" color palette from a filter.
 *
 * Hybrid filters carry real LutParams (highlight_tint, shadow_tint, temperature, tint)
 * which we translate into stops. Gemini-direct filters (no params) fall back to a
 * deterministic hash of the prompt — so the same filter always paints the same canvas,
 * but different filters get different looks.
 */
export interface FilterPalette {
  top: string;
  mid: string;
  bottom: string;
  pop: string;     // extra vivid accent layer
  grain: number;
}

type LutTint = { r: number; g: number; b: number; mix: number };
type LutParams = {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  temperature?: number;
  tint?: number;
  highlight_tint?: LutTint;
  shadow_tint?: LutTint;
  grain?: number;
};

// Each entry: [highlight, midtone-pop, shadow, accent-bloom]
// Colors are vivid and saturated — meant to bleed into each other.
const PALETTES: [string, string, string, string][] = [
  ["#ff8c42", "#e8400c", "#0d1f3c", "#ffb347"],   // orange teal
  ["#f5c842", "#d4812b", "#1a0a2e", "#ffd700"],   // fuji 400h warm gold
  ["#c084fc", "#7c3aed", "#0f0a1e", "#e879f9"],   // dreamy violet
  ["#22d3ee", "#0891b2", "#020617", "#67e8f9"],   // moody cyan chrome
  ["#fb7185", "#e11d48", "#1c0010", "#fda4af"],   // sunset film pink
  ["#60a5fa", "#2563eb", "#020b1a", "#93c5fd"],   // winter blue cold
  ["#86efac", "#16a34a", "#051a0e", "#4ade80"],   // olive verdant
  ["#f9a8d4", "#db2777", "#1a0014", "#fbcfe8"],   // rose noir fuchsia
  ["#fbbf24", "#d97706", "#1c0900", "#fde68a"],   // vintage gold
  ["#e2e8f0", "#64748b", "#020409", "#f1f5f9"],   // bleach bypass silver
  ["#34d399", "#059669", "#011a10", "#6ee7b7"],   // emerald neon
  ["#f97316", "#c2410c", "#0c0500", "#fed7aa"],   // burnt orange
  ["#a78bfa", "#7c3aed", "#05020f", "#ddd6fe"],   // ultraviolet
  ["#38bdf8", "#0284c7", "#000d1a", "#bae6fd"],   // arctic chrome
  ["#fde68a", "#f59e0b", "#170800", "#fef3c7"],   // golden hour
  ["#f472b6", "#be185d", "#180010", "#fbcfe8"],   // cherry blossom
];

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function tintToHex(t: LutTint | undefined, fallback: string): string {
  if (!t || t.mix <= 0.02) return fallback;
  // Boost saturation of LutParams colors so they match the vivid palette energy
  const boost = 1.3;
  const r = Math.min(255, Math.round(t.r * 255 * boost));
  const g = Math.min(255, Math.round(t.g * 255 * boost));
  const b = Math.min(255, Math.round(t.b * 255 * boost));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function paletteFromFilter(filter: {
  id: string;
  prompt: string;
  params?: LutParams | Record<string, unknown> | null;
}): FilterPalette {
  const params = (filter.params ?? null) as LutParams | null;
  const seed = hashString(`${filter.id}:${filter.prompt}`);
  const [pTop, pMid, pBottom, pPop] = PALETTES[seed % PALETTES.length];

  const top    = tintToHex(params?.highlight_tint, pTop);
  const bottom = tintToHex(params?.shadow_tint,    pBottom);
  const mid    = pMid;
  const pop    = pPop;
  const grain  = params?.grain ?? 0.18;

  return { top, mid, bottom, pop, grain };
}

/**
 * Build a richly layered background. We stack six radial blooms so the colors
 * bleed and mix — the goal is "AI painted this", not "CSS gradient".
 */
export function canvasBackground(p: FilterPalette): string {
  return [
    // Highlight bloom — top centre, vivid
    `radial-gradient(110% 65% at 50% -5%, ${p.top}ee 0%, ${p.top}44 40%, transparent 65%)`,
    // Pop accent — upper right, bright halo
    `radial-gradient(60% 55% at 82% 15%, ${p.pop}cc 0%, transparent 55%)`,
    // Mid colour wash — left-centre
    `radial-gradient(75% 65% at 10% 50%, ${p.mid}bb 0%, transparent 60%)`,
    // Secondary accent — right-centre
    `radial-gradient(65% 55% at 90% 60%, ${p.top}88 0%, transparent 55%)`,
    // Deep shadow pool — bottom, rich and saturated
    `radial-gradient(140% 70% at 50% 110%, ${p.bottom}ff 0%, ${p.bottom}cc 30%, transparent 65%)`,
    // Base so thin spots never show paper-black
    `linear-gradient(175deg, ${p.mid}33 0%, ${p.bottom}cc 100%)`,
  ].join(", ");
}
