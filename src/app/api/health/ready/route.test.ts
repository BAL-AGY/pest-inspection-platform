import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/health", () => ({ checkOperationalReadiness: vi.fn() }));

import { checkOperationalReadiness } from "@/lib/health";
import { GET } from "./route";

describe("readiness route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a non-cacheable 200 without infrastructure details", async () => {
    vi.mocked(checkOperationalReadiness).mockResolvedValue({ ready: true, failedChecks: [] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ready" });
  });

  it("returns a generic 503 when a dependency is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(checkOperationalReadiness).mockResolvedValue({ ready: false, failedChecks: ["postgresql"] });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not_ready" });
  });
});
