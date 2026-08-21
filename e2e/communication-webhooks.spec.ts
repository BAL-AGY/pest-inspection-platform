import crypto from "crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { sendIfAllowed } from "../src/lib/suppression";
import { setProvider } from "../src/lib/communications";

const prisma = new PrismaClient();
const secret = process.env.COMMUNICATION_TEST_WEBHOOK_SECRET ?? "";
const jobSecret = process.env.COMMUNICATION_JOB_SECRET ?? "";

function signedHeaders(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  return {
    "content-type": "application/json",
    "x-communication-timestamp": String(timestamp),
    "x-communication-signature": crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"),
  };
}

async function postWebhook(request: APIRequestContext, event: Record<string, unknown>) {
  const body = JSON.stringify(event);
  return request.post("/api/webhooks/communications/deterministic", {
    data: body,
    headers: signedHeaders(body),
  });
}

test.beforeAll(() => {
  if (!secret) throw new Error("COMMUNICATION_TEST_WEBHOOK_SECRET is required for webhook E2E tests");
  if (!jobSecret) throw new Error("COMMUNICATION_JOB_SECRET is required for communication job E2E tests");
});

test("internal job authentication and dedupe protect reminders and qualified follow-up", async ({ request }) => {
  const stamp = Date.now();
  const company = await prisma.company.findUniqueOrThrow({ where: { slug: "demo-pest-control" } });
  const reminderLead = await prisma.lead.create({
    data: {
      companyId: company.id,
      visitorId: `reminder-${stamp}`,
      email: `reminder-${stamp}@example.com`,
      normalizedEmail: `reminder-${stamp}@example.com`,
      emailConsent: true,
      emailConsentAt: new Date(),
      emailConsentSource: "public_funnel",
    },
  });
  const appointment = await prisma.appointment.create({
    data: {
      companyId: company.id,
      leadId: reminderLead.id,
      scheduledStart: new Date(Date.now() + 24 * 60 * 60_000),
      scheduledEnd: new Date(Date.now() + 25 * 60 * 60_000),
      status: "booked",
    },
  });
  const followupLead = await prisma.lead.create({
    data: {
      companyId: company.id,
      visitorId: `followup-${stamp}`,
      firstName: "Followup",
      email: `followup-${stamp}@example.com`,
      normalizedEmail: `followup-${stamp}@example.com`,
      classification: "sql",
      status: "sql",
      emailConsent: true,
      emailConsentAt: new Date(Date.now() - 60 * 60_000),
      emailConsentSource: "public_funnel",
      emailMarketingConsent: true,
      emailMarketingConsentAt: new Date(Date.now() - 60 * 60_000),
      emailMarketingConsentSource: "public_funnel",
      updatedAt: new Date(Date.now() - 60 * 60_000),
    },
  });

  expect((await request.post("/api/internal/communications/run")).status()).toBe(401);
  for (let index = 0; index < 2; index += 1) {
    const response = await request.post("/api/internal/communications/run", {
      headers: { authorization: `Bearer ${jobSecret}` },
    });
    expect(response.status()).toBe(200);
  }
  expect(await prisma.communication.count({
    where: { companyId: company.id, dedupeKey: `appointment:${appointment.id}:reminder-24h:email` },
  })).toBe(1);
  expect(await prisma.communication.count({
    where: { companyId: company.id, dedupeKey: `lead:${followupLead.id}:qualified-follow-up:email` },
  })).toBe(1);
});

test.afterEach(() => setProvider(null));
test.afterAll(async () => prisma.$disconnect());

test("authenticated delivery/failure events are tenant-scoped and idempotent", async ({ request }) => {
  const stamp = Date.now();
  const primary = await prisma.company.findUniqueOrThrow({ where: { slug: "demo-pest-control" } });
  const other = await prisma.company.create({
    data: {
      name: `Webhook Other ${stamp}`,
      slug: `webhook-other-${stamp}`,
      timezone: primary.timezone,
      serviceZipCodes: primary.serviceZipCodes,
      supportedPests: primary.supportedPests,
      businessHours: primary.businessHours,
      scoringRules: primary.scoringRules,
    },
  });
  const [accountA, accountB] = await Promise.all([
    prisma.communicationProviderAccount.create({
      data: { companyId: primary.id, provider: "deterministic", externalAccountId: `acct-a-${stamp}`, channel: "email" },
    }),
    prisma.communicationProviderAccount.create({
      data: { companyId: other.id, provider: "deterministic", externalAccountId: `acct-b-${stamp}`, channel: "email" },
    }),
  ]);
  const lead = await prisma.lead.create({
    data: { companyId: primary.id, visitorId: `webhook-${stamp}`, email: `webhook-${stamp}@example.com`, normalizedEmail: `webhook-${stamp}@example.com` },
  });
  const communication = await prisma.communication.create({
    data: {
      companyId: primary.id,
      leadId: lead.id,
      providerAccountId: accountA.id,
      channel: "email",
      type: "appointment_confirmation",
      purpose: "transactional",
      direction: "outbound",
      provider: "deterministic",
      dedupeKey: `delivery-${stamp}`,
      status: "accepted",
      to: lead.email!,
      providerMessageId: `message-${stamp}`,
      acceptedAt: new Date(),
    },
  });

  const forgedBody = JSON.stringify({ id: `forged-${stamp}` });
  const forged = await request.post("/api/webhooks/communications/deterministic", {
    data: forgedBody,
    headers: { "content-type": "application/json", "x-communication-timestamp": "1", "x-communication-signature": "00" },
  });
  expect(forged.status()).toBe(401);

  const wrongCompany = await postWebhook(request, {
    id: `wrong-${stamp}`,
    accountId: accountB.externalAccountId,
    type: "delivered",
    channel: "email",
    occurredAt: new Date().toISOString(),
    messageId: communication.providerMessageId,
  });
  expect(wrongCompany.status()).toBe(200);
  expect((await prisma.communication.findUniqueOrThrow({ where: { id: communication.id } })).status).toBe("accepted");

  const deliveredEvent = {
    id: `delivered-${stamp}`,
    accountId: accountA.externalAccountId,
    type: "delivered",
    channel: "email",
    occurredAt: new Date().toISOString(),
    messageId: communication.providerMessageId,
  };
  expect((await postWebhook(request, deliveredEvent)).status()).toBe(200);
  const duplicate = await postWebhook(request, deliveredEvent);
  expect(duplicate.status()).toBe(200);
  expect(await duplicate.json()).toMatchObject({ duplicate: true });
  const delivered = await prisma.communication.findUniqueOrThrow({ where: { id: communication.id } });
  expect(delivered.status).toBe("delivered");
  expect(delivered.deliveredAt).toBeTruthy();
  expect(await prisma.communicationWebhookEvent.count({
    where: { provider: "deterministic", providerEventId: deliveredEvent.id },
  })).toBe(1);

  const failureCommunication = await prisma.communication.create({
    data: {
      companyId: primary.id,
      leadId: lead.id,
      providerAccountId: accountA.id,
      channel: "email",
      type: "qualified_not_booked_follow_up",
      purpose: "marketing",
      direction: "outbound",
      provider: "deterministic",
      dedupeKey: `failure-${stamp}`,
      status: "accepted",
      to: lead.email!,
      providerMessageId: `failure-message-${stamp}`,
    },
  });
  expect((await postWebhook(request, {
    id: `failed-${stamp}`,
    accountId: accountA.externalAccountId,
    type: "bounced",
    channel: "email",
    occurredAt: new Date().toISOString(),
    messageId: failureCommunication.providerMessageId,
    reason: "mailbox unavailable",
  })).status()).toBe(200);
  expect((await prisma.communication.findUniqueOrThrow({ where: { id: failureCommunication.id } })).status).toBe("bounced");

  const rejected = await prisma.communication.create({
    data: {
      companyId: primary.id,
      leadId: lead.id,
      providerAccountId: accountA.id,
      channel: "email",
      type: "appointment_reminder",
      purpose: "transactional",
      direction: "outbound",
      provider: "deterministic",
      dedupeKey: `rejected-${stamp}`,
      status: "accepted",
      to: lead.email!,
      providerMessageId: `rejected-message-${stamp}`,
    },
  });
  expect((await postWebhook(request, {
    id: `rejected-${stamp}`,
    accountId: accountA.externalAccountId,
    type: "failed",
    channel: "email",
    occurredAt: new Date().toISOString(),
    messageId: rejected.providerMessageId,
    reason: "provider rejected delivery",
  })).status()).toBe(200);
  expect((await prisma.communication.findUniqueOrThrow({ where: { id: rejected.id } })).status).toBe("failed");
});

test("inbound STOP is immediate, repeat-safe, and cannot cross tenants", async ({ request }) => {
  const stamp = Date.now();
  const company = await prisma.company.findUniqueOrThrow({ where: { slug: "demo-pest-control" } });
  const phone = `512${String(stamp).slice(-7)}`;
  const account = await prisma.communicationProviderAccount.create({
    data: { companyId: company.id, provider: "deterministic", externalAccountId: `sms-${stamp}`, channel: "sms", address: "+15125550000" },
  });
  const lead = await prisma.lead.create({
    data: { companyId: company.id, visitorId: `stop-${stamp}`, phone, normalizedPhone: phone, smsConsent: true, smsConsentAt: new Date(), smsConsentSource: "public_funnel" },
  });
  const event = {
    id: `stop-${stamp}`,
    accountId: account.externalAccountId,
    type: "inbound_message",
    channel: "sms",
    occurredAt: new Date().toISOString(),
    from: `+1${phone}`,
    to: account.address,
    body: "  stop  ",
  };
  expect((await postWebhook(request, event)).status()).toBe(200);
  expect((await postWebhook(request, event)).status()).toBe(200);

  const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  expect(updated.smsConsent).toBe(false);
  expect(updated.smsOptedOutAt).toBeTruthy();
  expect(await prisma.suppressionEntry.count({
    where: { companyId: company.id, channel: "sms", identifierValue: phone },
  })).toBe(1);
  expect(await prisma.communication.count({
    where: { companyId: company.id, dedupeKey: `webhook:deterministic:${event.id}` },
  })).toBe(1);
});

test("purpose-aware suppression, duplicate sends, and provider outages persist accurately", async () => {
  const stamp = Date.now();
  const company = await prisma.company.findUniqueOrThrow({ where: { slug: "demo-pest-control" } });
  const email = `purpose-${stamp}@example.com`;
  const lead = await prisma.lead.create({
    data: { companyId: company.id, visitorId: `purpose-${stamp}`, email, normalizedEmail: email, emailConsent: true, emailConsentAt: new Date(), emailConsentSource: "public_funnel" },
  });
  await prisma.suppressionEntry.create({
    data: { companyId: company.id, channel: "email", scope: "marketing", identifierType: "email", identifierValue: email, reason: "unsubscribe", source: "test" },
  });

  let calls = 0;
  setProvider({
    name: "test-provider",
    send: async () => { calls += 1; return { accepted: true, providerMessageId: `accepted-${stamp}` }; },
  });
  const consent = { emailConsent: true, smsConsent: false, optedOutAt: null };
  const marketing = await sendIfAllowed(
    { channel: "email", to: email, body: "marketing" },
    { companyId: company.id, leadId: lead.id, type: "qualified_not_booked_follow_up", purpose: "marketing", dedupeKey: `marketing-${stamp}`, consent },
  );
  expect(marketing.accepted).toBe(false);

  const send = () => sendIfAllowed(
    { channel: "email" as const, to: email, body: "transactional" },
    { companyId: company.id, leadId: lead.id, type: "appointment_confirmation" as const, purpose: "transactional" as const, dedupeKey: `transactional-${stamp}`, consent },
  );
  const concurrent = await Promise.all([send(), send()]);
  expect(calls).toBe(1);
  expect(concurrent.filter((result) => result.duplicate)).toHaveLength(1);

  setProvider({ name: "outage-provider", send: async () => { throw new Error("provider token must not persist"); } });
  const outage = await sendIfAllowed(
    { channel: "email", to: email, body: "transactional" },
    { companyId: company.id, leadId: lead.id, type: "appointment_reminder", purpose: "transactional", dedupeKey: `outage-${stamp}`, consent },
  );
  expect(outage.accepted).toBe(false);
  const failed = await prisma.communication.findUniqueOrThrow({
    where: { companyId_dedupeKey: { companyId: company.id, dedupeKey: `outage-${stamp}` } },
  });
  expect(failed.status).toBe("failed");
  expect(failed.failureReason).toBe("Provider request failed");
});
