"use client";

import Link from "next/link";
import { Images, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { listFilters, type FilterResponse } from "@/lib/api";
import { useAuth } from "@/app/providers";
import { FilterCanvas } from "@/components/filter-canvas";

export default function CatalogPage() {
  const { session } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["filters", "public"],
    queryFn: () => listFilters("public"),
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

      {isLoading && (
        <div className="mt-16 flex justify-center">
          <span className="breathe h-2.5 w-2.5 rounded-full" style={{ background: "rgb(234 198 126)" }} />
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
          title="Nothing here yet"
          body="Be the first to paint a look and publish it to the world."
          cta={{ href: "/editor", label: "Create a filter" }}
        />
      )}

      {data && data.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3 px-5">
          {data.map((f) => (
            <FilterCard key={f.id} filter={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterCard({ filter }: { filter: FilterResponse }) {
  return (
    <Link href={`/filters/${filter.id}`} className="group block">
      <FilterCanvas
        filter={filter}
        previewUrl={filter.preview_url}
        className="transition group-active:scale-[0.98]"
      />
      <div className="mt-2 px-1">
        <div className="truncate text-[13px] font-medium text-ink">{filter.name}</div>
        <div className="truncate text-[11px] text-ink-faint">
          {filter.description ?? filter.prompt}
        </div>
      </div>
    </Link>
  );
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
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full" style={{ background: "rgb(255 255 255 / 0.04)" }}>
        {icon === "gallery" ? <Images size={36} strokeWidth={1.2} style={{ color: "rgb(152 147 136)" }} /> : <Sparkles size={36} strokeWidth={1.2} style={{ color: "rgb(152 147 136)" }} />}
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
