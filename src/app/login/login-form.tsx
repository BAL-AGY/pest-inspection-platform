"use client";

import { useFormStatus } from "react-dom";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-emerald-700 px-6 py-3 font-semibold text-white disabled:opacity-60"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export default function LoginForm({
  action,
  error,
}: {
  action: (formData: FormData) => void;
  error?: string;
}) {
  return (
    <form
      action={action}
      className="w-full max-w-sm bg-white border border-zinc-200 rounded-lg p-8 flex flex-col gap-4 shadow-sm"
    >
      <h1 className="text-xl font-bold">Staff login</h1>
      {error && (
        <p className="text-sm text-red-600">Invalid email or password.</p>
      )}
      <input
        required
        name="email"
        type="email"
        placeholder="Email"
        className="border border-zinc-300 rounded-md px-4 py-3"
      />
      <input
        required
        name="password"
        type="password"
        placeholder="Password"
        className="border border-zinc-300 rounded-md px-4 py-3"
      />
      <SubmitButton />
    </form>
  );
}
