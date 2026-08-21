import { expect, test } from "@playwright/test";

test("lead API returns JSON for success, validation, and invalid ownership responses", async ({ request }) => {
  const visitorId = `response-contract-${Date.now()}`;
  const success = await request.post("/api/leads", {
    data: { visitorId, answers: { zipCode: "73301" } },
  });
  expect(success.status()).toBe(200);
  expect(success.headers()["content-type"]).toContain("application/json");
  const created = await success.json();
  expect(created.lead.id).toBeTruthy();

  const validation = await request.post("/api/leads", {
    data: {
      visitorId: `invalid-response-contract-${Date.now()}`,
      answers: { inventedQuestion: "yes" },
    },
  });
  expect(validation.status()).toBe(400);
  expect(validation.headers()["content-type"]).toContain("application/json");
  await expect(validation.json()).resolves.toMatchObject({ error: "invalid_qualification" });

  const forbidden = await request.post("/api/leads", {
    data: {
      visitorId,
      leadId: created.lead.id,
      leadToken: "malformed-token",
      answers: { isHomeowner: true },
    },
  });
  expect(forbidden.status()).toBe(403);
  expect(forbidden.headers()["content-type"]).toContain("application/json");
  await expect(forbidden.json()).resolves.toEqual({ error: "forbidden" });
});

test("an empty server error shows a homeowner-safe message without crashing the funnel", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("**/api/leads", async (route) => {
    await route.fulfill({ status: 500, body: "" });
  });

  await page.goto("/inspection");
  await page.getByPlaceholder("ZIP code").fill("73301");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.locator('p[role="alert"]')).toContainText(/couldn't save your information/i);
  await expect(page.getByPlaceholder("ZIP code")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
