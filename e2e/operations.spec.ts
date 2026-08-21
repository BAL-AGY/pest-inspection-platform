import { expect, test } from "@playwright/test";

test("liveness is generic and non-cacheable", async ({ request }) => {
  const response = await request.get("/api/health/live");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toEqual({ status: "ok" });
});

test("readiness verifies the real PostgreSQL and Redis dependencies", async ({ request }) => {
  const response = await request.get("/api/health/ready");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const body = await response.json();
  expect(body).toEqual({ status: "ready" });
  expect(JSON.stringify(body)).not.toMatch(/postgres|redis|url|host|password|secret/i);
});
