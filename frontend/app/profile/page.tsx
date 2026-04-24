"use client";

import Link from "next/link";
import { Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createCheckoutSession,
  createPortalSession,
  deleteFilter,
  listFilters,
  updateFilter,
  type FilterResponse,
  type Visibility,
} from "@/lib/api";
import { useAuth } from "@/app/providers";
import { FilterCanvas } from "@/components/filter-canvas";
import { getSupabase } from "@/lib/supabase";

function usePlan(userId: string | undefined) {
  return useQuery({
    queryKey: ["profile", userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await getSupabase()
        .from("profiles")
        .select("plan, stripe_customer_id")
        .eq("id", userId)
        .single();
      return data;
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
}

export default function ProfilePage() {
  const router = useRouter();
  const { session, loading, signOut } = useAuth();
  const qc = useQueryClient();
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  const { data: profile } = usePlan(session?.user.id);
  const isPro = profile?.plan === "pro";

  const { data, isLoading } = useQuery({
    queryKey: ["filters", "mine"],
    queryFn: () => listFilters("mine"),
    enabled: !!session,
  });

  const updateMut = useMutation({
    mutationFn: (args: { id: string; visibility: Visibility }) =>
      updateFilter(args.id, { visibility: args.visibility }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["filters"] }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFilter(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["filters"] }),
  });

  async function handleGoPro() {
    setStripeLoading(true);
    setStripeError(null);
    try {
      const { url } = await createCheckoutSession();
      window.location.href = url;
    } catch (e) {
      setStripeError(e instanceof Error ? e.message : "Something went wrong");
      setStripeLoading(false);
    }
  }

  async function handleManage() {
    setStripeLoading(true);
    setStripeError(null);
    try {
      const { url } = await createPortalSession();
      window.location.href = url;
    } catch (e) {
      setStripeError(e instanceof Error ? e.message : "Something went wrong");
      setStripeLoading(false);
    }
  }

  if (!session) return null;

  return (
    <div className="pb-8">
      <header className="safe-top px-6">
        <p className="text-[11px] uppercase tracking-[0.2em] text-ink-faint">Signed in</p>
        <h1 className="font-display text-3xl leading-none text-ink">Your filters</h1>
        <p className="mt-2 truncate text-sm text-ink-muted">{session.user.email}</p>
      </header>

      {/* Plan card */}
      <div className="mx-5 mt-6 rounded-2xl p-4" style={{
        border: isPro ? "1px solid rgb(234 198 126 / 0.3)" : "1px solid rgb(255 255 255 / 0.08)",
        background: isPro
          ? "linear-gradient(135deg, rgb(234 198 126 / 0.08), rgb(191 155 220 / 0.05))"
          : "rgb(255 255 255 / 0.03)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.2em", color: "rgb(152 147 136)", margin: 0 }}>
              Plan
            </p>
            <p style={{ fontSize: 18, fontWeight: 600, color: isPro ? "rgb(234 198 126)" : "rgb(248 244 233)", margin: "4px 0 0" }}>
              {isPro ? "Asterik Pro ✦" : "Free"}
            </p>
            {!isPro && (
              <p style={{ fontSize: 12, color: "rgb(152 147 136)", margin: "2px 0 0" }}>
                Upgrade for unlimited generations
              </p>
            )}
          </div>
          <button
            onClick={isPro ? handleManage : handleGoPro}
            disabled={stripeLoading}
            style={{
              borderRadius: 999,
              border: "none",
              padding: "10px 18px",
              fontSize: 13,
              fontWeight: 600,
              cursor: stripeLoading ? "default" : "pointer",
              transition: "opacity 150ms",
              opacity: stripeLoading ? 0.6 : 1,
              background: isPro ? "rgb(255 255 255 / 0.08)" : "rgb(234 198 126)",
              color: isPro ? "rgb(210 205 193)" : "rgb(14 13 12)",
            }}
          >
            {stripeLoading ? "…" : isPro ? "Manage" : "Go Pro — $5/mo"}
          </button>
        </div>
        {stripeError && (
          <p style={{ fontSize: 12, color: "#ff7b7b", margin: "8px 0 0" }}>{stripeError}</p>
        )}
      </div>

      {isLoading && (
        <div className="mt-16 flex justify-center">
          <span className="breathe h-2.5 w-2.5 rounded-full" style={{ background: "rgb(234 198 126)" }} />
        </div>
      )}

      {data && data.length === 0 && (
        <div className="mx-auto mt-12 max-w-xs text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full" style={{ background: "rgb(255 255 255 / 0.04)" }}>
            <Wand2 size={36} strokeWidth={1.2} style={{ color: "rgb(152 147 136)" }} />
          </div>
          <h2 className="mt-4 font-display text-2xl text-ink">No filters yet</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Save a look from the editor and it&apos;ll appear here.
          </p>
          <Link
            href="/editor"
            className="mt-6 inline-block rounded-full px-5 py-2.5 text-sm font-medium"
            style={{ background: "rgb(248 244 233)", color: "rgb(14 13 12)" }}
          >
            Open editor
          </Link>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3 px-5">
          {data.map((f) => (
            <MyFilterCard
              key={f.id}
              filter={f}
              onToggleVisibility={() =>
                updateMut.mutate({
                  id: f.id,
                  visibility: f.visibility === "public" ? "private" : "public",
                })
              }
              onDelete={() => {
                if (confirm(`Delete "${f.name}"?`)) deleteMut.mutate(f.id);
              }}
            />
          ))}
        </div>
      )}

      <div className="mt-10 px-6">
        <button
          onClick={() => signOut()}
          className="w-full rounded-full border px-4 py-3 text-sm text-ink-muted"
          style={{ borderColor: "rgb(255 255 255 / 0.08)" }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function MyFilterCard({
  filter,
  onToggleVisibility,
  onDelete,
}: {
  filter: FilterResponse;
  onToggleVisibility: () => void;
  onDelete: () => void;
}) {
  return (
    <div>
      <Link href={`/filters/${filter.id}`} className="group block">
        <div className="relative">
          <FilterCanvas filter={filter} previewUrl={filter.preview_url} />
          <span
            className="absolute right-2 top-2 rounded-full px-2 py-0.5 text-[9px] uppercase tracking-widest"
            style={{
              background: filter.visibility === "public" ? "rgb(234 198 126 / 0.2)" : "rgb(0 0 0 / 0.5)",
              color: filter.visibility === "public" ? "rgb(234 198 126)" : "rgb(210 205 193)",
            }}
          >
            {filter.visibility}
          </span>
        </div>
        <div className="mt-2 px-1">
          <div className="truncate text-[13px] font-medium text-ink">{filter.name}</div>
        </div>
      </Link>
      <div className="mt-2 flex gap-1.5 px-1">
        <button
          onClick={onToggleVisibility}
          className="flex-1 rounded-full border px-2 py-1 text-[10px] text-ink-dim"
          style={{ borderColor: "rgb(255 255 255 / 0.1)" }}
        >
          Make {filter.visibility === "public" ? "private" : "public"}
        </button>
        <button
          onClick={onDelete}
          aria-label={`Delete ${filter.name}`}
          className="rounded-full border px-2.5 py-1 text-[10px]"
          style={{ borderColor: "rgb(255 123 123 / 0.25)", color: "#ff7b7b" }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
