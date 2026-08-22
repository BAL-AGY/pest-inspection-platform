"use client";

import { useEffect, useMemo, useState } from "react";
import {
  QUALIFICATION_QUESTIONS,
  SWITCHER_DISCLAIMER,
  getNextQuestion,
  parseStoredQualificationAnswers,
} from "@/lib/qualification";
import type { QualificationAnswers } from "@/lib/scoring";
import { homeownerApiError, readJsonObject } from "@/lib/http-response";
import {
  attributionFromLocation,
  getOrCreateVisitorId,
  getStoredLeadId,
  getStoredLeadToken,
  storeLeadId,
  storeLeadToken,
  track,
} from "@/lib/visitor";

type Stage = "questions" | "contact" | "scheduler" | "confirmed" | "not-eligible";
type DisqualifyReason = "area" | "pest" | "homeowner" | "other" | null;

interface LeadState {
  id: string | null;
  token: string | null;
  classification: "prospect" | "mql" | "sql";
  inServiceArea: boolean | null;
  eligibleForBooking: boolean;
}

export default function InspectionFunnelPage() {
  // A single-use idempotency key for this page load's very first lead
  // create call — lets the server collapse a duplicate-submit race
  // (double-click, network retry) onto one Lead row. Generated once in
  // memory only, never persisted to localStorage, and irrelevant once
  // `lead.id` is set (every later request has a real leadId to continue
  // with instead). See src/app/api/leads/route.ts's P2002 handling and
  // the Lead.creationNonce schema comment for the full design.
  const [creationNonce] = useState(() => crypto.randomUUID());
  const [answers, setAnswers] = useState<QualificationAnswers>({});
  const [lead, setLead] = useState<LeadState>({
    id: null,
    token: null,
    classification: "prospect",
    inServiceArea: null,
    eligibleForBooking: false,
  });
  const [stage, setStage] = useState<Stage>("questions");
  const [submitting, setSubmitting] = useState(false);
  const [contact, setContact] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [consent, setConsent] = useState({
    sms: false,
    email: false,
    smsMarketing: false,
    emailMarketing: false,
  });
  const [slots, setSlots] = useState<{ start: string; end: string }[]>([]);
  const [companyTimeZone, setCompanyTimeZone] = useState<string | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [confirmedWhen, setConfirmedWhen] = useState<string | null>(null);
  const [funnelError, setFunnelError] = useState<string | null>(null);
  const [disqualifyReason, setDisqualifyReason] = useState<DisqualifyReason>(null);

  useEffect(() => {
    void track("funnel_started");
  }, []);

  // A page refresh (or accidental back/forward navigation) must not discard
  // in-progress qualification answers or silently start a second Lead row
  // for the same visitor. src/lib/visitor.ts already persists leadId/
  // leadToken to localStorage on every successful response; this restores
  // component state from them on mount via a no-op resume call (empty
  // `answers`, which validateQualificationSubmission already treats as
  // "no new answers" and returns the prior answers unchanged). If the
  // stored token is missing, expired (LEAD_TOKEN_TTL_MS), or the lead is
  // gone, the API fails closed (403/404) and this fails silently — the
  // funnel just proceeds as a normal first-time visit rather than showing
  // a confusing technical error for something invisible to the homeowner.
  useEffect(() => {
    const storedLeadId = getStoredLeadId();
    const storedLeadToken = getStoredLeadToken();
    if (!storedLeadId || !storedLeadToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visitorId: getOrCreateVisitorId(),
            leadId: storedLeadId,
            leadToken: storedLeadToken,
            answers: {},
          }),
        });
        if (cancelled) return;
        const data = await readJsonObject(res);
        if (!res.ok || !data) return;
        const returnedLead = data.lead;
        if (
          !returnedLead ||
          typeof returnedLead !== "object" ||
          !("id" in returnedLead) ||
          typeof returnedLead.id !== "string"
        ) {
          return;
        }
        const leadToken = typeof data.leadToken === "string" ? data.leadToken : storedLeadToken;
        const returnedClassification = "classification" in returnedLead ? returnedLead.classification : "prospect";
        const classification =
          returnedClassification === "mql" || returnedClassification === "sql" ? returnedClassification : "prospect";
        setLead({
          id: returnedLead.id,
          token: leadToken,
          classification,
          inServiceArea: data.inServiceArea as boolean | null,
          eligibleForBooking: data.eligibleForBooking === true,
        });
        storeLeadId(returnedLead.id);
        storeLeadToken(leadToken);

        const restoredAnswers = parseStoredQualificationAnswers(
          "qualificationAnswers" in returnedLead && typeof returnedLead.qualificationAnswers === "string"
            ? returnedLead.qualificationAnswers
            : null,
        );
        if (Object.keys(restoredAnswers).length > 0) {
          setAnswers(restoredAnswers);
        }

        const restoredEmail = "email" in returnedLead && typeof returnedLead.email === "string" ? returnedLead.email : "";
        const restoredPhone = "phone" in returnedLead && typeof returnedLead.phone === "string" ? returnedLead.phone : "";
        if (restoredEmail || restoredPhone) {
          setContact({
            firstName: "firstName" in returnedLead && typeof returnedLead.firstName === "string" ? returnedLead.firstName : "",
            lastName: "lastName" in returnedLead && typeof returnedLead.lastName === "string" ? returnedLead.lastName : "",
            email: restoredEmail,
            phone: restoredPhone,
          });
        }

        if (data.qualificationComplete) {
          setStage("contact");
        }
      } catch {
        // Fail silently — see comment above.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const question = useMemo(() => getNextQuestion(answers), [answers]);

  async function saveAnswers(next: QualificationAnswers, justAnsweredQuestionId?: string) {
    setFunnelError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitorId: getOrCreateVisitorId(),
          leadId: lead.id,
          leadToken: lead.token,
          creationNonce,
          answers: next,
          attribution: attributionFromLocation(),
        }),
      });
      const data = await readJsonObject(res);
      if (!res.ok || !data) {
        setFunnelError(homeownerApiError(res, data));
        return;
      }
      const returnedLead = data.lead;
      if (returnedLead && typeof returnedLead === "object" && "id" in returnedLead && typeof returnedLead.id === "string") {
        const leadToken = typeof data.leadToken === "string" ? data.leadToken : null;
        const returnedClassification = "classification" in returnedLead
          ? returnedLead.classification
          : "prospect";
        const classification = returnedClassification === "mql" || returnedClassification === "sql"
          ? returnedClassification
          : "prospect";
        setLead({
          id: returnedLead.id,
          token: leadToken,
          classification,
          inServiceArea: data.inServiceArea as boolean | null,
          eligibleForBooking: data.eligibleForBooking === true,
        });
        storeLeadId(returnedLead.id);
        if (leadToken) storeLeadToken(leadToken);
      }
      setAnswers(next);

      // Stop as soon as a hard disqualifier is known, rather than only
      // after the homeowner has answered every remaining question and
      // typed in their contact info. The server already derives these
      // facts (from the answer just submitted, plus current company
      // configuration) on every response — this reuses that, no new
      // endpoint or validation path needed. Each check only fires right
      // after the question that determines it, since inServiceArea/
      // supportedPest are computed as `false` before their question is
      // even reached.
      if (justAnsweredQuestionId === "zipCode" && data.inServiceArea === false) {
        setDisqualifyReason("area");
        setStage("not-eligible");
        return;
      }
      if (justAnsweredQuestionId === "pestType" && data.supportedPest === false) {
        setDisqualifyReason("pest");
        setStage("not-eligible");
        return;
      }
      if (justAnsweredQuestionId === "isHomeowner" && next.isHomeowner === false) {
        setDisqualifyReason("homeowner");
        setStage("not-eligible");
        return;
      }

      if (data.qualificationComplete) {
        setStage("contact");
      }
    } catch {
      setFunnelError("We couldn't connect right now. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function answer(id: string, value: string | boolean) {
    const next = { ...answers, [id]: value };
    void saveAnswers(next, id);
  }

  async function submitContact(e: React.FormEvent) {
    e.preventDefault();
    setFunnelError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitorId: getOrCreateVisitorId(),
          leadId: lead.id,
          leadToken: lead.token,
          contact,
          smsConsent: consent.sms,
          emailConsent: consent.email,
          smsMarketingConsent: consent.smsMarketing,
          emailMarketingConsent: consent.emailMarketing,
          attribution: attributionFromLocation(),
        }),
      });
      const data = await readJsonObject(res);
      if (!res.ok || !data || !data.lead || typeof data.lead !== "object") {
        setFunnelError(homeownerApiError(res, data));
        return;
      }
      const returnedLead = data.lead as Record<string, unknown>;
      if (typeof returnedLead.id !== "string") {
        setFunnelError("We received an unexpected response. Please try again.");
        return;
      }
      const classification = returnedLead.classification as LeadState["classification"];
      const inServiceArea = data.inServiceArea as boolean | null;
      const eligibleForBooking = data.eligibleForBooking === true;
      setLead({
        id: returnedLead.id,
        token: typeof data.leadToken === "string" ? data.leadToken : null,
        classification,
        inServiceArea,
        eligibleForBooking,
      });
      storeLeadId(returnedLead.id);
      if (typeof data.leadToken === "string") storeLeadToken(data.leadToken);

      if (eligibleForBooking) {
        setStage("scheduler");
        await loadSlots(returnedLead.id, typeof data.leadToken === "string" ? data.leadToken : null);
      } else {
        // The hard gates (area/pest/homeowner) are already caught earlier
        // in the funnel — reaching here not-eligible means qualification
        // completed but scoring didn't reach SQL (e.g. low urgency/severity).
        setDisqualifyReason(inServiceArea === false ? "area" : "other");
        setStage("not-eligible");
      }
    } catch {
      setFunnelError("We couldn't connect right now. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function loadSlots(leadId: string, leadToken: string | null) {
    setSlotsError(null);
    const res = await fetch(`/api/availability?leadId=${leadId}`, {
      headers: leadToken ? { "X-Funnel-Token": leadToken } : {},
    });
    const data = await readJsonObject(res);
    if (!res.ok || !data) {
      setSlotsError(homeownerApiError(res, data));
      return;
    }
    setSlots(Array.isArray(data.slots) ? data.slots as { start: string; end: string }[] : []);
    setCompanyTimeZone(typeof data.timeZone === "string" ? data.timeZone : null);
  }

  async function bookSlot() {
    if (!selectedSlot || !lead.id || !lead.token) return;
    setBookingError(null);
    setSubmitting(true);
    try {
      const slot = slots.find((s) => s.start === selectedSlot);
      if (!slot) return;
      void track("appointment_selected", {
        leadId: lead.id,
        funnelStep: "scheduling",
        eventKey: `appointment-selected:${lead.id}:${slot.start}`,
        metadata: { slotStart: slot.start },
      });
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, leadToken: lead.token, start: slot.start, end: slot.end }),
      });
      const data = await readJsonObject(res);
      if (!res.ok || !data) {
        setBookingError(homeownerApiError(res, data));
        await loadSlots(lead.id, lead.token);
        return;
      }
      if (!data.appointment || typeof data.appointment !== "object" || !("scheduledStart" in data.appointment)) {
        setBookingError("We received an unexpected response. Please try another time.");
        return;
      }
      setConfirmedWhen(
        new Date(String(data.appointment.scheduledStart)).toLocaleString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          ...(companyTimeZone ? { timeZone: companyTimeZone, timeZoneName: "short" } : {}),
        }),
      );
      setStage("confirmed");
    } catch {
      setBookingError("We couldn't connect right now. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const progress = Math.min(
    100,
    Math.round(
      (Object.keys(answers).length / QUALIFICATION_QUESTIONS.length) * 100,
    ),
  );

  return (
    <main className="flex-1 flex flex-col bg-white text-zinc-900">
      <div className="h-1.5 bg-zinc-100">
        <div
          className="h-full bg-emerald-700 transition-all"
          style={{ width: stage === "questions" ? `${progress}%` : "100%" }}
        />
      </div>

      <div className="flex-1 flex flex-col justify-center px-6 py-12 max-w-xl mx-auto w-full gap-6">
        {funnelError && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-700">
            {funnelError}
          </p>
        )}
        {stage === "questions" && question && (
          <QuestionCard
            key={question.id}
            question={question}
            onAnswer={answer}
            disabled={submitting}
          />
        )}

        {stage === "contact" && (
          <form onSubmit={submitContact} className="flex flex-col gap-4">
            <h2 className="text-2xl font-bold">Almost done — where should we send your inspection details?</h2>
            <div className="grid grid-cols-2 gap-3">
              <input
                required
                placeholder="First name"
                className="border border-zinc-300 rounded-md px-4 py-3"
                value={contact.firstName}
                onChange={(e) => setContact({ ...contact, firstName: e.target.value })}
              />
              <input
                placeholder="Last name"
                className="border border-zinc-300 rounded-md px-4 py-3"
                value={contact.lastName}
                onChange={(e) => setContact({ ...contact, lastName: e.target.value })}
              />
            </div>
            <input
              required
              type="email"
              placeholder="Email"
              className="border border-zinc-300 rounded-md px-4 py-3"
              value={contact.email}
              onChange={(e) => setContact({ ...contact, email: e.target.value })}
            />
            <input
              required
              type="tel"
              placeholder="Phone"
              className="border border-zinc-300 rounded-md px-4 py-3"
              value={contact.phone}
              onChange={(e) => setContact({ ...contact, phone: e.target.value })}
            />
            <label className="flex items-start gap-2 text-sm text-zinc-600">
              <input
                type="checkbox"
                checked={consent.email}
                onChange={(e) => setConsent({ ...consent, email: e.target.checked })}
                className="mt-1"
              />
              Email me appointment confirmations and reminders.
            </label>
            <label className="flex items-start gap-2 text-sm text-zinc-600">
              <input
                type="checkbox"
                checked={consent.sms}
                onChange={(e) => setConsent({ ...consent, sms: e.target.checked })}
                className="mt-1"
              />
              Text me appointment confirmations and reminders. Msg &amp; data rates may
              apply. Reply STOP to opt out.
            </label>
            <label className="flex items-start gap-2 text-sm text-zinc-600">
              <input
                type="checkbox"
                checked={consent.emailMarketing}
                onChange={(e) => setConsent({ ...consent, emailMarketing: e.target.checked })}
                className="mt-1"
              />
              Email me helpful pest-control follow-up and offers. Unsubscribe anytime.
            </label>
            <label className="flex items-start gap-2 text-sm text-zinc-600">
              <input
                type="checkbox"
                checked={consent.smsMarketing}
                onChange={(e) => setConsent({ ...consent, smsMarketing: e.target.checked })}
                className="mt-1"
              />
              Text me pest-control follow-up and offers. Msg &amp; data rates may apply.
              Reply STOP to opt out.
            </label>
            <button
              disabled={submitting}
              className="rounded-md bg-emerald-700 px-6 py-4 text-lg font-semibold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "See Available Times"}
            </button>
          </form>
        )}

        {stage === "scheduler" && (
          <div className="flex flex-col gap-4">
            <h2 className="text-2xl font-bold">Pick a time for your free inspection</h2>
            {slotsError && (
              <p role="alert" className="text-red-600">
                {slotsError}
              </p>
            )}
            {bookingError && (
              <p role="alert" className="text-red-600">
                {bookingError}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto">
              {slots.map((slot) => (
                <button
                  key={slot.start}
                  onClick={() => setSelectedSlot(slot.start)}
                  className={`rounded-md border px-3 py-3 text-sm ${
                    selectedSlot === slot.start
                      ? "border-emerald-700 bg-emerald-50 font-semibold"
                      : "border-zinc-300"
                  }`}
                >
                  {new Date(slot.start).toLocaleString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    ...(companyTimeZone ? { timeZone: companyTimeZone, timeZoneName: "short" } : {}),
                  })}
                </button>
              ))}
            </div>
            <button
              disabled={!selectedSlot || submitting}
              onClick={bookSlot}
              className="rounded-md bg-emerald-700 px-6 py-4 text-lg font-semibold text-white disabled:opacity-50"
            >
              {submitting ? "Booking…" : "Book Free Inspection"}
            </button>
          </div>
        )}

        {stage === "confirmed" && (
          <div className="flex flex-col gap-3 text-center">
            <h2 className="text-2xl font-bold">You&apos;re booked! 🎉</h2>
            <p className="text-zinc-600">
              Your free home inspection is confirmed for {confirmedWhen}. We&apos;ll send you a
              confirmation and reminders.
            </p>
          </div>
        )}

        {stage === "not-eligible" && (
          <div className="flex flex-col gap-3 text-center">
            <h2 className="text-2xl font-bold">Thanks for reaching out</h2>
            <p className="text-zinc-600">
              {disqualifyReason === "area"
                ? "It looks like your address is outside our current service area, so we can't book an inspection online right now."
                : disqualifyReason === "pest"
                  ? "We don't currently handle this online, but reach out directly and a team member can point you in the right direction."
                  : disqualifyReason === "homeowner"
                    ? "Right now we're set up to book inspections for homeowners. If that changes, reach out and we're happy to help."
                    : "Thanks for the info — a team member will follow up shortly to see if we're a good fit."}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function QuestionCard({
  question,
  onAnswer,
  disabled,
}: {
  question: (typeof QUALIFICATION_QUESTIONS)[number];
  onAnswer: (id: string, value: string | boolean) => void;
  disabled: boolean;
}) {
  const [zip, setZip] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-balance">{question.prompt}</h2>
      {question.id === "switchReason" && (
        <p className="text-sm text-zinc-500">{SWITCHER_DISCLAIMER}</p>
      )}

      {question.type === "zip" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (zip.trim()) onAnswer(question.id, zip.trim());
          }}
          className="flex gap-2"
        >
          <input
            inputMode="numeric"
            pattern="[0-9]{5}"
            maxLength={5}
            required
            placeholder="ZIP code"
            className="min-w-0 flex-1 border border-zinc-300 rounded-md px-4 py-3 text-lg"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            autoFocus
          />
          <button
            disabled={disabled}
            className="rounded-md bg-emerald-700 px-6 py-3 font-semibold text-white disabled:opacity-50"
          >
            Next
          </button>
        </form>
      )}

      {question.type === "boolean" && (
        <div className="flex gap-3">
          <button
            disabled={disabled}
            onClick={() => onAnswer(question.id, true)}
            className="flex-1 rounded-md border border-zinc-300 px-6 py-4 text-lg font-medium hover:border-emerald-700 disabled:opacity-50"
          >
            Yes
          </button>
          <button
            disabled={disabled}
            onClick={() => onAnswer(question.id, false)}
            className="flex-1 rounded-md border border-zinc-300 px-6 py-4 text-lg font-medium hover:border-emerald-700 disabled:opacity-50"
          >
            No
          </button>
        </div>
      )}

      {question.type === "single_select" && (
        <div className="flex flex-col gap-2">
          {question.options?.map((opt) => (
            <button
              key={opt.value}
              disabled={disabled}
              onClick={() => onAnswer(question.id, opt.value)}
              className="rounded-md border border-zinc-300 px-4 py-3 text-left hover:border-emerald-700 disabled:opacity-50"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
