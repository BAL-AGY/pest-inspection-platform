import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/require-session";
import { signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session) redirect("/login");
  const company = await prisma.company.findUnique({ where: { id: session.companyId }, select: { isDemo: true } });

  const nav = [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/leads", label: "Leads" },
    { href: "/dashboard/calendar", label: "Calendar" },
    { href: "/dashboard/marketing", label: "Marketing" },
  ];

  return (
    <div className="flex-1 flex flex-col bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <span className="flex items-center gap-3 font-bold">Owner Dashboard{company?.isDemo && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">DEMO DATA</span>}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button className="text-sm text-zinc-500 hover:text-zinc-800">Sign out</button>
          </form>
        </div>
        <nav className="max-w-6xl mx-auto px-4 flex gap-4 overflow-x-auto text-sm">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="py-3 border-b-2 border-transparent hover:border-emerald-700 whitespace-nowrap"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <div className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">{children}</div>
    </div>
  );
}
