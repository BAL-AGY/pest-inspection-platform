import { PrismaClient } from "@prisma/client";
import { assertStagingDemoCommand } from "../src/lib/seed-config";

const prisma = new PrismaClient();
const DEMO_SLUG = "demo-pest-control";

async function demoCompany() {
  const company = await prisma.company.findUnique({ where: { slug: DEMO_SLUG } });
  if (!company?.isDemo) {
    throw new Error("The staging demo tenant is missing or is not marked as demo. Run npm run db:seed first.");
  }
  return company;
}

async function resetDemoData(companyId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.communicationWebhookEvent.deleteMany({ where: { companyId } });
    await tx.communication.deleteMany({ where: { companyId } });
    await tx.communicationProviderAccount.deleteMany({ where: { companyId } });
    await tx.suppressionEntry.deleteMany({ where: { companyId } });
    await tx.funnelEvent.deleteMany({ where: { companyId } });
    await tx.visitorAttribution.deleteMany({ where: { companyId } });
    await tx.leadNote.deleteMany({ where: { lead: { companyId } } });
    await tx.appointment.deleteMany({ where: { companyId } });
    await tx.marketingSpend.deleteMany({ where: { companyId } });
    await tx.auditLog.deleteMany({ where: { companyId } });
    await tx.lead.deleteMany({ where: { companyId } });
  });
}

const qualificationAnswers = JSON.stringify({
  zipCode: "78701",
  isHomeowner: true,
  pestType: "termites",
  pestSeverity: "severe",
  hasExistingProvider: true,
  switchReason: "pest_returned_after_treatment",
  timeline: "asap",
});

function atDaysFromNow(days: number, hourUtc = 16) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  value.setUTCHours(hourUtc, 0, 0, 0);
  return value;
}

async function seedDemoData(companyId: string) {
  const createdAt = atDaysFromNow(-3);
  const fixtures = [
    { id: "staging-demo-lead-won", visitorId: "staging-demo-visitor-won", firstName: "Jordan", lastName: "Demo", email: "jordan.demo@example.invalid", phone: "5125550101", source: "google", medium: "cpc", campaign: "termite-inspection", content: "search-ad-a", status: "customer_won", outcome: "won", contractValueCents: 120000, appointmentStatus: "completed", appointmentStart: atDaysFromNow(-1), score: 100 },
    { id: "staging-demo-lead-booked", visitorId: "staging-demo-visitor-booked", firstName: "Taylor", lastName: "Sample", email: "taylor.sample@example.invalid", phone: "5125550102", source: "facebook", medium: "paid_social", campaign: "summer-pest-relief", content: "homeowner-video", status: "inspection_booked", outcome: null, contractValueCents: null, appointmentStatus: "booked", appointmentStart: atDaysFromNow(2), score: 100 },
    { id: "staging-demo-lead-qualified", visitorId: "staging-demo-visitor-qualified", firstName: "Morgan", lastName: "Example", email: "morgan.example@example.invalid", phone: "5125550103", source: "google", medium: "cpc", campaign: "termite-inspection", content: "search-ad-b", status: "sql", outcome: null, contractValueCents: null, appointmentStatus: null, appointmentStart: null, score: 100 },
    { id: "staging-demo-lead-lost", visitorId: "staging-demo-visitor-lost", firstName: "Casey", lastName: "Test", email: "casey.test@example.invalid", phone: "5125550104", source: "direct", medium: "none", campaign: null, content: null, status: "customer_lost", outcome: "lost", contractValueCents: null, appointmentStatus: "completed", appointmentStart: atDaysFromNow(-2, 18), score: 85 },
  ] as const;

  for (const fixture of fixtures) {
    await prisma.lead.upsert({
      where: { id: fixture.id },
      update: {},
      create: {
        id: fixture.id,
        companyId,
        isDemo: true,
        visitorId: fixture.visitorId,
        firstName: fixture.firstName,
        lastName: fixture.lastName,
        email: fixture.email,
        normalizedEmail: fixture.email,
        phone: fixture.phone,
        normalizedPhone: fixture.phone,
        addressLine1: "100 Demo Way",
        city: "Austin",
        state: "TX",
        zipCode: "78701",
        isHomeowner: true,
        qualificationAnswers,
        pestConcern: "termites",
        hasExistingProvider: true,
        switchReason: "pest_returned_after_treatment",
        score: fixture.score,
        classification: "sql",
        status: fixture.status,
        outcome: fixture.outcome,
        contractValueCents: fixture.contractValueCents,
        source: fixture.source,
        medium: fixture.medium,
        campaign: fixture.campaign,
        content: fixture.content,
        landingPage: "/?utm_source=demo",
        lastSource: fixture.source,
        lastMedium: fixture.medium,
        lastCampaign: fixture.campaign,
        lastContent: fixture.content,
        lastLandingPage: "/?utm_source=demo",
        firstTouchAt: createdAt,
        lastTouchAt: createdAt,
        emailConsent: true,
        emailConsentAt: createdAt,
        emailConsentSource: "staging_fixture",
        smsConsent: true,
        smsConsentAt: createdAt,
        smsConsentSource: "staging_fixture",
        createdAt,
      },
    });

    const appointmentId = fixture.appointmentStatus ? `${fixture.id}-appointment` : null;
    if (fixture.appointmentStatus && fixture.appointmentStart && appointmentId) {
      await prisma.appointment.upsert({
        where: { id: appointmentId },
        update: {},
        create: {
          id: appointmentId,
          companyId,
          leadId: fixture.id,
          isDemo: true,
          scheduledStart: fixture.appointmentStart,
          scheduledEnd: new Date(fixture.appointmentStart.getTime() + 60 * 60_000),
          status: fixture.appointmentStatus,
          completedAt: fixture.appointmentStatus === "completed" ? fixture.appointmentStart : null,
          createdAt,
        },
      });
    }

    const attribution = {
      source: fixture.source,
      medium: fixture.medium,
      campaign: fixture.campaign,
      content: fixture.content,
      landingPage: "/?utm_source=demo",
    };
    const eventTypes = [
      "landing_page_view",
      "inspection_cta_clicked",
      "funnel_started",
      "lead_created",
      "lead_qualified",
      ...(fixture.appointmentStatus ? ["scheduling_viewed", "inspection_booked"] : []),
      ...(fixture.appointmentStatus === "completed" ? ["inspection_completed"] : []),
      ...(fixture.outcome === "won" ? ["customer_won", "revenue_recorded"] : []),
      ...(fixture.outcome === "lost" ? ["customer_lost"] : []),
    ];
    for (const [index, eventType] of eventTypes.entries()) {
      await prisma.funnelEvent.createMany({
        data: [{
          companyId,
          leadId: ["landing_page_view", "inspection_cta_clicked", "funnel_started"].includes(eventType) ? null : fixture.id,
          visitorId: fixture.visitorId,
          appointmentId: eventType.includes("inspection") && appointmentId ? appointmentId : null,
          eventKey: `staging-demo:${fixture.id}:${eventType}`,
          eventType,
          funnelStep: eventType,
          isDemo: true,
          ...attribution,
          metadata: eventType === "revenue_recorded" ? JSON.stringify({ amountCents: fixture.contractValueCents }) : null,
          createdAt: new Date(createdAt.getTime() + index * 60_000),
        }],
        skipDuplicates: true,
      });
    }
    for (const [index, questionId] of [
      "zipCode",
      "isHomeowner",
      "pestType",
      "pestSeverity",
      "hasExistingProvider",
      "switchReason",
      "timeline",
    ].entries()) {
      await prisma.funnelEvent.createMany({
        data: [{
          companyId,
          leadId: fixture.id,
          visitorId: fixture.visitorId,
          eventKey: `staging-demo:${fixture.id}:question:${questionId}`,
          eventType: "qualification_question_answered",
          funnelStep: questionId,
          isDemo: true,
          ...attribution,
          createdAt: new Date(createdAt.getTime() + (index + 3) * 60_000),
        }],
        skipDuplicates: true,
      });
    }
    await prisma.funnelEvent.createMany({
      data: [{
        companyId,
        leadId: fixture.id,
        visitorId: fixture.visitorId,
        eventKey: `staging-demo:${fixture.id}:contact`,
        eventType: "contact_information_submitted",
        funnelStep: "contact",
        isDemo: true,
        ...attribution,
        createdAt: new Date(createdAt.getTime() + 10 * 60_000),
      }],
      skipDuplicates: true,
    });
  }

  await prisma.marketingSpend.createMany({
    data: [
      { id: "staging-demo-spend-google", companyId, source: "google", medium: "cpc", campaign: "termite-inspection", amountCents: 45000, periodStart: atDaysFromNow(-7, 0), periodEnd: atDaysFromNow(0, 23), isDemo: true },
      { id: "staging-demo-spend-facebook", companyId, source: "facebook", medium: "paid_social", campaign: "summer-pest-relief", amountCents: 25000, periodStart: atDaysFromNow(-7, 0), periodEnd: atDaysFromNow(0, 23), isDemo: true },
    ],
    skipDuplicates: true,
  });
}

async function main() {
  assertStagingDemoCommand();
  const company = await demoCompany();
  const command = process.argv[2] ?? "seed";
  if (command === "reset") await resetDemoData(company.id);
  else if (command !== "seed") throw new Error("Expected staging demo command: seed or reset.");
  await seedDemoData(company.id);
  console.log(`${command === "reset" ? "Reset and reseeded" : "Seeded"} synthetic staging demo data for ${company.slug}.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Staging demo command failed.");
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
