import { describe, expect, it, vi } from "vitest";
import { checkReadiness } from "./health";

describe("checkReadiness", () => {
  it("is ready only when PostgreSQL and Redis both respond", async () => {
    const checkPostgres = vi.fn().mockResolvedValue(undefined);
    const checkRedis = vi.fn().mockResolvedValue(undefined);
    await expect(checkReadiness({ checkPostgres, checkRedis })).resolves.toEqual({
      ready: true,
      failedChecks: [],
    });
    expect(checkPostgres).toHaveBeenCalledOnce();
    expect(checkRedis).toHaveBeenCalledOnce();
  });

  it("reports dependency categories without exposing connection errors", async () => {
    const result = await checkReadiness({
      checkPostgres: vi.fn().mockRejectedValue(new Error("sensitive-database-detail")),
      checkRedis: vi.fn().mockRejectedValue(new Error("sensitive-redis-detail")),
    });
    expect(result).toEqual({ ready: false, failedChecks: ["postgresql", "redis"] });
    expect(JSON.stringify(result)).not.toContain("sensitive");
    expect(JSON.stringify(result)).not.toContain("detail");
  });
});
