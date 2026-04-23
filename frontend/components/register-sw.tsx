"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function RegisterSW() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* ignore: SW is progressive enhancement */
    });
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!installEvent || dismissed) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-sm rounded-lg border border-white/15 bg-neutral-950/95 p-4 shadow-xl backdrop-blur">
      <div className="text-sm font-medium">Install FilterApps</div>
      <div className="mt-1 text-xs text-white/60">
        Add to your home screen for a faster, app-like experience.
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={() => setDismissed(true)}
          className="rounded px-3 py-1 text-xs text-white/60 hover:text-white"
        >
          Not now
        </button>
        <button
          onClick={async () => {
            await installEvent.prompt();
            await installEvent.userChoice;
            setInstallEvent(null);
          }}
          className="rounded bg-white px-3 py-1 text-xs font-medium text-black"
        >
          Install
        </button>
      </div>
    </div>
  );
}
