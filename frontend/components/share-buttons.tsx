"use client";

import { useState } from "react";
import { Download, Share2, Check } from "lucide-react";

interface Props {
  imageUrl: string;
  filename: string;
  shareUrl?: string;
  shareTitle?: string;
}

export function ShareButtons({ imageUrl, filename, shareUrl, shareTitle }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleDownload() {
    const res = await fetch(imageUrl);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleShare() {
    try {
      if (typeof navigator !== "undefined" && "canShare" in navigator) {
        const res = await fetch(imageUrl);
        const blob = await res.blob();
        const file = new File([blob], filename, { type: blob.type });
        if ((navigator as Navigator).canShare?.({ files: [file] })) {
          await (navigator as Navigator).share?.({
            files: [file],
            title: shareTitle ?? "FilterApps",
          });
          return;
        }
      }
      if (navigator.share && shareUrl) {
        await navigator.share({ url: shareUrl, title: shareTitle });
        return;
      }
    } catch {
      /* user cancelled */
    }
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        onClick={handleDownload}
        className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-medium"
        style={{ background: "rgb(248 244 233)", color: "rgb(14 13 12)" }}
      >
        <Download className="h-4 w-4" /> Save
      </button>
      <button
        onClick={handleShare}
        className="inline-flex items-center justify-center gap-2 rounded-full border px-4 py-3 text-sm font-medium"
        style={{
          borderColor: "rgb(255 255 255 / 0.12)",
          color: "rgb(248 244 233)",
        }}
      >
        {copied ? (
          <>
            <Check className="h-4 w-4" /> Copied
          </>
        ) : (
          <>
            <Share2 className="h-4 w-4" /> Share
          </>
        )}
      </button>
    </div>
  );
}
