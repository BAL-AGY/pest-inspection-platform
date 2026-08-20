import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/dashboard",
      });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect("/login?error=1");
      }
      throw err;
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center bg-zinc-50 px-6">
      <form
        action={login}
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
        <button className="rounded-md bg-emerald-700 px-6 py-3 font-semibold text-white">
          Sign in
        </button>
      </form>
    </main>
  );
}
