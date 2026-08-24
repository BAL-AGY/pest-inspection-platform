"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { OverviewIcon, LeadsIcon, CalendarIcon, MarketingIcon, IntelligenceIcon, IntegrationsIcon } from "./nav-icons";

const NAV_ITEMS: { href: string; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { href: "/dashboard", label: "Overview", icon: OverviewIcon },
  { href: "/dashboard/leads", label: "Leads", icon: LeadsIcon },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarIcon },
  { href: "/dashboard/marketing", label: "Marketing", icon: MarketingIcon },
  { href: "/dashboard/intelligence", label: "Intelligence", icon: IntelligenceIcon },
  { href: "/dashboard/integrations", label: "Integrations", icon: IntegrationsIcon },
];

export default function DashboardNav() {
  const pathname = usePathname();
  return (
    <nav className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto text-sm">
      {NAV_ITEMS.map((item) => {
        // Overview ("/dashboard") must not match every nested route.
        const active = item.href === "/dashboard" ? pathname === "/dashboard" : pathname?.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 px-3 py-3 font-medium transition-colors ${
              active ? "border-emerald-700 text-emerald-800" : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
