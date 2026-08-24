"use client";

// Catches the case where the sign-in request itself fails to complete
// (e.g. a Render free-tier instance still spinning up from an idle
// state, or a dropped connection) rather than the credentials being
// rejected — that case is handled by ?error=1 in page.tsx instead. Without
// this boundary, a failed request just silently lands back on a blank
// login form with no explanation.
export default function LoginError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex-1 flex items-center justify-center bg-zinc-50 px-6">
      <div className="w-full max-w-sm bg-white border border-zinc-200 rounded-lg p-8 flex flex-col gap-4 shadow-sm text-center">
        <h1 className="text-xl font-bold">Sign-in didn&apos;t go through</h1>
        <p className="text-sm text-zinc-600">
          The server may still be waking up from being idle — this can take up to a minute on
          staging. Please wait a moment and try again.
        </p>
        <button
          onClick={reset}
          className="rounded-md bg-emerald-700 px-6 py-3 font-semibold text-white"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
