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
 * a tasteful static gradient (or the poster image, once loaded) otherwise.
 *
 * Current asset: public/hero/technician-inspection.{mp4,webm} + .jpg poster
 * — a technician in a hard hat and hi-vis vest inspecting a suburban home's
 * doorway with a clipboard, shot from outside (siding visible both sides).
 * Sourced from Pexels ("A Man Inspecting the Door Hinges" by RDNE Stock
 * project, pexels.com/video/a-man-inspecting-the-door-hinges-8293308),
 * used under the Pexels License (free for commercial use, no attribution
 * required, modification permitted — pexels.com/license). Downloaded at
 * 1920x1080, then re-encoded here to a muted, 7s, 1280px-wide loop with no
 * audio track to keep it small (~330KB MP4 / ~260KB WebM) and fast on
 * mobile. To replace with different footage later, drop new files at the
 * same paths and this component needs no changes.
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

  // Whenever the video isn't actually playing (reduced motion, not yet
  // loaded, or errored) the poster photo itself is the fallback — a real
  // premium photo of the technician, not just an abstract gradient — so a
  // reduced-motion visitor or a slow connection still gets the intended
  // "this is being professionally handled" feeling immediately.
  const showPosterFallback = Boolean(posterSrc) && (!showVideo || !ready);

  return (
    <div className="absolute inset-0 -z-10 overflow-hidden bg-gradient-to-br from-emerald-950 via-emerald-900 to-zinc-900">
      {/* Tasteful abstract pattern — the ultimate fallback if even the poster photo can't load. */}
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(circle at 15% 20%, rgba(16,185,129,0.35), transparent 42%), radial-gradient(circle at 85% 75%, rgba(15,23,42,0.7), transparent 48%), radial-gradient(circle at 50% 100%, rgba(5,150,105,0.25), transparent 55%)",
        }}
        aria-hidden
      />
      {showPosterFallback && posterSrc && (
        <div
          className="absolute inset-0 bg-cover bg-center transition-opacity duration-500"
          style={{ backgroundImage: `url(${posterSrc})` }}
          aria-hidden
        />
      )}
      {showVideo && videoSrc && (
        <video
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${ready ? "opacity-60" : "opacity-0"}`}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
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
