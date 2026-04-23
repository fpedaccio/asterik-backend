"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { getFilter } from "@/lib/api";
import { useAuth } from "@/app/providers";
import { FilterCanvas } from "@/components/filter-canvas";

interface Props {
  params: Promise<{ id: string }>;
}

export default function FilterDetailPage({ params }: Props) {
  const { id } = use(params);
  const { session, loading } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["filter", id],
    queryFn: () => getFilter(id),
    enabled: !!session,
  });

  if (!loading && !session) {
    return (
      <div className="safe-top px-6 text-center">
        <p className="mt-20 text-ink-muted">Sign in to view this filter.</p>
        <Link
          href="/login"
          className="mt-6 inline-block rounded-full px-5 py-2.5 text-sm font-medium"
          style={{ background: "rgb(248 244 233)", color: "rgb(14 13 12)" }}
        >
          Sign in
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mt-24 flex justify-center">
        <span className="breathe h-2.5 w-2.5 rounded-full" style={{ background: "rgb(234 198 126)" }} />
      </div>
    );
  }
  if (error) {
    return (
      <p className="mt-16 px-6 text-sm" style={{ color: "#ff7b7b" }}>
        {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }
  if (!data) return null;

  return (
    <div className="pb-8">
      <header className="safe-top px-6">
        <Link href="/catalog" className="inline-flex items-center gap-1 text-sm text-ink-muted">
          <span aria-hidden>←</span> Catalog
        </Link>
      </header>

      <div className="mt-5 px-6">
        <FilterCanvas filter={data} previewUrl={data.preview_url} />
      </div>

      <div className="mt-6 px-6">
        <h1 className="font-display text-3xl leading-tight text-ink">{data.name}</h1>

        <div className="mt-2 flex items-center gap-2">
          <Tag>{data.engine === "gemini" ? "Bold" : "Gentle"}</Tag>
          <Tag>{data.visibility}</Tag>
        </div>

        {data.description && (
          <p className="mt-4 text-[15px] leading-relaxed text-ink-dim">{data.description}</p>
        )}

        <div className="mt-5">
          <p className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">Prompt</p>
          <p
            className="mt-2 rounded-2xl border px-4 py-3 text-[15px] italic text-ink-dim"
            style={{ borderColor: "rgb(255 255 255 / 0.08)", background: "rgb(255 255 255 / 0.02)" }}
          >
            {data.prompt}
          </p>
        </div>

        <Link
          href={`/editor?filter=${data.id}`}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-full px-6 py-4 text-[15px] font-medium"
          style={{ background: "rgb(248 244 233)", color: "rgb(14 13 12)" }}
        >
          <Sparkles size={18} />
          Apply to my photo
        </Link>
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-widest text-ink-dim"
      style={{ background: "rgb(255 255 255 / 0.06)" }}
    >
      {children}
    </span>
  );
}
