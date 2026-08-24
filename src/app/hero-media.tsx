"use client";

import { useState, useSyncExternalStore } from "react";

function subscribeReducedMotion(callback: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
function getReducedMotionSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
// Conservative SSR default: never claim the visitor is fine with motion
// before we can actually check — the video only ever turns on after the
// client confirms that.
function getReducedMotionServerSnapshot() {
  return true;
}

/**
 * Hero background media. Plays a short muted looping video when a source is
 * configured and the visitor hasn't requested reduced motion; falls back to
 * a tasteful static gradient otherwise — including right now, since no
 * licensed/approved video asset exists in this repo yet.
 *
 * To add a real video later:
 * 1. Drop an approved, properly licensed MP4 (and ideally a WebM for
 *    smaller file size) into `public/hero/` — e.g.
 *    `public/hero/technician-perimeter.mp4` and `.webm`. Ideal footage: a
 *    uniformed technician treating the exterior perimeter of a clean
 *    suburban home. Keep it short (5–10s), muted-safe, and under ~3MB.
 * 2. Pass the paths in from src/app/page.tsx:
 *      <HeroMedia videoSrc="/hero/technician-perimeter.mp4" webmSrc="/hero/technician-perimeter.webm" posterSrc="/hero/technician-perimeter.jpg" />
 * No other changes are required — this component already handles the
 * loading/fade-in, autoplay-policy fallback, and prefers-reduced-motion.
 */
export default function HeroMedia({
  videoSrc,
  webmSrc,
  posterSrc,
}: {
  videoSrc?: string;
  webmSrc?: string;
  posterSrc?: string;
}) {
  const [ready, setReady] = useState(false);
  const [errored, setErrored] = useState(false);
  const prefersReducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
  const showVideo = Boolean(videoSrc) && !prefersReducedMotion && !errored;

  return (
    <div className="absolute inset-0 -z-10 overflow-hidden bg-gradient-to-br from-emerald-950 via-emerald-900 to-zinc-900">
      {/* Tasteful fallback pattern — always present underneath, visible whenever video isn't playing. */}
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(circle at 15% 20%, rgba(16,185,129,0.35), transparent 42%), radial-gradient(circle at 85% 75%, rgba(15,23,42,0.7), transparent 48%), radial-gradient(circle at 50% 100%, rgba(5,150,105,0.25), transparent 55%)",
        }}
        aria-hidden
      />
      {showVideo && videoSrc && (
        <video
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${ready ? "opacity-60" : "opacity-0"}`}
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          poster={posterSrc}
          onCanPlay={() => setReady(true)}
          onError={() => setErrored(true)}
        >
          <source src={videoSrc} type="video/mp4" />
          {webmSrc && <source src={webmSrc} type="video/webm" />}
        </video>
      )}
      {/* Readability overlay — text must stay legible whether or not the video loaded. */}
      <div className="absolute inset-0 bg-gradient-to-t from-emerald-950/95 via-emerald-950/70 to-emerald-950/60" aria-hidden />
    </div>
  );
}
