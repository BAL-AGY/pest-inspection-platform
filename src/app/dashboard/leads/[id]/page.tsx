import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/require-session";
import { prisma } from "@/lib/prisma";
import {
  APPOINTMENT_STATUS_LABELS,
  LEAD_STATUS_LABELS,
  LEAD_STATUSES,
  type AppointmentStatus,
  type LeadStatus,
} from "@/lib/pipeline";
import { cancelAppointmentAndNotify, completeAppointmentAndLog, markAppointmentNoShowAndLog } from "@/lib/appointment-actions";
import { parseCompanyTimeZone } from "@/lib/company";
import { formatInCompanyTime } from "@/lib/timezone";
import { QUALIFICATION_QUESTIONS, parseStoredQualificationAnswers } from "@/lib/qualification";
import { attributionFromLead, clearRevenueEvent, recordCustomerOutcomeEvent, recordRevenueEvent } from "@/lib/analytics-events";
import { formatPotentialValueRange, isServiceArrangement, parsePestCategories, parseServiceArrangements, pestCategoryForConcern, serviceArrangementLabel } from "@/lib/service-catalog";
import { Badge, Card, SectionHeader } from "../../ui";

const EVENT_LABELS: Record<string, string> = {
  lead_created: "Lead created",
  contact_information_submitted: "Contact details captured",
  lead_qualified: "Qualified lead",
  lead_disqualified: "Lead did not qualify",
  scheduling_viewed: "Viewed inspection availability",
  inspection_booked: "Booked free home inspection",
  inspection_completed: "Inspection completed",
  customer_won: "Customer won",
  customer_lost: "Customer lost",
};

const STATUS_BADGE_TONE: Record<LeadStatus, "neutral" | "emerald" | "amber" | "sky" | "violet" | "rose"> = {
  new: "neutral",
  engaged: "sky",
  mql: "amber",
  sql: "violet",
  inspection_booked: "emerald",
  inspection_completed: "emerald",
  customer_won: "emerald",
  customer_lost: "rose",
};

function answerLabel(questionId: string, value: unknown): string {
  const question = QUALIFICATION_QUESTIONS.find((candidate) => candidate.id === questionId);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const options = [...(question?.options ?? []), ...(question?.acceptedOptions ?? [])];
  const labelFor = (item: string) => options.find((option) => option.value === item)?.label ?? item;
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((item) => labelFor(String(item))).join(", ") : "—";
  }
  if (typeof value !== "string") return "—";
  return labelFor(value);
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-zinc-500">{label}</p>
      <p className="truncate text-sm font-semibold text-zinc-900">{value}</p>
    </div>
  );
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  if (!session) redirect("/login");
  const { id } = await params;

  const lead = await prisma.lead.findFirst({
    where: { id, companyId: session.companyId },
    include: {
      appointments: { orderBy: { scheduledStart: "desc" } },
      funnelEvents: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!lead) notFound();
  const company = await prisma.company.findUnique({ where: { id: session.companyId } });
  if (!company) notFound();
  const timeZone = parseCompanyTimeZone(company);
  const pestCategories = parsePestCategories(company);
  const serviceArrangements = parseServiceArrangements(company);
  const acquisitionCategory = pestCategories.find((category) => category.id === lead.pestCategory)
    ?? pestCategoryForConcern(pestCategories, lead.pestConcern);
  const potentialValueRange = acquisitionCategory ? formatPotentialValueRange(acquisitionCategory) : null;

  const answers = parseStoredQualificationAnswers(lead.qualificationAnswers);
  const nextAppointment = lead.appointments.find((a) => a.status === "booked" || a.status === "rescheduled") ?? lead.appointments[0] ?? null;

  async function addNote(formData: FormData) {
    "use server";
    const actionSession = await requireSession();
    if (!actionSession) return;
    const body = String(formData.get("body") ?? "").trim();
    if (!body || body.length > 5_000) return;
    const ownedLead = await prisma.lead.findFirst({ where: { id, companyId: actionSession.companyId } });
    if (!ownedLead) return;
    await prisma.leadNote.create({ data: { leadId: id, body, authorId: actionSession.email } });
    revalidatePath(`/dashboard/leads/${id}`);
  }

  async function updateStatus(formData: FormData) {
    "use server";
    const actionSession = await requireSession();
    if (!actionSession) return;
    const status = String(formData.get("status"));
    if (!LEAD_STATUSES.includes(status as (typeof LEAD_STATUSES)[number])) return;
    const current = await prisma.lead.findFirst({ where: { id, companyId: actionSession.companyId } });
    if (!current) return;
    await prisma.lead.update({ where: { id }, data: { status } });
    await prisma.auditLog.create({
      data: {
        companyId: actionSession.companyId,
        action: "status_change",
        entityType: "Lead",
        entityId: id,
        metadata: JSON.stringify({ from: current.status, to: status }),
      },
    });
    revalidatePath(`/dashboard/leads/${id}`);
  }

  async function setOutcome(formData: FormData) {
    "use server";
    const actionSession = await requireSession();
    if (!actionSession) return;
    const outcome = String(formData.get("outcome"));
    if (outcome !== "won" && outcome !== "lost") return;
    const contractValueRaw = formData.get("contractValue");
    const actualPestCategory = String(formData.get("actualPestCategory") ?? "");
    const serviceArrangement = String(formData.get("serviceArrangement") ?? "");
    const contractValueCents =
      contractValueRaw && String(contractValueRaw).trim() !== ""
        ? Math.round(Number(contractValueRaw) * 100)
        : undefined;
    if (contractValueCents !== undefined && (!Number.isFinite(contractValueCents) || contractValueCents < 0)) return;
    const ownedLead = await prisma.lead.findFirst({ where: { id, companyId: actionSession.companyId } });
    if (!ownedLead) return;
    const actionCompany = await prisma.company.findUnique({ where: { id: actionSession.companyId } });
    if (!actionCompany) return;
    const validCategory = parsePestCategories(actionCompany).some((category) => category.id === actualPestCategory);
    const validArrangement = isServiceArrangement(serviceArrangement) && parseServiceArrangements(actionCompany).includes(serviceArrangement);
    if ((actualPestCategory && !validCategory) || (serviceArrangement && !validArrangement)) return;
    await prisma.lead.update({
      where: { id },
      data: {
        outcome,
        status: outcome === "won" ? "customer_won" : "customer_lost",
        ...(outcome === "lost" ? { contractValueCents: null } : contractValueCents !== undefined ? { contractValueCents } : {}),
        ...(actualPestCategory ? { actualPestCategory } : {}),
        ...(serviceArrangement ? { serviceArrangement } : {}),
      },
    });
    await recordCustomerOutcomeEvent({
      companyId: actionSession.companyId, leadId: id, visitorId: ownedLead.visitorId ?? id,
      outcome, isDemo: ownedLead.isDemo,
      attribution: attributionFromLead(ownedLead),
    });
    const value = contractValueCents ?? ownedLead.contractValueCents;
    if (outcome === "won" && value !== null) await recordRevenueEvent({ companyId: actionSession.companyId, leadId: id, visitorId: ownedLead.visitorId ?? id, amountCents: value, isDemo: ownedLead.isDemo, attribution: attributionFromLead(ownedLead) });
    if (outcome === "lost") await clearRevenueEvent(actionSession.companyId, id);
    await prisma.auditLog.create({
      data: {
        companyId: actionSession.companyId,
        action: "outcome_change",
        entityType: "Lead",
        entityId: id,
        metadata: JSON.stringify({ from: ownedLead.outcome, to: outcome, contractValueCents: outcome === "won" ? value : null }),
      },
    });
    revalidatePath(`/dashboard/leads/${id}`);
  }

  async function completeInspection(formData: FormData) {
    "use server";
    const actionSession = await requireSession();
    if (!actionSession) return;
    const appointmentId = String(formData.get("appointmentId"));
    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, leadId: id, companyId: actionSession.companyId, status: "booked" },
    });
    if (!appointment) return;
    await completeAppointmentAndLog(appointmentId, actionSession.companyId);
    revalidatePath(`/dashboard/leads/${id}`);
  }

  async function markNoShow(formData: FormData) {
    "use server";
    const actionSession = await requireSession();
    if (!actionSession) return;
    const appointmentId = String(formData.get("appointmentId"));
    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, leadId: id, companyId: actionSession.companyId, status: "booked" },
    });
    if (!appointment) return;
    await markAppointmentNoShowAndLog(appointmentId, actionSession.companyId);
    revalidatePath(`/dashboard/leads/${id}`);
  }

  async function cancelAppointment(formData: FormData) {
    "use server";
    const actionSession = await requireSession();
    if (!actionSession) return;
    const appointmentId = String(formData.get("appointmentId"));
    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, leadId: id, companyId: actionSession.companyId, status: "booked" },
    });
    if (!appointment) return;
    await cancelAppointmentAndNotify(appointmentId, actionSession.companyId);
    revalidatePath(`/dashboard/leads/${id}`);
  }

  const displayName = lead.firstName || lead.lastName ? `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() : "Unnamed lead";

  return (
    <div className="flex flex-col gap-6">
      {/* TOP — homeowner identity, stage, qualification, appointment, source at a glance */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight text-zinc-900">{displayName}</h1>
          <p className="mt-1 truncate text-sm text-zinc-500">{lead.email ?? "no email"} · {lead.phone ?? "no phone"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={STATUS_BADGE_TONE[lead.status as LeadStatus] ?? "neutral"}>{LEAD_STATUS_LABELS[lead.status as LeadStatus] ?? lead.status}</Badge>
          <Badge tone="neutral">Score {lead.score}</Badge>
          {nextAppointment && <Badge tone="emerald">{formatInCompanyTime(nextAppointment.scheduledStart, timeZone, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</Badge>}
        </div>
      </div>

      <section aria-label="Lead summary">
        <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
          <div><p className="text-zinc-500 text-sm">Score</p><p className="font-semibold">{lead.score}</p></div>
          <div><p className="text-zinc-500 text-sm">Classification</p><p className="font-semibold uppercase">{lead.classification}</p></div>
          <div><p className="text-zinc-500 text-sm">Status</p><p className="font-semibold">{LEAD_STATUS_LABELS[lead.status as LeadStatus] ?? lead.status}</p></div>
          <div><p className="text-zinc-500 text-sm">ZIP</p><p className="font-semibold">{lead.zipCode ?? "—"}</p></div>
          <div><p className="text-zinc-500 text-sm">Pest concern</p><p className="font-semibold">{answerLabel("pestType", lead.pestConcern)}</p></div>
          <div><p className="text-zinc-500 text-sm">Pest category</p><p className="font-semibold">{acquisitionCategory?.label ?? "—"}</p></div>
          <div><p className="text-zinc-500 text-sm">Urgency</p><p className="font-semibold">{answerLabel("timeline", answers.timeline)}</p></div>
          <div><p className="text-zinc-500 text-sm">Homeowner</p><p className="font-semibold">{lead.isHomeowner === null ? "—" : lead.isHomeowner ? "Yes" : "No"}</p></div>
          <div><p className="text-zinc-500 text-sm">Current pest provider</p><p className="font-semibold">{lead.hasExistingProvider === null ? "—" : lead.hasExistingProvider ? "Yes" : "No"}</p></div>
          {lead.hasExistingProvider && <div><p className="text-zinc-500 text-sm">Switcher reason</p><p className="font-semibold">{answerLabel("switchReason", lead.switchReason)}</p></div>}
        </Card>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* LEFT — pest situation + qualification answers */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          {potentialValueRange && (
            <Card className="border-amber-200 bg-amber-50 p-4">
              <h2 className="font-semibold text-amber-900">Potential Value Range</h2>
              <p className="mt-1 text-lg font-bold text-amber-950">{potentialValueRange}</p>
              <p className="mt-1 text-xs text-amber-800">Internal acquisition context only. Every property requires an inspection; this is not a homeowner quote and is never counted as revenue.</p>
            </Card>
          )}

          <section>
            <SectionHeader title="Qualification answers" />
            <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
              {QUALIFICATION_QUESTIONS.filter((question) => question.id in answers).map((question) => (
                <Field key={question.id} label={question.prompt} value={answerLabel(question.id, answers[question.id])} />
              ))}
            </Card>
          </section>

          <section>
            <SectionHeader title="Appointments" />
            <div className="flex flex-col gap-2">
              {lead.appointments.length === 0 && <p className="text-sm text-zinc-400">No appointments booked.</p>}
              {lead.appointments.map((a) => (
                <Card key={a.id} className="flex flex-wrap items-center justify-between gap-4 p-3">
                  <div>
                    <p className="font-medium">
                      {formatInCompanyTime(a.scheduledStart, timeZone, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
                    </p>
                    <p className="text-zinc-500 text-xs">{APPOINTMENT_STATUS_LABELS[a.status as AppointmentStatus] ?? a.status}</p>
                  </div>
                  {a.status === "booked" && (
                    <div className="flex gap-2">
                      <form action={completeInspection}>
                        <input type="hidden" name="appointmentId" value={a.id} />
                        <button className="rounded-full bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800">Mark completed</button>
                      </form>
                      <form action={markNoShow}>
                        <input type="hidden" name="appointmentId" value={a.id} />
                        <button className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium transition-colors hover:border-zinc-400">No-show</button>
                      </form>
                      <form action={cancelAppointment}>
                        <input type="hidden" name="appointmentId" value={a.id} />
                        <button className="rounded-full border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50">Cancel</button>
                      </form>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </section>

          <section>
            <SectionHeader title="Notes" />
            <form action={addNote} className="mb-3 flex gap-2">
              <input name="body" placeholder="Add a note…" className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100" />
              <button className="shrink-0 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-800">Add</button>
            </form>
            <div className="flex flex-col gap-2">
              {lead.notes.map((n) => (
                <Card key={n.id} className="p-3">
                  <p className="text-sm">{n.body}</p>
                  <p className="mt-1 text-xs text-zinc-400">{n.authorId ?? "staff"} · {new Date(n.createdAt).toLocaleString()}</p>
                </Card>
              ))}
            </div>
          </section>
        </div>

        {/* RIGHT — attribution, outcome, pipeline status */}
        <div className="flex flex-col gap-6">
          <section>
            <SectionHeader title="Attribution" />
            <Card className="grid grid-cols-2 gap-3 p-4 text-sm">
              <Field label="First-touch source" value={lead.source ?? "direct"} />
              <Field label="First-touch medium" value={lead.medium ?? "—"} />
              <Field label="First-touch campaign" value={lead.campaign ?? "—"} />
              <Field label="Last-touch source" value={lead.lastSource ?? lead.source ?? "direct"} />
              <Field label="Last-touch medium" value={lead.lastMedium ?? lead.medium ?? "—"} />
              <Field label="Last-touch campaign" value={lead.lastCampaign ?? lead.campaign ?? "—"} />
              <div className="col-span-2 min-w-0"><p className="text-zinc-500 text-sm">First landing page</p><p className="break-all text-sm font-semibold">{lead.landingPage ?? "—"}</p></div>
            </Card>
          </section>

          <section>
            <SectionHeader title="Outcome" />
            <Card className="p-4">
              <form action={setOutcome} className="flex flex-col gap-3">
                <label className="text-xs text-zinc-500">Actual pest/service category
                  <select name="actualPestCategory" defaultValue={lead.actualPestCategory ?? acquisitionCategory?.id ?? ""} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm">
                    <option value="">Not recorded</option>
                    {pestCategories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
                  </select>
                </label>
                <label className="text-xs text-zinc-500">Service arrangement
                  <select name="serviceArrangement" defaultValue={lead.serviceArrangement ?? ""} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm">
                    <option value="">Not recorded</option>
                    {serviceArrangements.map((arrangement) => <option key={arrangement} value={arrangement}>{serviceArrangementLabel(arrangement)}</option>)}
                  </select>
                </label>
                <label className="text-xs text-zinc-500">Actual contract value ($)
                  <input name="contractValue" type="number" step="0.01" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
                </label>
                <div className="flex gap-2">
                  <button name="outcome" value="won" className="flex-1 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-800">Mark Won</button>
                  <button name="outcome" value="lost" className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:border-zinc-400">Mark Lost</button>
                </div>
              </form>
              {lead.outcome && (
                <p className="mt-3 text-sm text-zinc-500">
                  Current outcome: <strong>{lead.outcome}</strong>
                  {lead.actualPestCategory ? ` · ${pestCategories.find((category) => category.id === lead.actualPestCategory)?.label ?? lead.actualPestCategory}` : ""}
                  {lead.serviceArrangement ? ` · ${serviceArrangementLabel(lead.serviceArrangement)}` : ""}
                  {lead.contractValueCents ? ` · $${(lead.contractValueCents / 100).toFixed(2)}` : ""}
                </p>
              )}
            </Card>
          </section>

          <section>
            <SectionHeader title="Pipeline status" />
            <Card className="p-4">
              <form action={updateStatus} className="flex flex-col gap-2">
                <select name="status" defaultValue={lead.status} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm">
                  {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}
                </select>
                <button className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-800">Update</button>
              </form>
            </Card>
          </section>
        </div>
      </div>

      {/* BOTTOM — activity timeline, using the actual stored lifecycle events */}
      <section>
        <SectionHeader title="Timeline" />
        <Card className="p-4">
          <div className="flex flex-col">
            {lead.funnelEvents.map((e, i) => (
              <div key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                {i < lead.funnelEvents.length - 1 && <span className="absolute left-[5px] top-3 h-full w-px bg-zinc-200" aria-hidden />}
                <span className="relative mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-600 ring-4 ring-emerald-100" aria-hidden />
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-sm text-zinc-700">{EVENT_LABELS[e.eventType] ?? e.eventType.replaceAll("_", " ")}</span>
                  <span className="text-xs text-zinc-400">{formatInCompanyTime(e.createdAt, timeZone, { dateStyle: "medium", timeStyle: "short" })}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}
