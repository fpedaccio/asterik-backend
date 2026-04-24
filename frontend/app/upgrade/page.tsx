"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getQuota } from "@/lib/api";

function UpgradeInner() {
  const params = useSearchParams();
  const success = params.get("success") === "1";

  const [isPro, setIsPro] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const MAX_ATTEMPTS = 12; // ~24 seconds

  // Poll /api/quota until plan === 'pro' or timeout
  useEffect(() => {
    if (!success) return;
    if (isPro) return;
    if (attempts >= MAX_ATTEMPTS) return;

    const timer = setTimeout(async () => {
      try {
        const q = await getQuota();
        if (q.plan === "pro") {
          setIsPro(true);
        } else {
          setAttempts((n) => n + 1);
        }
      } catch {
        setAttempts((n) => n + 1);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [success, isPro, attempts]);

  if (!success) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "70dvh", padding: "0 24px", textAlign: "center" }}>
        <p style={{ fontSize: 40 }}>✦</p>
        <h1 className="font-display" style={{ fontSize: 32, color: "rgb(248 244 233)", margin: "12px 0 8px", fontWeight: 400 }}>
          Upgrade to Pro
        </h1>
        <p style={{ color: "rgb(152 147 136)", fontSize: 15, margin: "0 0 24px" }}>
          Unlock unlimited generations.
        </p>
        <Link href="/profile" style={{
          borderRadius: 999, background: "rgb(234 198 126)", color: "rgb(14 13 12)",
          padding: "14px 28px", fontWeight: 600, fontSize: 15, textDecoration: "none",
        }}>
          View plans
        </Link>
      </div>
    );
  }

  // Still waiting for webhook to fire
  if (!isPro && attempts < MAX_ATTEMPTS) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "70dvh", padding: "0 24px", textAlign: "center", gap: 20 }}>
        <span className="breathe" style={{ width: 14, height: 14, borderRadius: 999, background: "rgb(234 198 126)", display: "block" }} />
        <div>
          <p style={{ fontSize: 18, color: "rgb(248 244 233)", margin: "0 0 8px" }}>Activating your plan…</p>
          <p style={{ fontSize: 13, color: "rgb(152 147 136)", margin: 0 }}>This takes just a few seconds</p>
        </div>
      </div>
    );
  }

  // Timed out — payment went through but webhook was slow
  if (!isPro && attempts >= MAX_ATTEMPTS) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "70dvh", padding: "0 24px", textAlign: "center", gap: 16 }}>
        <p style={{ fontSize: 40 }}>✦</p>
        <h1 className="font-display" style={{ fontSize: 28, color: "rgb(248 244 233)", margin: 0, fontWeight: 400 }}>
          Payment received!
        </h1>
        <p style={{ fontSize: 14, color: "rgb(152 147 136)", margin: 0, maxWidth: 280, lineHeight: 1.6 }}>
          Your plan is activating — it can take up to a minute. Refresh the app in a moment and you&apos;ll be Pro.
        </p>
        <Link href="/profile" style={{
          borderRadius: 999, background: "rgb(234 198 126)", color: "rgb(14 13 12)",
          padding: "13px 28px", fontWeight: 600, fontSize: 15, textDecoration: "none",
        }}>
          Go to profile
        </Link>
      </div>
    );
  }

  // Pro activated ✓
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "70dvh",
      padding: "0 24px", textAlign: "center",
    }}>
      <div className="filter-canvas-anim" style={{ fontSize: 64, color: "rgb(234 198 126)", lineHeight: 1, marginBottom: 24 }}>
        ✦
      </div>
      <h1 className="font-display" style={{ fontSize: 36, color: "rgb(248 244 233)", margin: "0 0 12px", fontWeight: 400, letterSpacing: "-0.02em" }}>
        Welcome to Pro
      </h1>
      <p style={{ color: "rgb(152 147 136)", fontSize: 15, margin: "0 0 8px", maxWidth: 280 }}>
        Your plan is active. Unlimited generations, unlocked.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 32, width: "100%", maxWidth: 280 }}>
        <Link href="/editor" style={{
          borderRadius: 999, background: "rgb(234 198 126)", color: "rgb(14 13 12)",
          padding: "14px 0", fontWeight: 600, fontSize: 15,
          textDecoration: "none", textAlign: "center",
        }}>
          Start creating
        </Link>
        <Link href="/profile" style={{
          borderRadius: 999, border: "1px solid rgb(255 255 255 / 0.1)",
          color: "rgb(210 205 193)", padding: "13px 0", fontSize: 15,
          textDecoration: "none", textAlign: "center",
        }}>
          View profile
        </Link>
      </div>
    </div>
  );
}

export default function UpgradePage() {
  return (
    <Suspense>
      <UpgradeInner />
    </Suspense>
  );
}
