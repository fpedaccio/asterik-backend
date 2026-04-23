"use client";

import { useState } from "react";
import { createFilter, type Engine, type Visibility } from "@/lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (filterId: string) => void;
  defaults: {
    prompt: string;
    engine: Engine;
    previewGenerationId: string;
  };
}

export function SaveFilterDialog({ open, onClose, onSaved, defaults }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const f = await createFilter({
        name: name.trim(),
        prompt: defaults.prompt,
        description: description.trim() || undefined,
        engine: defaults.engine,
        visibility,
        preview_generation_id: defaults.previewGenerationId,
      });
      onSaved(f.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: "rgb(0 0 0 / 0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="slide-up w-full max-w-md rounded-t-[28px] border border-t sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "rgb(22 21 19)",
          borderColor: "rgb(255 255 255 / 0.08)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
        }}
      >
        <div className="mx-auto mt-3 h-1.5 w-10 rounded-full" style={{ background: "rgb(255 255 255 / 0.15)" }} />

        <div className="px-6 pt-4">
          <h2 className="font-display text-2xl text-ink">Save this look</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Give it a name so you can re-apply it — or publish it to the catalog.
          </p>

          <div className="mt-6 space-y-4">
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder="Fuji 400h warm"
                className="w-full rounded-2xl border bg-transparent px-4 py-3 text-[15px] outline-none"
                style={{ borderColor: "rgb(255 255 255 / 0.1)" }}
              />
            </Field>

            <Field label="Description" optional>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="A soft, warm film look with lifted shadows."
                className="w-full rounded-2xl border bg-transparent px-4 py-3 text-[15px] outline-none"
                style={{ borderColor: "rgb(255 255 255 / 0.1)" }}
              />
            </Field>

            <Field label="Visibility">
              <div
                className="inline-flex w-full items-center rounded-full p-1"
                style={{ background: "rgb(255 255 255 / 0.05)" }}
              >
                {(["private", "public"] as Visibility[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVisibility(v)}
                    className={`flex-1 rounded-full px-4 py-2 text-sm font-medium capitalize transition ${
                      visibility === v
                        ? "bg-ink text-paper"
                        : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </Field>

            {error && <p className="text-sm" style={{ color: "#ff7b7b" }}>{error}</p>}

            <div className="flex gap-2 pt-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-full border px-4 py-3 text-sm font-medium text-ink-dim"
                style={{ borderColor: "rgb(255 255 255 / 0.1)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !name.trim()}
                className="flex-1 rounded-full px-4 py-3 text-sm font-medium disabled:opacity-40"
                style={{ background: "rgb(248 244 233)", color: "rgb(14 13 12)" }}
              >
                {saving ? "Saving…" : "Save filter"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  optional,
}: {
  label: string;
  children: React.ReactNode;
  optional?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] uppercase tracking-[0.12em] text-ink-faint">
        {label}
        {optional && <span className="ml-2 normal-case tracking-normal">optional</span>}
      </span>
      {children}
    </label>
  );
}
