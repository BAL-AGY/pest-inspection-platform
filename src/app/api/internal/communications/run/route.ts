import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { runDueCommunicationJobs } from "@/lib/communication-jobs";

function authorized(req: NextRequest): boolean {
  const expected = process.env.COMMUNICATION_JOB_SECRET;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await runDueCommunicationJobs();
  return NextResponse.json({ ok: true, ...result });
}
