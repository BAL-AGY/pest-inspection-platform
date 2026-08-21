import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActiveCompany } = vi.hoisted(() => ({ getActiveCompany: vi.fn() }));

vi.mock("@/lib/company", () => ({
  getActiveCompany,
  parseScoringRules: vi.fn(),
  parseServiceZipCodes: vi.fn(),
  parseSupportedPests: vi.fn(),
}));
vi.mock("@/lib/require-session", () => ({ requireSession: vi.fn() }));

import { POST } from "./route";

describe("POST /api/leads response contract", () => {
  beforeEach(() => {
    getActiveCompany.mockReset();
  });

  it("returns sanitized JSON when an unexpected dependency failure occurs", async () => {
    getActiveCompany.mockRejectedValue(new Error("postgresql://user:password@internal/database"));
    const request = new NextRequest("http://localhost/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visitorId: `route-contract-${Date.now()}`, answers: { zipCode: "73301" } }),
    });

    const response = await POST(request);

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      error: "internal_error",
      reason: "We couldn't save your information right now. Please try again shortly.",
    });
    expect(JSON.stringify(body)).not.toContain("password");
  });
});
