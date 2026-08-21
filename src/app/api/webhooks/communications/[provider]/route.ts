import { NextRequest, NextResponse } from "next/server";
import {
  getCommunicationWebhookAdapter,
  processVerifiedCommunicationEvent,
} from "@/lib/communication-webhooks";
import { enforceRateLimit, rateLimitResponse, trustedClientAddress } from "@/lib/rate-limit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const adapter = getCommunicationWebhookAdapter(provider);
  if (!adapter) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const rawBody = await req.text();
  const event = adapter.verify({ rawBody, headers: req.headers });
  if (!event) {
    return NextResponse.json({ error: "invalid_webhook" }, { status: 401 });
  }

  const limit = await enforceRateLimit({
    policy: "communicationWebhook",
    companyScope: `${provider}:${event.accountId}`,
    identifiers: [
      { kind: "session", value: event.accountId },
      { kind: "network", value: trustedClientAddress(req) },
    ],
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  const result = await processVerifiedCommunicationEvent(provider, event, rawBody);
  return NextResponse.json({ received: true, duplicate: result.duplicate });
}
