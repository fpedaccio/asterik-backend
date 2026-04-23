"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, BookOpen, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/app/providers";

interface Tab {
  href: string;
  label: string;
  Icon: LucideIcon;
  match: (pathname: string) => boolean;
}

const TABS: Tab[] = [
  {
    href: "/editor",
    label: "Create",
    Icon: Sparkles,
    match: (p) => p === "/" || p.startsWith("/editor"),
  },
  {
    href: "/catalog",
    label: "Catalog",
    Icon: BookOpen,
    match: (p) => p.startsWith("/catalog") || p.startsWith("/filters"),
  },
  {
    href: "/profile",
    label: "You",
    Icon: User,
    match: (p) => p.startsWith("/profile"),
  },
];

export function BottomNav() {
  const pathname = usePathname() ?? "/";
  const { session } = useAuth();

  if (pathname.startsWith("/login")) return null;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center"
      style={{
        paddingBottom: "max(env(safe-area-inset-bottom), 12px)",
        paddingTop: "12px",
        background:
          "linear-gradient(to top, rgb(14 13 12 / 0.95) 0%, rgb(14 13 12 / 0.6) 70%, transparent 100%)",
      }}
    >
      <div
        className="flex w-[min(380px,calc(100%-24px))] items-center justify-around rounded-full px-2 py-2 backdrop-blur-xl"
        style={{
          background: "rgb(22 21 19 / 0.85)",
          border: "1px solid rgb(255 255 255 / 0.08)",
          boxShadow: "0 10px 30px -10px rgb(0 0 0 / 0.6)",
        }}
      >
        {TABS.map((t) => {
          const active = t.match(pathname);
          const target = !session && t.href !== "/catalog" ? "/login" : t.href;
          return (
            <Link
              key={t.href}
              href={target}
              aria-label={t.label}
              aria-current={active ? "page" : undefined}
              className="flex min-w-16 flex-col items-center gap-1.5 rounded-full px-4 py-1.5"
            >
              <t.Icon
                size={22}
                strokeWidth={active ? 2.2 : 1.6}
                style={{ color: active ? "rgb(248 244 233)" : "rgb(152 147 136)" }}
              />
              <span
                className="text-[10px] tracking-wide"
                style={{ color: active ? "rgb(248 244 233)" : "rgb(152 147 136)" }}
              >
                {t.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
