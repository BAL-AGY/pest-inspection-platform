import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/require-session";
import { prisma } from "@/lib/prisma";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

const RANGE_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await requireSession();
  if (!session) redirect("/login");
  const { view = "week" } = await searchParams;
  const days = RANGE_DAYS[view] ?? 7;

  const rangeStart = startOfDay(new Date());
  const rangeEnd = new Date(rangeStart.getTime() + days * 24 * 60 * 60 * 1000);

  const appointments = await prisma.appointment.findMany({
    where: {
      companyId: session.companyId,
      scheduledStart: { gte: rangeStart, lt: rangeEnd },
      status: { in: ["booked", "rescheduled", "completed", "no_show"] },
    },
    include: { lead: true },
    orderBy: { scheduledStart: "asc" },
  });

  const byDay = new Map<string, typeof appointments>();
  for (const a of appointments) {
    const key = new Date(a.scheduledStart).toDateString();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(a);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Calendar</h1>
        <div className="flex gap-2 text-sm">
          {Object.keys(RANGE_DAYS).map((v) => (
            <Link
              key={v}
              href={`/dashboard/calendar?view=${v}`}
              className={`px-3 py-1.5 rounded border ${
                v === view ? "bg-emerald-700 text-white border-emerald-700" : "border-zinc-300"
              }`}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </Link>
          ))}
        </div>
      </div>

      {appointments.length === 0 && (
        <p className="text-zinc-400 text-sm">No inspections scheduled in this range.</p>
      )}

      <div className="flex flex-col gap-6">
        {Array.from(byDay.entries()).map(([day, dayAppointments]) => (
          <div key={day}>
            <h2 className="text-sm font-semibold text-zinc-500 uppercase mb-2">{day}</h2>
            <div className="flex flex-col gap-2">
              {dayAppointments.map((a) => (
                <Link
                  key={a.id}
                  href={`/dashboard/leads/${a.leadId}`}
                  className="bg-white border border-zinc-200 rounded-lg p-3 flex items-center justify-between text-sm hover:border-emerald-700"
                >
                  <div>
                    <p className="font-medium">
                      {new Date(a.scheduledStart).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {" — "}
                      {a.lead.firstName || a.lead.lastName
                        ? `${a.lead.firstName ?? ""} ${a.lead.lastName ?? ""}`.trim()
                        : "Unnamed lead"}
                    </p>
                    <p className="text-zinc-500 text-xs">
                      {a.lead.zipCode ?? "—"} · {a.lead.pestConcern ?? "—"}
                    </p>
                  </div>
                  <span className="text-xs uppercase text-zinc-500">{a.status}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
