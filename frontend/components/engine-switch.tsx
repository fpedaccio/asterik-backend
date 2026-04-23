"use client";

import type { Engine } from "@/lib/api";

interface Props {
  value: Engine;
  onChange: (v: Engine) => void;
  disabled?: boolean;
}

const OPTIONS: { key: Engine; label: string; hint: string }[] = [
  { key: "hybrid", label: "Gentle", hint: "AI picks grade, we apply it" },
  { key: "gemini", label: "Bold", hint: "AI re-renders the image" },
];

export function EngineSwitch({ value, onChange, disabled }: Props) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        padding: 4,
        background: "rgb(255 255 255 / 0.06)",
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
    >
      {OPTIONS.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            disabled={disabled}
            title={o.hint}
            style={{
              borderRadius: 999,
              padding: "6px 18px",
              fontSize: 13,
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
              transition: "background 150ms, color 150ms",
              background: active ? "rgb(248 244 233)" : "transparent",
              color: active ? "rgb(14 13 12)" : "rgb(152 147 136)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
