"use client";

import { Camera } from "lucide-react";
import { useCallback, useRef } from "react";

interface Props {
  onFileSelected: (file: File, previewUrl: string) => void;
  compact?: boolean;
}

export function ImageUploader({ onFileSelected, compact }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const url = URL.createObjectURL(file);
      onFileSelected(file, url);
    },
    [onFileSelected]
  );

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 14,
          borderRadius: 16, border: "1px solid rgb(255 255 255 / 0.08)",
          background: "rgb(22 21 19)", padding: "14px 18px",
          cursor: "pointer", textAlign: "left",
        }}
      >
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: "radial-gradient(closest-side, rgb(234 198 126 / 0.18), transparent 80%)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Camera size={22} strokeWidth={1.4} style={{ color: "rgb(210 205 193)" }} />
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 15, color: "rgb(248 244 233)" }}>Start with a photo</p>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "rgb(152 147 136)" }}>Tap to pick or take one</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      className="group relative flex aspect-[3/4] w-full flex-col items-center justify-center gap-6 overflow-hidden rounded-[28px] border text-center transition active:scale-[0.99]"
      style={{
        borderColor: "rgb(255 255 255 / 0.08)",
        background:
          "radial-gradient(120% 80% at 50% -10%, rgb(234 198 126 / 0.08) 0%, transparent 55%), rgb(22 21 19)",
      }}
    >
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{ background: "radial-gradient(closest-side, rgb(234 198 126 / 0.2), transparent 70%)" }}
        />
        <Camera size={44} strokeWidth={1.2} style={{ color: "rgb(210 205 193)" }} />
      </div>

      <div className="space-y-1 px-8">
        <p className="font-display text-2xl text-ink">Start with a photo</p>
        <p className="text-sm text-ink-muted">Tap to pick or take one</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </button>
  );
}
