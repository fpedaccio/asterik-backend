"use client";

import { Sparkles } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createGeneration,
  getFilter,
  signUpload,
  uploadToSignedUrl,
  type Engine,
  type FilterResponse,
  type GenerationResponse,
} from "@/lib/api";
import { ImageUploader } from "@/components/image-uploader";
import { EngineSwitch } from "@/components/engine-switch";
import { BeforeAfterSlider } from "@/components/before-after-slider";
import { ShareButtons } from "@/components/share-buttons";
import { SaveFilterDialog } from "@/components/save-filter-dialog";
import { useAuth } from "@/app/providers";

function useKeyboardPadding() {
  const [extraPad, setExtraPad] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function update() {
      const hidden = window.innerHeight - vv!.height - vv!.offsetTop;
      setExtraPad(hidden > 50 ? hidden : 0);
    }

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv!.removeEventListener("resize", update);
      vv!.removeEventListener("scroll", update);
    };
  }, []);

  return extraPad;
}

function EditorInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filterIdParam = searchParams.get("filter");
  const { session, loading: authLoading } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [engine, setEngine] = useState<Engine>("hybrid");
  const [appliedFilter, setAppliedFilter] = useState<FilterResponse | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generation, setGeneration] = useState<GenerationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const keyboardPad = useKeyboardPadding();

  useEffect(() => {
    if (!authLoading && !session) router.replace("/login");
  }, [authLoading, session, router]);

  useEffect(() => {
    if (!filterIdParam) return;
    (async () => {
      try {
        const f = await getFilter(filterIdParam);
        setAppliedFilter(f);
        setPrompt(f.prompt);
        setEngine(f.engine);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [filterIdParam]);

  async function handleApply() {
    if (!file) return setError("Pick a photo first");
    if (!prompt.trim() && !appliedFilter) return setError("Describe a look");
    textareaRef.current?.blur();
    setError(null);
    setGenerating(true);
    setGeneration(null);
    try {
      const { upload_url, source_path } = await signUpload(file.type || "image/jpeg");
      await uploadToSignedUrl(upload_url, file);
      const gen = await createGeneration({
        source_path,
        engine,
        prompt: appliedFilter ? undefined : prompt,
        filter_id: appliedFilter?.id,
      });
      setGeneration(gen);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  if (authLoading) return <Spinner />;
  if (!session) return null;

  const done = !!generation?.output_url;

  return (
    <div style={{ paddingBottom: keyboardPad + 32, transition: "padding-bottom 200ms ease" }}>

      {/* Header */}
      <header className="safe-top" style={{ padding: "0 24px 16px" }}>
        <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.2em", color: "rgb(96 92 83)", margin: "0 0 4px" }}>
          {appliedFilter ? "Applying" : "Editor"}
        </p>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <h1 style={{ fontSize: 28, lineHeight: 1.1, color: "rgb(248 244 233)", margin: 0, fontWeight: 400 }}>
            {appliedFilter ? appliedFilter.name : "A look, in words."}
          </h1>
          {previewUrl && (
            <button
              onClick={() => { setFile(null); setPreviewUrl(null); setGeneration(null); }}
              style={{
                flexShrink: 0, fontSize: 12, color: "rgb(152 147 136)",
                background: "rgb(255 255 255 / 0.05)", border: "none",
                borderRadius: 999, padding: "6px 12px", cursor: "pointer",
              }}
            >
              New photo
            </button>
          )}
        </div>
      </header>

      <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* === PROMPT — hero element === */}
        {!appliedFilter ? (
          <div style={{
            borderRadius: 20,
            padding: 2,
            background: "linear-gradient(135deg, rgb(234 198 126 / 0.6) 0%, rgb(191 155 220 / 0.5) 50%, rgb(126 188 210 / 0.4) 100%)",
          }}>
            <div style={{
              borderRadius: 18,
              background: "rgb(22 21 19)",
              padding: "16px 18px",
            }}>
              <span style={{
                display: "block", fontSize: 10, textTransform: "uppercase",
                letterSpacing: "0.18em", color: "rgb(234 198 126 / 0.8)", marginBottom: 10,
              }}>
                Describe the look
              </span>
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="vintage film with warm highlights and faded shadows…"
                disabled={generating}
                style={{
                  width: "100%", border: "none", background: "transparent",
                  padding: 0, fontSize: 16, lineHeight: 1.5,
                  outline: "none", color: "rgb(248 244 233)",
                  boxSizing: "border-box", resize: "none",
                  fontFamily: "inherit",
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                <button
                  onClick={handleApply}
                  disabled={generating || !file}
                  style={{
                    borderRadius: 999, border: "none",
                    padding: "10px 22px", fontSize: 14, fontWeight: 600,
                    background: generating || !file ? "rgb(248 244 233 / 0.2)" : "rgb(248 244 233)",
                    color: "rgb(14 13 12)",
                    cursor: generating || !file ? "default" : "pointer",
                    display: "flex", alignItems: "center", gap: 6,
                    transition: "background 150ms",
                  }}
                >
                  <Sparkles size={14} />
                  {generating ? "Working…" : done ? "Again" : "Apply"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{
            borderRadius: 16, border: "1px solid rgb(255 255 255 / 0.08)",
            background: "rgb(255 255 255 / 0.02)", padding: "12px 16px",
            fontSize: 15, color: "rgb(210 205 193)", fontStyle: "italic",
          }}>
            {appliedFilter.prompt}
          </div>
        )}

        {/* === PHOTO — compact === */}
        <div>
          {!previewUrl ? (
            <ImageUploader
              compact
              onFileSelected={(f, url) => {
                setFile(f);
                setPreviewUrl(url);
                setGeneration(null);
              }}
            />
          ) : done ? (
            <BeforeAfterSlider beforeUrl={previewUrl} afterUrl={generation!.output_url!} />
          ) : (
            <div style={{ position: "relative", borderRadius: 20, overflow: "hidden" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Source"
                style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", display: "block" }}
              />
              {generating && (
                <>
                  <div className="absolute inset-0 aurora" />
                  <div className="shimmer-bar" />
                  <div style={{
                    position: "absolute", insetInline: 0, bottom: 20,
                    display: "flex", justifyContent: "center",
                  }}>
                    <div style={{
                      display: "inline-flex", alignItems: "center", gap: 8,
                      background: "rgb(14 13 12 / 0.72)", backdropFilter: "blur(8px)",
                      color: "rgb(234 198 126)", borderRadius: 999,
                      padding: "8px 16px", fontSize: 14,
                    }}>
                      <Sparkles size={15} />
                      Painting your look…
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Engine switch — subtle, below photo */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgb(96 92 83)" }}>
            Engine
          </span>
          <EngineSwitch value={engine} onChange={setEngine} disabled={generating} />
        </div>

        {error && (
          <p style={{ textAlign: "center", fontSize: 14, color: "#ff7b7b", margin: 0 }}>{error}</p>
        )}

        {/* Post-generation actions */}
        {done && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ShareButtons
              imageUrl={generation!.output_url!}
              filename={`filterapps-${generation!.id}.jpg`}
              shareTitle="Filtered with FilterApps"
            />
            {!appliedFilter && (
              <button
                onClick={() => setSaveOpen(true)}
                style={{
                  width: "100%", borderRadius: 999,
                  border: "1px solid rgb(255 255 255 / 0.12)",
                  background: "transparent", padding: "14px 0",
                  fontSize: 15, color: "rgb(210 205 193)",
                  cursor: "pointer", display: "flex",
                  alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                Save as filter
              </button>
            )}
            {generation?.elapsed_ms != null && (
              <p style={{ textAlign: "center", fontSize: 11, color: "rgb(96 92 83)", margin: 0 }}>
                {generation.engine} · {(generation.elapsed_ms / 1000).toFixed(1)}s
              </p>
            )}
          </div>
        )}
      </div>

      {done && !appliedFilter && (
        <SaveFilterDialog
          open={saveOpen}
          onClose={() => setSaveOpen(false)}
          onSaved={(id) => router.push(`/filters/${id}`)}
          defaults={{ prompt, engine, previewGenerationId: generation!.id }}
        />
      )}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", height: "60dvh", alignItems: "center", justifyContent: "center" }}>
      <span
        className="breathe"
        style={{ width: 12, height: 12, borderRadius: 999, background: "rgb(234 198 126)", display: "block" }}
      />
    </div>
  );
}

export default function EditorPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <EditorInner />
    </Suspense>
  );
}
