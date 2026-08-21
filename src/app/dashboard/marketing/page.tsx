import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/require-session";
import { prisma } from "@/lib/prisma";
import { parseCompanyTimeZone } from "@/lib/company";
import { companyDayRange, formatInCompanyTime } from "@/lib/timezone";

export default async function MarketingPage() {
  const session = await requireSession();
  if (!session) redirect("/login");
  const company = await prisma.company.findUniqueOrThrow({ where: { id: session.companyId } });
  const timeZone = parseCompanyTimeZone(company);

  const entries = await prisma.marketingSpend.findMany({
    where: { companyId: session.companyId, isDemo: company.isDemo },
    orderBy: { periodStart: "desc" },
  });

  async function addSpend(formData: FormData) {
    "use server";
    const source = String(formData.get("source") ?? "").trim();
    const campaign = String(formData.get("campaign") ?? "").trim();
    const medium = String(formData.get("medium") ?? "").trim();
    const content = String(formData.get("content") ?? "").trim();
    const periodStart = String(formData.get("periodStart"));
    const periodEnd = String(formData.get("periodEnd"));
    const amount = Number(formData.get("amount"));
    let start: Date; let end: Date;
    try { start = companyDayRange(periodStart, timeZone).start; end = companyDayRange(periodEnd, timeZone).end; } catch { return; }
    if (
      !source ||
      source.length > 100 ||
      campaign.length > 200 ||
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      start > end ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) return;

    await prisma.marketingSpend.create({
      data: {
        companyId: session!.companyId,
        isDemo: company.isDemo,
        source,
        medium: medium || null,
        campaign: campaign || null,
        content: content || null,
        periodStart: start,
        periodEnd: end,
        amountCents: Math.round(amount * 100),
      },
    });
    revalidatePath("/dashboard/marketing");
    revalidatePath("/dashboard");
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Marketing spend</h1>
      <p className="text-sm text-zinc-500">
        Enter real spend by source/campaign to unlock cost-per-lead, cost-per-SQL, and cost-per-booked-inspection
        figures on the overview dashboard. Nothing is estimated until you enter it here.
      </p>

      <form action={addSpend} className="bg-white border border-zinc-200 rounded-lg p-4 grid grid-cols-2 gap-3">
        <input name="source" required placeholder="Source (e.g. google, facebook)" className="border border-zinc-300 rounded px-3 py-2 text-sm col-span-2" />
        <input name="medium" placeholder="Medium (optional, e.g. cpc)" className="border border-zinc-300 rounded px-3 py-2 text-sm col-span-2" />
        <input name="campaign" placeholder="Campaign (optional)" className="border border-zinc-300 rounded px-3 py-2 text-sm col-span-2" />
        <input name="content" placeholder="Creative/content (optional)" className="border border-zinc-300 rounded px-3 py-2 text-sm col-span-2" />
        <label className="text-xs text-zinc-500 flex flex-col gap-1">
          Period start
          <input name="periodStart" type="date" required className="border border-zinc-300 rounded px-3 py-2 text-sm" />
        </label>
        <label className="text-xs text-zinc-500 flex flex-col gap-1">
          Period end
          <input name="periodEnd" type="date" required className="border border-zinc-300 rounded px-3 py-2 text-sm" />
        </label>
        <label className="text-xs text-zinc-500 flex flex-col gap-1 col-span-2">
          Amount ($)
          <input name="amount" type="number" min="0.01" step="0.01" required className="border border-zinc-300 rounded px-3 py-2 text-sm" />
        </label>
        <button className="col-span-2 rounded bg-emerald-700 text-white px-4 py-2 text-sm font-semibold">
          Add spend entry
        </button>
      </form>

      <div className="flex flex-col gap-2">
        {entries.length === 0 && <p className="text-sm text-zinc-400">No spend entered yet.</p>}
        {entries.map((e) => (
          <div key={e.id} className="bg-white border border-zinc-200 rounded-lg p-3 text-sm flex justify-between">
            <div>
              <p className="font-medium">
                {e.source}
                {e.campaign ? ` — ${e.campaign}` : ""}
              </p>
              <p className="text-zinc-500 text-xs">
                {formatInCompanyTime(e.periodStart, timeZone, { dateStyle: "medium" })} – {formatInCompanyTime(new Date(e.periodEnd.getTime() - 1), timeZone, { dateStyle: "medium" })}
              </p>
            </div>
            <span className="font-semibold">${(e.amountCents / 100).toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
