import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/require-session";
import { prisma } from "@/lib/prisma";
import { LEAD_STATUSES } from "@/lib/pipeline";
import { cancelAppointmentAndNotify } from "@/lib/appointment-actions";
import { parseCompanyTimeZone } from "@/lib/company";
import { formatInCompanyTime } from "@/lib/timezone";
import { QUALIFICATION_QUESTIONS, parseStoredQualificationAnswers } from "@/lib/qualification";
import { attributionFromLead, clearRevenueEvent, recordCustomerOutcomeEvent, recordFunnelEvent, recordRevenueEvent } from "@/lib/analytics-events";

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

function answerLabel(questionId: string, value: unknown): string {
  const question = QUALIFICATION_QUESTIONS.find((candidate) => candidate.id === questionId);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value !== "string") return "—";
  return question?.options?.find((option) => option.value === value)?.label ?? value;
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

  const answers = parseStoredQualificationAnswers(lead.qualificationAnswers);

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
    const contractValueCents =
      contractValueRaw && String(contractValueRaw).trim() !== ""
        ? Math.round(Number(contractValueRaw) * 100)
        : undefined;
    if (contractValueCents !== undefined && (!Number.isFinite(contractValueCents) || contractValueCents < 0)) return;
    const ownedLead = await prisma.lead.findFirst({ where: { id, companyId: actionSession.companyId } });
    if (!ownedLead) return;
    await prisma.lead.update({
      where: { id },
      data: {
        outcome,
        status: outcome === "won" ? "customer_won" : "customer_lost",
        ...(contractValueCents !== undefined ? { contractValueCents } : {}),
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
    const ownedLead = await prisma.lead.findFirst({ where: { id, companyId: actionSession.companyId } });
    if (!ownedLead) return;
    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: "completed", completedAt: new Date() },
      });
      await tx.lead.update({ where: { id }, data: { status: "inspection_completed" } });
      await recordFunnelEvent({ companyId: actionSession.companyId, leadId: id, appointmentId, visitorId: ownedLead.visitorId ?? id, eventType: "inspection_completed", eventKey: `appointment:${appointmentId}:completed`, funnelStep: "completed", isDemo: ownedLead.isDemo, attribution: attributionFromLead(ownedLead) }, tx);
    });
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
    await prisma.appointment.update({ where: { id: appointmentId }, data: { status: "no_show" } });
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

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">
          {lead.firstName || lead.lastName
            ? `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim()
            : "Unnamed lead"}
        </h1>
        <p className="text-zinc-500 text-sm mt-1">
          {lead.email ?? "no email"} · {lead.phone ?? "no phone"}
        </p>
      </div>

      <section aria-label="Lead summary" className="bg-white border border-zinc-200 rounded-lg p-4 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-zinc-500">Score</p>
          <p className="font-semibold">{lead.score}</p>
        </div>
        <div>
          <p className="text-zinc-500">Classification</p>
          <p className="font-semibold uppercase">{lead.classification}</p>
        </div>
        <div>
          <p className="text-zinc-500">Status</p>
          <p className="font-semibold">{lead.status}</p>
        </div>
        <div>
          <p className="text-zinc-500">ZIP</p>
          <p className="font-semibold">{lead.zipCode ?? "—"}</p>
        </div>
        <div>
          <p className="text-zinc-500">Pest concern</p>
          <p className="font-semibold">{lead.pestConcern ?? "—"}</p>
        </div>
        <div>
          <p className="text-zinc-500">Homeowner</p>
          <p className="font-semibold">{lead.isHomeowner === null ? "—" : lead.isHomeowner ? "Yes" : "No"}</p>
        </div>
        <div>
          <p className="text-zinc-500">Current pest provider</p>
          <p className="font-semibold">{lead.hasExistingProvider === null ? "—" : lead.hasExistingProvider ? "Yes" : "No"}</p>
        </div>
        {lead.hasExistingProvider && <div><p className="text-zinc-500">Switcher reason</p><p className="font-semibold">{answerLabel("switchReason", lead.switchReason)}</p></div>}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase mb-2">Attribution</h2>
        <div className="bg-white border border-zinc-200 rounded-lg p-4 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div><p className="text-zinc-500">First-touch source</p><p className="font-semibold">{lead.source ?? "direct"}</p></div>
          <div><p className="text-zinc-500">First-touch medium</p><p className="font-semibold">{lead.medium ?? "—"}</p></div>
          <div><p className="text-zinc-500">First-touch campaign</p><p className="font-semibold">{lead.campaign ?? "—"}</p></div>
          <div><p className="text-zinc-500">Last-touch source</p><p className="font-semibold">{lead.lastSource ?? lead.source ?? "direct"}</p></div>
          <div><p className="text-zinc-500">Last-touch medium</p><p className="font-semibold">{lead.lastMedium ?? lead.medium ?? "—"}</p></div>
          <div><p className="text-zinc-500">Last-touch campaign</p><p className="font-semibold">{lead.lastCampaign ?? lead.campaign ?? "—"}</p></div>
          <div className="col-span-2 sm:col-span-3"><p className="text-zinc-500">First landing page</p><p className="font-semibold break-all">{lead.landingPage ?? "—"}</p></div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase mb-2">Qualification answers</h2>
        <div className="bg-white border border-zinc-200 rounded-lg p-4 text-sm grid grid-cols-2 gap-2">
          {QUALIFICATION_QUESTIONS.filter((question) => question.id in answers).map((question) => (
            <div key={question.id}>
              <span className="text-zinc-500">{question.prompt} </span>
              <span className="font-medium">{answerLabel(question.id, answers[question.id])}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase mb-2">Appointments</h2>
        <div className="flex flex-col gap-2">
          {lead.appointments.length === 0 && (
            <p className="text-sm text-zinc-400">No appointments booked.</p>
          )}
          {lead.appointments.map((a) => (
            <div key={a.id} className="bg-white border border-zinc-200 rounded-lg p-3 text-sm flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="font-medium">
                  {formatInCompanyTime(a.scheduledStart, timeZone, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    timeZoneName: "short",
                  })}
                </p>
                <p className="text-zinc-500 text-xs">{a.status}</p>
              </div>
              {a.status === "booked" && (
                <div className="flex gap-2">
                  <form action={completeInspection}>
                    <input type="hidden" name="appointmentId" value={a.id} />
                    <button className="text-xs rounded bg-emerald-700 text-white px-3 py-1.5">
                      Mark completed
                    </button>
                  </form>
                  <form action={markNoShow}>
                    <input type="hidden" name="appointmentId" value={a.id} />
                    <button className="text-xs rounded border border-zinc-300 px-3 py-1.5">
                      No-show
                    </button>
                  </form>
                  <form action={cancelAppointment}>
                    <input type="hidden" name="appointmentId" value={a.id} />
                    <button className="text-xs rounded border border-red-300 text-red-600 px-3 py-1.5">
                      Cancel
                    </button>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase mb-2">Outcome</h2>
        <form action={setOutcome} className="flex flex-wrap items-end gap-2 bg-white border border-zinc-200 rounded-lg p-4">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Contract value ($)</label>
            <input name="contractValue" type="number" step="0.01" className="border border-zinc-300 rounded px-3 py-2 text-sm w-32" />
          </div>
          <button name="outcome" value="won" className="text-sm rounded bg-emerald-700 text-white px-4 py-2">
            Mark Won
          </button>
          <button name="outcome" value="lost" className="text-sm rounded border border-zinc-300 px-4 py-2">
            Mark Lost
          </button>
        </form>
        {lead.outcome && (
          <p className="text-sm text-zinc-500 mt-2">
            Current outcome: <strong>{lead.outcome}</strong>
            {lead.contractValueCents ? ` · $${(lead.contractValueCents / 100).toFixed(2)}` : ""}
          </p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase mb-2">Pipeline status</h2>
        <form action={updateStatus} className="flex gap-2 flex-wrap">
          <select name="status" defaultValue={lead.status} className="border border-zinc-300 rounded px-3 py-2 text-sm">
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className="text-sm rounded bg-zinc-800 text-white px-4 py-2">Update</button>
        </form>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase mb-2">Notes</h2>
        <form action={addNote} className="flex gap-2 mb-3">
          <input name="body" placeholder="Add a note…" className="flex-1 border border-zinc-300 rounded px-3 py-2 text-sm" />
          <button className="text-sm rounded bg-zinc-800 text-white px-4 py-2">Add</button>
        </form>
        <div className="flex flex-col gap-2">
          {lead.notes.map((n) => (
            <div key={n.id} className="bg-white border border-zinc-200 rounded-lg p-3 text-sm">
              <p>{n.body}</p>
              <p className="text-xs text-zinc-400 mt-1">
                {n.authorId ?? "staff"} · {new Date(n.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase mb-2">Timeline</h2>
        <div className="flex flex-col gap-1 text-sm text-zinc-600">
          {lead.funnelEvents.map((e) => (
            <div key={e.id} className="flex justify-between">
              <span>{EVENT_LABELS[e.eventType] ?? e.eventType.replaceAll("_", " ")}</span>
              <span className="text-zinc-400">{formatInCompanyTime(e.createdAt, timeZone, { dateStyle: "medium", timeStyle: "short" })}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
