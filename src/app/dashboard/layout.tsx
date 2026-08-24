import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require-session";
import { signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isStagingEnvironment } from "@/lib/environment";
import DashboardNav from "./nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session) redirect("/login");
  const company = await prisma.company.findUnique({ where: { id: session.companyId }, select: { isDemo: true, name: true } });

  return (
    <div className="flex-1 flex flex-col bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-zinc-900">{company?.name ?? "Owner Dashboard"}</span>
            {isStagingEnvironment() && <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800">STAGING</span>}
            {company?.isDemo && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">DEMO DATA</span>}
            {isStagingEnvironment() && <span className="rounded-full bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-800">MESSAGES SIMULATED</span>}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button className="text-sm text-zinc-500 hover:text-zinc-800">Sign out</button>
          </form>
        </div>
        <DashboardNav />
      </header>
      <div className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">{children}</div>
    </div>
  );
}
