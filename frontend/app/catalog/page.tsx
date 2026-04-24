"use client";

import Link from "next/link";
import { useState } from "react";
import { Heart, Bookmark, Images, Sparkles, Flame } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  favoriteFilter,
  likeFilter,
  listFilters,
  unfavoriteFilter,
  unlikeFilter,
  type FilterResponse,
  type FilterScope,
} from "@/lib/api";
import { useAuth } from "@/app/providers";
import { FilterCanvas } from "@/components/filter-canvas";

type Tab = Extract<FilterScope, "top" | "new" | "favorites" | "mine">;

const TABS: { key: Tab; label: string }[] = [
  { key: "top", label: "Top" },
  { key: "new", label: "New" },
  { key: "favorites", label: "Saved" },
  { key: "mine", label: "Mine" },
];

export default function CatalogPage() {
  const { session } = useAuth();
  const [tab, setTab] = useState<Tab>("top");

  const { data, isLoading, error } = useQuery({
    queryKey: ["filters", tab],
    queryFn: () => listFilters(tab),
    enabled: !!session,
  });

  if (!session) {
    return (
      <div className="safe-top px-6">
        <EmptyState
          icon="gallery"
          title="A catalog of looks"
          body="Sign in to browse and apply filters shared by the community."
          cta={{ href: "/login", label: "Sign in" }}
        />
      </div>
    );
  }

  return (
    <div className="pb-8">
      <header className="safe-top px-6">
        <p className="text-[11px] uppercase tracking-[0.2em] text-ink-faint">Community</p>
        <h1 className="font-display text-3xl leading-none text-ink">Catalog</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Looks painted by others. Tap to apply to your photo.
        </p>
      </header>

      <div className="mt-5 px-5">
        <div
          className="flex gap-1 rounded-full p-1"
          style={{ background: "rgb(255 255 255 / 0.04)" }}
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="flex-1 rounded-full px-3 py-1.5 text-[12px] font-medium transition"
              style={
                tab === t.key
                  ? { background: "rgb(248 244 233)", color: "rgb(14 13 12)" }
                  : { color: "rgb(152 147 136)" }
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="mt-16 flex justify-center">
          <span
            className="breathe h-2.5 w-2.5 rounded-full"
            style={{ background: "rgb(234 198 126)" }}
          />
        </div>
      )}

      {error && (
        <p className="mt-10 px-6 text-sm" style={{ color: "#ff7b7b" }}>
          {error instanceof Error ? error.message : String(error)}
        </p>
      )}

      {data && data.length === 0 && (
        <EmptyState
          icon="sparkle"
          title={emptyTitle(tab)}
          body={emptyBody(tab)}
          cta={
            tab === "favorites" || tab === "mine"
              ? { href: "/editor", label: "Open the editor" }
              : { href: "/editor", label: "Create a filter" }
          }
        />
      )}

      {data && data.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 px-5">
          {data.map((f) => (
            <FilterCard key={f.id} filter={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function emptyTitle(tab: Tab): string {
  if (tab === "favorites") return "No saved looks yet";
  if (tab === "mine") return "You haven’t painted one yet";
  return "Nothing here yet";
}

function emptyBody(tab: Tab): string {
  if (tab === "favorites")
    return "Tap the bookmark on any filter to keep it close at hand.";
  if (tab === "mine") return "Create a filter in the editor and it’ll land here.";
  return "Be the first to paint a look and publish it to the world.";
}

function FilterCard({ filter }: { filter: FilterResponse }) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const isOwn = session?.user?.id === filter.owner_id;

  const likeMut = useMutation({
    mutationFn: (next: boolean) => (next ? likeFilter(filter.id) : unlikeFilter(filter.id)),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: ["filters"] });
      const prev = qc.getQueriesData<FilterResponse[]>({ queryKey: ["filters"] });
      for (const [key, list] of prev) {
        if (!list) continue;
        qc.setQueryData<FilterResponse[]>(
          key,
          list.map((f) =>
            f.id === filter.id
              ? {
                  ...f,
                  liked_by_me: next,
                  likes_count: Math.max(0, f.likes_count + (next ? 1 : -1)),
                }
              : f
          )
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["filters"] }),
  });

  const favMut = useMutation({
    mutationFn: (next: boolean) =>
      next ? favoriteFilter(filter.id) : unfavoriteFilter(filter.id),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: ["filters"] });
      const prev = qc.getQueriesData<FilterResponse[]>({ queryKey: ["filters"] });
      for (const [key, list] of prev) {
        if (!list) continue;
        qc.setQueryData<FilterResponse[]>(
          key,
          list.map((f) =>
            f.id === filter.id ? { ...f, favorited_by_me: next } : f
          )
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["filters"] }),
  });

  return (
    <div className="group block">
      <Link href={`/filters/${filter.id}`}>
        <FilterCanvas
          filter={filter}
          previewUrl={filter.preview_url}
          className="transition group-active:scale-[0.98]"
        />
      </Link>
      <div className="mt-2 flex items-start justify-between gap-2 px-1">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-ink">{filter.name}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
            <span className="inline-flex items-center gap-1">
              <Heart size={11} strokeWidth={1.6} />
              {formatCount(filter.likes_count)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Flame size={11} strokeWidth={1.6} />
              {formatCount(filter.uses_count)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              if (isOwn || likeMut.isPending) return;
              likeMut.mutate(!filter.liked_by_me);
            }}
            disabled={isOwn}
            aria-label={filter.liked_by_me ? "Unlike" : "Like"}
            className="flex h-7 w-7 items-center justify-center rounded-full transition disabled:opacity-30"
            style={{ background: "rgb(255 255 255 / 0.04)" }}
          >
            <Heart
              size={13}
              strokeWidth={1.8}
              style={{
                color: filter.liked_by_me ? "rgb(255 107 107)" : "rgb(234 230 219)",
                fill: filter.liked_by_me ? "rgb(255 107 107)" : "transparent",
              }}
            />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              if (favMut.isPending) return;
              favMut.mutate(!filter.favorited_by_me);
            }}
            aria-label={filter.favorited_by_me ? "Unsave" : "Save"}
            className="flex h-7 w-7 items-center justify-center rounded-full transition"
            style={{ background: "rgb(255 255 255 / 0.04)" }}
          >
            <Bookmark
              size={13}
              strokeWidth={1.8}
              style={{
                color: filter.favorited_by_me ? "rgb(234 198 126)" : "rgb(234 230 219)",
                fill: filter.favorited_by_me ? "rgb(234 198 126)" : "transparent",
              }}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

function EmptyState({
  icon,
  title,
  body,
  cta,
}: {
  icon: string;
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="mx-auto mt-12 max-w-xs text-center">
      <div
        className="mx-auto flex h-20 w-20 items-center justify-center rounded-full"
        style={{ background: "rgb(255 255 255 / 0.04)" }}
      >
        {icon === "gallery" ? (
          <Images size={36} strokeWidth={1.2} style={{ color: "rgb(152 147 136)" }} />
        ) : (
          <Sparkles size={36} strokeWidth={1.2} style={{ color: "rgb(152 147 136)" }} />
        )}
      </div>
      <h2 className="mt-4 font-display text-2xl text-ink">{title}</h2>
      <p className="mt-2 text-sm text-ink-muted">{body}</p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-6 inline-block rounded-full px-5 py-2.5 text-sm font-medium"
          style={{ background: "rgb(248 244 233)", color: "rgb(14 13 12)" }}
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
