import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/health", () => ({ checkOperationalReadiness: vi.fn() }));

import { checkOperationalReadiness } from "@/lib/health";
import { GET } from "./route";

describe("aggregate health route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports readiness without naming infrastructure", async () => {
    vi.mocked(checkOperationalReadiness).mockResolvedValue({ ready: true, failedChecks: [] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "healthy" });
  });

  it("fails generically when a dependency is unavailable", async () => {
    vi.mocked(checkOperationalReadiness).mockResolvedValue({ ready: false, failedChecks: ["redis"] });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unhealthy" });
  });
});
