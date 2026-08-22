import { expect, test, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

interface LeadSession {
  visitorId: string;
  leadId: string | null;
  leadToken: string | null;
}

async function submit(
  request: APIRequestContext,
  session: LeadSession,
  data: Record<string, unknown>,
) {
  const response = await request.post("/api/leads", {
    data: {
      visitorId: session.visitorId,
      leadId: session.leadId,
      leadToken: session.leadToken,
      ...data,
    },
  });
  const body = await response.json();
  if (response.ok()) {
    session.leadId = body.lead.id;
    session.leadToken = body.leadToken;
  }
  return { response, body };
}

function newSession(label: string): LeadSession {
  return {
    visitorId: `qualification-${label}-${Date.now()}-${Math.random()}`,
    leadId: null,
    leadToken: null,
  };
}

async function completeFunnel(
  request: APIRequestContext,
  session: LeadSession,
  options: { zipCode?: string; pestType?: string; provider?: boolean; lowIntent?: boolean } = {},
) {
  const answers: Record<string, unknown>[] = [
    { zipCode: options.zipCode ?? "73301" },
    { isHomeowner: !options.lowIntent },
    { pestType: options.pestType ?? (options.lowIntent ? "spiders" : "termites") },
    { pestSeverity: options.lowIntent ? "just_noticed" : "severe" },
    { hasExistingProvider: options.provider ?? false },
  ];
  if (options.provider) answers.push({ switchReason: "poor_service" });
  answers.push({ timeline: options.lowIntent ? "just_researching" : "asap" });

  let latest: Awaited<ReturnType<typeof submit>> | null = null;
  for (const answer of answers) {
    latest = await submit(request, session, { answers: answer });
    expect(latest.response.status()).toBe(200);
  }
  return latest!;
}

test.describe("server-authoritative qualification", () => {
  test("rejects unknown keys, invalid values, wrong types, and fake classifications", async ({ request }) => {
    for (const [label, data, expectedCode] of [
      ["unknown", { answers: { arbitraryHotLeadFlag: true } }, "unknown_question"],
      ["option", { answers: { zipCode: "73301", pestType: "scorpions" } }, "invalid_answer_value"],
      ["type", { answers: { zipCode: 73301 } }, "invalid_answer_type"],
    ] as const) {
      const session = newSession(label);
      const { response, body } = await submit(request, session, data);
      expect(response.status()).toBe(400);
      expect(body).toMatchObject({ error: "invalid_qualification", code: expectedCode });
      expect(session.leadId).toBeNull();
    }

    const invalidOption = newSession("invalid-option");
    await submit(request, invalidOption, { answers: { zipCode: "73301" } });
    await submit(request, invalidOption, { answers: { isHomeowner: true } });
    const invalid = await submit(request, invalidOption, { answers: { pestType: "scorpions" } });
    expect(invalid.response.status()).toBe(400);
    expect(invalid.body).toMatchObject({ error: "invalid_qualification", code: "invalid_answer_value" });

    for (const field of ["score", "classification", "status"] as const) {
      const session = newSession(`fake-${field}`);
      const { response } = await submit(request, session, {
        answers: { zipCode: "73301" },
        [field]: field === "score" ? 999 : "sql",
      });
      expect(response.status()).toBe(400);
    }
  });

  test("enforces required order and the conditional switcher branch", async ({ request }) => {
    const shortcut = newSession("shortcut");
    const skipped = await submit(request, shortcut, { answers: { pestSeverity: "severe" } });
    expect(skipped.response.status()).toBe(400);
    expect(skipped.body.code).toBe("invalid_progression");

    const single = await submit(request, shortcut, { answers: { zipCode: "73301" } });
    expect(single.response.status()).toBe(200);
    expect(single.body.lead.classification).toBe("prospect");
    expect(single.body.qualificationComplete).toBe(false);
    expect(single.body.eligibleForBooking).toBe(false);

    const provider = newSession("provider");
    for (const answer of [
      { zipCode: "73301" },
      { isHomeowner: true },
      { pestType: "termites" },
      { pestSeverity: "severe" },
      { hasExistingProvider: true },
    ]) {
      expect((await submit(request, provider, { answers: answer })).response.status()).toBe(200);
    }
    const skipConditional = await submit(request, provider, { answers: { timeline: "asap" } });
    expect(skipConditional.response.status()).toBe(400);
    expect(skipConditional.body.code).toBe("invalid_progression");
    const badSwitchReason = await submit(request, provider, {
      answers: { switchReason: "break_my_contract" },
    });
    expect(badSwitchReason.response.status()).toBe(400);
    expect(badSwitchReason.body.code).toBe("invalid_answer_value");
    expect(
      (await submit(request, provider, { answers: { switchReason: "poor_service" } })).response.status(),
    ).toBe(200);

    const noProvider = newSession("no-provider");
    for (const answer of [
      { zipCode: "73301" },
      { isHomeowner: true },
      { pestType: "ants" },
      { pestSeverity: "ongoing" },
      { hasExistingProvider: false },
    ]) {
      await submit(request, noProvider, { answers: answer });
    }
    const inapplicable = await submit(request, noProvider, { answers: { switchReason: "poor_service" } });
    expect(inapplicable.response.status()).toBe(400);
    expect(inapplicable.body.code).toBe("answer_not_applicable");
    expect((await submit(request, noProvider, { answers: { timeline: "asap" } })).response.status()).toBe(200);
  });

  test("derives company service eligibility and keeps legitimate outcomes correct", async ({ request }) => {
    const qualified = newSession("qualified");
    await completeFunnel(request, qualified);
    const qualifiedResult = await submit(request, qualified, {
      contact: {
        firstName: "Qualified",
        lastName: "Homeowner",
        email: `${qualified.visitorId}@example.com`,
        phone: "+15125550171",
      },
    });
    expect(qualifiedResult.body).toMatchObject({
      qualificationComplete: true,
      inServiceArea: true,
      supportedPest: true,
      eligibleForBooking: true,
      lead: { classification: "sql" },
    });

    const lowIntent = newSession("low-intent");
    await completeFunnel(request, lowIntent, { lowIntent: true });
    const lowResult = await submit(request, lowIntent, {
      contact: {
        firstName: "Researching",
        email: `${lowIntent.visitorId}@example.com`,
        phone: "+15125550172",
      },
    });
    expect(lowResult.body.lead.classification).toBe("prospect");
    expect(lowResult.body.eligibleForBooking).toBe(false);

    const company = await prisma.company.findFirstOrThrow({ where: { slug: "demo-pest-control" } });
    const originalSupportedPests = company.supportedPests;
    let unsupportedResult: Awaited<ReturnType<typeof submit>> | null = null;
    try {
      const configured = (JSON.parse(originalSupportedPests) as string[]).filter((pest) => pest !== "other");
      await prisma.company.update({ where: { id: company.id }, data: { supportedPests: JSON.stringify(configured) } });
      const unsupported = newSession("unsupported");
      await completeFunnel(request, unsupported, { pestType: "other" });
      unsupportedResult = await submit(request, unsupported, {
        contact: {
          firstName: "Unsupported",
          email: `${unsupported.visitorId}@example.com`,
          phone: "+15125550173",
        },
      });
      expect(unsupportedResult.body.supportedPest).toBe(false);
      expect(unsupportedResult.body.eligibleForBooking).toBe(false);
      const availability = await request.get(`/api/availability?leadId=${unsupportedResult.body.lead.id}`, {
        headers: { "X-Funnel-Token": unsupportedResult.body.leadToken },
      });
      expect(availability.status()).toBe(403);
    } finally {
      await prisma.company.update({ where: { id: company.id }, data: { supportedPests: originalSupportedPests } });
    }

    const outOfArea = newSession("out-of-area");
    await completeFunnel(request, outOfArea, { zipCode: "90210" });
    const outResult = await submit(request, outOfArea, {
      contact: {
        firstName: "Out",
        lastName: "OfArea",
        email: `${outOfArea.visitorId}@example.com`,
        phone: "+15125550174",
      },
    });
    expect(outResult.body.inServiceArea).toBe(false);
    expect(outResult.body.eligibleForBooking).toBe(false);

    const availability = await request.get(`/api/availability?leadId=${outResult.body.lead.id}`, {
      headers: { "X-Funnel-Token": outResult.body.leadToken },
    });
    expect(availability.status()).toBe(403);
  });

  test("booking gate re-derives complete qualification instead of trusting SQL classification", async ({ request }) => {
    const session = newSession("booking-gate");
    const created = await submit(request, session, { answers: { zipCode: "73301" } });
    expect(created.response.status()).toBe(200);

    await prisma.lead.update({
      where: { id: session.leadId! },
      data: { score: 999, classification: "sql", status: "sql" },
    });

    const availability = await request.get(`/api/availability?leadId=${session.leadId}`, {
      headers: { "X-Funnel-Token": session.leadToken! },
    });
    expect(availability.status()).toBe(403);
    expect(await availability.json()).toMatchObject({ error: "not_eligible" });

    const booking = await request.post("/api/appointments", {
      data: {
        leadId: session.leadId,
        leadToken: session.leadToken,
        start: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
      },
    });
    expect(booking.status()).toBe(403);
    expect(await prisma.appointment.count({ where: { leadId: session.leadId! } })).toBe(0);

    // This test deliberately tampers the row directly via Prisma to a
    // maximal score/SQL classification it never legitimately earned (the
    // whole point is proving the API doesn't trust it). Left uncleaned,
    // that fake score: 999 row permanently outranks every real lead in
    // the owner dashboard's "needs your attention" worklist
    // (src/lib/dashboard-metrics.ts needsFollowUp, ordered by score desc)
    // on every subsequent test run against this same local dev DB —
    // this is exactly what caused e2e/dashboard-follow-up.spec.ts to
    // start failing after repeated full-suite runs. Delete it now that
    // the assertions above are done with it.
    await prisma.lead.delete({ where: { id: session.leadId! } });
  });
});
