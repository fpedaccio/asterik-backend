"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/app/providers";

export default function LoginPage() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [status, setStatus] = useState<"idle" | "sending" | "verifying" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!loading && session) router.replace("/editor");
  }, [session, loading, router]);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    try {
      const { error } = await getSupabase().auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
      if (error) {
        setStatus("error");
        setError(error.message);
      } else {
        setStatus("idle");
        setStep("code");
        setTimeout(() => inputRefs.current[0]?.focus(), 100);
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not connect to auth service");
    }
  }

  async function verifyCode() {
    const token = code.join("");
    if (token.length < 6) return;
    setStatus("verifying");
    setError(null);
    const { error } = await getSupabase().auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    if (error) {
      setStatus("error");
      setError("Invalid code. Try again or request a new one.");
      setCode(["", "", "", "", "", ""]);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } else {
      router.replace("/editor");
    }
  }

  function handleDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...code];
    next[index] = digit;
    setCode(next);
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
    if (next.every((d) => d !== "")) {
      // auto-submit when all 6 digits filled
      const token = next.join("");
      setStatus("verifying");
      setError(null);
      getSupabase().auth.verifyOtp({ email, token, type: "email" }).then(({ error }) => {
        if (error) {
          setStatus("error");
          setError("Invalid code. Try again or request a new one.");
          setCode(["", "", "", "", "", ""]);
          setTimeout(() => inputRefs.current[0]?.focus(), 100);
        } else {
          router.replace("/editor");
        }
      });
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  async function signInWithGoogle() {
    await getSupabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/editor` },
    });
  }

  return (
    <div className="safe-top flex min-h-[100dvh] flex-col px-6 pb-10">
      <div className="mt-6 flex items-center gap-3">
        <Sparkles size={28} style={{ color: "rgb(234 198 126)" }} />
        <span style={{ fontSize: 14, color: "rgb(210 205 193)" }}>FilterApps</span>
      </div>

      <div className="mt-20">
        <h1 className="font-display" style={{ fontSize: 44, lineHeight: 1.05, color: "rgb(248 244 233)" }}>
          Describe a look.
        </h1>
        <h1 className="font-display" style={{ fontSize: 44, lineHeight: 1.05, color: "rgb(152 147 136)" }}>
          Paint your photo.
        </h1>
      </div>

      {step === "email" ? (
        <>
          <p style={{ marginTop: 20, fontSize: 15, color: "rgb(152 147 136)" }}>
            We&apos;ll send you a 6-digit code — no password needed.
          </p>

          <form onSubmit={sendCode} style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: "100%", borderRadius: 999,
                border: "1px solid rgb(255 255 255 / 0.12)",
                background: "transparent", padding: "14px 20px",
                fontSize: 15, outline: "none",
                color: "rgb(248 244 233)", boxSizing: "border-box",
              }}
            />
            <button
              type="submit"
              disabled={status === "sending"}
              style={{
                width: "100%", borderRadius: 999, border: "none",
                padding: "14px 0", fontSize: 15, fontWeight: 600,
                background: status === "sending" ? "rgb(248 244 233 / 0.3)" : "rgb(248 244 233)",
                color: "rgb(14 13 12)", cursor: status === "sending" ? "default" : "pointer",
              }}
            >
              {status === "sending" ? "Sending…" : "Send code"}
            </button>
            {status === "error" && (
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 14, color: "#ff7b7b", margin: "0 0 8px" }}>{error}</p>
                <button
                  type="button"
                  onClick={() => { setStep("code"); setStatus("idle"); setError(null); setTimeout(() => inputRefs.current[0]?.focus(), 100); }}
                  style={{ fontSize: 13, color: "rgb(234 198 126)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                >
                  I already received a code →
                </button>
              </div>
            )}
          </form>

          <div style={{ margin: "24px 0", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, height: 1, background: "rgb(255 255 255 / 0.1)" }} />
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.2em", color: "rgb(96 92 83)" }}>or</span>
            <div style={{ flex: 1, height: 1, background: "rgb(255 255 255 / 0.1)" }} />
          </div>

          <button
            onClick={signInWithGoogle}
            style={{
              width: "100%", borderRadius: 999,
              border: "1px solid rgb(255 255 255 / 0.12)",
              background: "transparent", padding: "14px 0",
              fontSize: 15, cursor: "pointer", color: "rgb(248 244 233)",
            }}
          >
            Continue with Google
          </button>
        </>
      ) : (
        <>
          <p style={{ marginTop: 20, fontSize: 15, color: "rgb(152 147 136)" }}>
            Check your inbox and enter the 6-digit code.
          </p>

          {/* Code input */}
          <div style={{ marginTop: 40, display: "flex", gap: 10, justifyContent: "center" }}>
            {code.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleDigit(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                style={{
                  width: 44, height: 56, textAlign: "center",
                  fontSize: 22, fontWeight: 600, borderRadius: 14,
                  border: `1px solid ${digit ? "rgb(248 244 233 / 0.4)" : "rgb(255 255 255 / 0.12)"}`,
                  background: digit ? "rgb(255 255 255 / 0.06)" : "transparent",
                  color: "rgb(248 244 233)", outline: "none",
                  transition: "border-color 150ms, background 150ms",
                }}
              />
            ))}
          </div>

          {status === "verifying" && (
            <p style={{ textAlign: "center", marginTop: 20, fontSize: 14, color: "rgb(234 198 126)" }}>
              Verifying…
            </p>
          )}
          {status === "error" && (
            <p style={{ textAlign: "center", marginTop: 20, fontSize: 14, color: "#ff7b7b" }}>{error}</p>
          )}

          <button
            onClick={() => { setStep("email"); setCode(["","","","","",""]); setStatus("idle"); setError(null); }}
            style={{
              marginTop: 32, width: "100%", borderRadius: 999,
              border: "1px solid rgb(255 255 255 / 0.1)",
              background: "transparent", padding: "14px 0",
              fontSize: 14, cursor: "pointer", color: "rgb(152 147 136)",
            }}
          >
            Send a new code
          </button>
        </>
      )}
    </div>
  );
}
