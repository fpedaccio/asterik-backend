"use client";

import { Sparkles } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  createCheckoutSession,
  createGeneration,
  getFilter,
  getQuota,
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
      setExtraPad(hidden > 80 ? hidden : 0);
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

// ── Free-plan upgrade wall ────────────────────────────────────────────────────
function UpgradeWall({
  title,
  body,
  onUpgrade,
  onDismiss,
  showCatalogLink,
}: {
  title: string;
  body: string;
  onUpgrade: () => void;
  onDismiss?: () => void;
  showCatalogLink?: boolean;
}) {
  return (
    <div style={{
      borderRadius: 20,
      border: "1px solid rgb(234 198 126 / 0.3)",
      background: "linear-gradient(160deg, rgb(234 198 126 / 0.09) 0%, rgb(191 155 220 / 0.05) 100%)",
      backdropFilter: "blur(10px)",
      padding: "20px 18px",
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>✦</span>
        <div>
          <p style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, color: "rgb(248 244 233)" }}>{title}</p>
          <p style={{ margin: 0, fontSize: 13, color: "rgb(152 147 136)", lineHeight: 1.5 }}>{body}</p>
        </div>
      </div>
      <button
        onClick={onUpgrade}
        style={{
          borderRadius: 999, border: "none",
          background: "rgb(234 198 126)", color: "rgb(14 13 12)",
          padding: "13px 0", fontSize: 14, fontWeight: 600, cursor: "pointer",
          width: "100%",
        }}
      >
        Upgrade to Pro — $5/mo
      </button>
      {showCatalogLink && (
        <a
          href="/catalog"
          style={{
            borderRadius: 999,
            border: "1px solid rgb(255 255 255 / 0.1)",
            background: "transparent",
            color: "rgb(210 205 193)",
            padding: "12px 0", fontSize: 14, cursor: "pointer",
            textDecoration: "none", textAlign: "center", display: "block",
          }}
        >
          Browse public catalog →
        </a>
      )}
      {onDismiss && (
        <button onClick={onDismiss} style={{
          background: "none", border: "none",
          fontSize: 12, color: "rgb(96 92 83)", cursor: "pointer", padding: 0,
        }}>
          Dismiss
        </button>
      )}
    </div>
  );
}

// ── Quota bar ─────────────────────────────────────────────────────────────────
function QuotaBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = Math.min(100, (used / limit) * 100);
  const remaining = limit - used;
  const color = remaining === 0 ? "#ff7b7b" : remaining <= 1 ? "rgb(234 198 126)" : "rgb(96 185 120)";
  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em", color: "rgb(96 92 83)" }}>{label}</span>
        <span style={{ fontSize: 10, color, fontVariantNumeric: "tabular-nums" }}>{remaining} left</span>
      </div>
      <div style={{ height: 3, borderRadius: 99, background: "rgb(255 255 255 / 0.08)" }}>
        <div style={{ height: "100%", borderRadius: 99, width: `${pct}%`, background: color, transition: "width 400ms" }} />
      </div>
    </div>
  );
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
  const [engine, setEngine] = useState<Engine>("gemini");
  const [appliedFilter, setAppliedFilter] = useState<FilterResponse | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generation, setGeneration] = useState<GenerationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgradeReason, setUpgradeReason] = useState<{ title: string; body: string } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const keyboardPad = useKeyboardPadding();

  const { data: quota, refetch: refetchQuota } = useQuery({
    queryKey: ["quota"],
    queryFn: getQuota,
    enabled: !!session,
    staleTime: 30_000,
  });

  const isFree = quota?.plan === "free";
  const isCustomPromptMode = !appliedFilter; // no filter applied = user writes own prompt

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

  async function handleUpgrade() {
    try {
      const { url } = await createCheckoutSession();
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start checkout");
    }
  }

  async function handleApply() {
    if (!file) return setError("Pick a photo first");

    // Block free users with custom prompts immediately — no API call needed
    if (isFree && isCustomPromptMode) {
      setUpgradeReason({
        title: "Custom prompts are Pro only",
        body: "Free plan can only apply filters from the public catalog. Upgrade to describe your own looks.",
      });
      return;
    }

    if (!prompt.trim() && !appliedFilter) return setError("Describe a look");

    textareaRef.current?.blur();
    setError(null);
    setUpgradeReason(null);
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
      refetchQuota();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("402") || msg.includes("upgrade_required")) {
        if (msg.includes("gemini_limit")) {
          setUpgradeReason({
            title: "Gemini limit reached",
            body: `You've used your ${quota?.gemini_limit ?? 3} free Gemini generations this month. Upgrade to Pro for 100/month.`,
          });
        } else if (msg.includes("hybrid_limit")) {
          setUpgradeReason({
            title: "Monthly limit reached",
            body: `You've used all ${quota?.hybrid_limit ?? 10} free generations this month. Upgrade to Pro for 100/month.`,
          });
        } else {
          setUpgradeReason({
            title: "Upgrade to keep going",
            body: "You've hit your free plan limit. Pro gives you 100 generations/month and custom prompts.",
          });
        }
      } else {
        setError(msg);
      }
    } finally {
      setGenerating(false);
    }
  }

  if (authLoading) return <Spinner />;
  if (!session) return null;

  const done = !!generation?.output_url;
  const hasImage = !!previewUrl;

  // Quota bars for free users
  const showQuotaBars = isFree && quota && !appliedFilter;
  const geminiExhausted = isFree && (quota?.gemini_used ?? 0) >= (quota?.gemini_limit ?? 3);
  const hybridExhausted = isFree && (quota?.hybrid_used ?? 0) >= (quota?.hybrid_limit ?? 10);
  const allExhausted = geminiExhausted && hybridExhausted;

  return (
    <div
      style={{
        paddingBottom: keyboardPad + 40,
        transition: "padding-bottom 180ms ease",
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header className="safe-top" style={{ padding: "32px 24px 8px" }}>
        <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.22em", color: "rgb(152 147 136)", margin: "0 0 8px" }}>
          {appliedFilter ? "Applying" : "Create"}
        </p>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <h1 className="font-display" style={{ fontSize: 40, lineHeight: 1, color: "rgb(248 244 233)", margin: 0, fontWeight: 400, letterSpacing: "-0.02em" }}>
            {appliedFilter ? appliedFilter.name : "A look,"}
          </h1>
          {hasImage && (
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
        {!appliedFilter && (
          <h1 className="font-display" style={{ fontSize: 40, lineHeight: 1, color: "rgb(152 147 136)", margin: 0, fontWeight: 400, letterSpacing: "-0.02em" }}>
            in words.
          </h1>
        )}
      </header>

      <div
        style={{
          flex: 1,
          padding: "28px 20px 0",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          justifyContent: hasImage ? "flex-start" : "center",
        }}
      >
        {/* 1 — PHOTO */}
        <div>
          {!hasImage ? (
            <ImageUploader
              compact
              onFileSelected={(f, url) => { setFile(f); setPreviewUrl(url); setGeneration(null); }}
            />
          ) : done ? (
            <div style={{ width: "100%", height: "42dvh" }}>
              <BeforeAfterSlider beforeUrl={previewUrl!} afterUrl={generation!.output_url!} />
            </div>
          ) : (
            <div style={{
              position: "relative", borderRadius: 20, overflow: "hidden",
              width: "100%", height: "42dvh",
              border: "1px solid rgb(255 255 255 / 0.08)",
              background: "rgb(0 0 0 / 0.3)",
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl!}
                alt="Source"
                style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
              />
              {generating && (
                <>
                  <div className="absolute inset-0 aurora" />
                  <div className="shimmer-bar" />
                  <div style={{ position: "absolute", insetInline: 0, bottom: 16, display: "flex", justifyContent: "center" }}>
                    <div style={{
                      display: "inline-flex", alignItems: "center", gap: 8,
                      background: "rgb(14 13 12 / 0.72)", backdropFilter: "blur(8px)",
                      color: "rgb(234 198 126)", borderRadius: 999, padding: "8px 16px", fontSize: 14,
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

        {/* 2 — PROMPT or UPGRADE WALL */}
        {!appliedFilter ? (
          isFree ? (
            // Free user trying to use custom prompt → show wall
            <UpgradeWall
              title="Custom prompts are Pro only"
              body="Free plan lets you apply filters from the public catalog. Upgrade to describe any look you want."
              onUpgrade={handleUpgrade}
              showCatalogLink
            />
          ) : (
            // Pro user → normal prompt textarea
            <div style={{
              borderRadius: 20,
              border: "1px solid rgb(255 255 255 / 0.09)",
              background: "linear-gradient(180deg, rgb(32 28 24 / 0.8), rgb(22 20 18 / 0.85))",
              backdropFilter: "blur(10px)",
              boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.06), 0 8px 40px rgb(234 198 126 / 0.05)",
              padding: "16px 18px",
            }}>
              <span style={{
                display: "block", fontSize: 10, textTransform: "uppercase",
                letterSpacing: "0.22em", color: "rgb(152 147 136)", marginBottom: 10,
              }}>
                Describe the look
              </span>
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onFocus={() => setTimeout(() => textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 180)}
                rows={hasImage ? 2 : 3}
                maxLength={500}
                placeholder="vintage film, warm highlights, faded shadows…"
                disabled={generating}
                style={{
                  width: "100%", border: "none", background: "transparent",
                  padding: 0, fontSize: 17, lineHeight: 1.45,
                  outline: "none", color: "rgb(248 244 233)",
                  boxSizing: "border-box", resize: "none", fontFamily: "inherit",
                }}
              />
            </div>
          )
        ) : (
          <div style={{
            borderRadius: 16, border: "1px solid rgb(255 255 255 / 0.08)",
            background: "rgb(26 24 21 / 0.6)", padding: "14px 18px",
            fontSize: 15, color: "rgb(210 205 193)", fontStyle: "italic",
          }}>
            {appliedFilter.prompt}
          </div>
        )}

        {/* Quota bars — free users only, when using catalog */}
        {showQuotaBars && appliedFilter && (
          <div style={{
            borderRadius: 14,
            border: "1px solid rgb(255 255 255 / 0.06)",
            background: "rgb(255 255 255 / 0.02)",
            padding: "12px 14px",
            display: "flex", flexDirection: "column", gap: 10,
          }}>
            <p style={{ margin: "0 0 2px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em", color: "rgb(96 92 83)" }}>
              Free plan · this month
            </p>
            <div style={{ display: "flex", gap: 16 }}>
              <QuotaBar used={quota!.gemini_used} limit={quota!.gemini_limit} label="Gemini" />
              <QuotaBar used={quota!.hybrid_used} limit={quota!.hybrid_limit} label="Hybrid" />
            </div>
            {allExhausted && (
              <button onClick={handleUpgrade} style={{
                marginTop: 4, borderRadius: 999, border: "none",
                background: "rgb(234 198 126)", color: "rgb(14 13 12)",
                padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>
                Upgrade to Pro — $5/mo
              </button>
            )}
          </div>
        )}

        {/* 3 — APPLY + ENGINE (only show if not a free user hitting the wall) */}
        {(!isFree || appliedFilter) && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={handleApply}
              disabled={generating || !file}
              style={{
                flex: 1, borderRadius: 999, border: "none",
                padding: "15px 0", fontSize: 15, fontWeight: 600,
                background: generating || !file ? "rgb(248 244 233 / 0.2)" : "rgb(248 244 233)",
                color: "rgb(14 13 12)",
                cursor: generating || !file ? "default" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                transition: "background 150ms",
              }}
            >
              <Sparkles size={15} />
              {generating ? "Working…" : done ? "Apply again" : "Apply filter"}
            </button>
            <EngineSwitch value={engine} onChange={setEngine} disabled={generating} />
          </div>
        )}

        {error && (
          <p style={{ textAlign: "center", fontSize: 14, color: "#ff7b7b", margin: 0 }}>{error}</p>
        )}

        {upgradeReason && (
          <UpgradeWall
            title={upgradeReason.title}
            body={upgradeReason.body}
            onUpgrade={handleUpgrade}
            onDismiss={() => setUpgradeReason(null)}
            showCatalogLink
          />
        )}

        {/* Post-generation */}
        {done && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ShareButtons
              imageUrl={generation!.output_url!}
              filename={`asterik-${generation!.id}.jpg`}
              shareTitle="Filtered with Asterik"
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
      <span className="breathe" style={{ width: 12, height: 12, borderRadius: 999, background: "rgb(234 198 126)", display: "block" }} />
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
