import { test, expect } from "@playwright/test";

/**
 * The public homeowner funnel is the single most important conversion path
 * in the platform (see CLAUDE.md) and most real acquisition traffic arrives
 * on a phone. This covers the four widths explicitly called out for mobile
 * UX verification (320/375/390/430 — iPhone SE through the larger modern
 * iPhones) rather than one arbitrary viewport. A real audit at these widths
 * (screenshots + a DOM overflow scan) found one genuine bug: the ZIP-code
 * form used `flex-1` on the `<input>` inside a `flex` row without
 * `min-w-0`, so the browser's default input min-content width prevented it
 * from shrinking below the "Next" button's width, pushing the button 16px
 * off-screen at 320px — a real homeowner on an iPhone SE could not tap
 * "Next" without scrolling sideways first. Fixed in
 * src/app/inspection/page.tsx by adding `min-w-0` (the standard fix for
 * this well-known flexbox behavior). The same latent pattern (a `flex-1`
 * input with no `min-w-0` in a `flex` row) existed in the CRM's "Add a
 * note" form (src/app/dashboard/leads/[id]/page.tsx) — its shorter
 * placeholder/button text don't actually overflow at these widths today,
 * confirmed by reverting the fix and seeing the test still pass, but it
 * was fixed defensively anyway since it's the identical risk one content
 * change away from reproducing. This is a targeted, additive check — not
 * a full multi-browser
 * matrix (which would require reviewing every existing test for
 * viewport-specific assumptions) — proving the golden path stays usable
 * and doesn't overflow horizontally on the widths that matter.
 */

const WIDTHS = [320, 375, 390, 430] as const;
const MIN_TOUCH_TARGET_PX = 44;

async function hasHorizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

for (const width of WIDTHS) {
  test(`homeowner funnel has no horizontal overflow through qualification at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/inspection");

    await expect(page.getByPlaceholder("ZIP code")).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);

    // The exact stage the min-w-0 regression lived on — checked explicitly
    // (not just generically) so a reintroduction is caught immediately.
    const nextButton = page.getByRole("button", { name: "Next", exact: true });
    const nextBox = await nextButton.boundingBox();
    expect(nextBox).not.toBeNull();
    expect(nextBox!.x + nextBox!.width).toBeLessThanOrEqual(width + 1);
    expect(nextBox!.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);

    await page.getByPlaceholder("ZIP code").fill("73301");
    await nextButton.click();
    await expect(page.getByRole("heading", { name: /do you own this home/i })).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
    const yesBox = await page.getByRole("button", { name: "Yes" }).boundingBox();
    expect(yesBox!.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);

    await page.getByRole("button", { name: "Yes" }).click();
    await expect(page.getByRole("heading", { name: /what pest issue/i })).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);

    await page.getByRole("button", { name: "Rodents", exact: true }).click();
    await expect(page.getByRole("heading", { name: /how would you describe the problem/i })).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);

    await page.getByRole("button", { name: "It's a serious infestation", exact: true }).click();
    await expect(page.getByRole("heading", { name: /pay for pest control service/i })).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);

    await page.getByRole("button", { name: "No" }).click();
    await expect(page.getByRole("heading", { name: /when would you like this addressed/i })).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);

    await page.getByRole("button", { name: "As soon as possible", exact: true }).click();
    await expect(page.getByPlaceholder("Email")).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);

    // iOS Safari auto-zooms the page on focusing any input with a
    // computed font-size under 16px — a real, well-known mobile UX
    // papercut, not just a cosmetic preference.
    const emailFontSize = await page.getByPlaceholder("Email").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(emailFontSize).toBeGreaterThanOrEqual(16);
  });
}

test("homeowner funnel: full booking journey (contact through confirmation) has no overflow at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/inspection");
  await page.getByPlaceholder("ZIP code").fill("73301");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Yes" }).click();
  await page.getByRole("button", { name: "Rodents", exact: true }).click();
  await page.getByRole("button", { name: "It's a serious infestation", exact: true }).click();
  await page.getByRole("button", { name: "No" }).click();
  await page.getByRole("button", { name: "As soon as possible", exact: true }).click();

  const stamp = Date.now();
  await page.getByPlaceholder("First name").fill("Mobile");
  await page.getByPlaceholder("Last name").fill("Journey");
  await page.getByPlaceholder("Email").fill(`mobile.journey.${stamp}@example.com`);
  await page.getByPlaceholder("Phone").fill("5125550199");
  await page.getByRole("button", { name: "See Available Times" }).click();

  await expect(page.getByRole("button", { name: "Book Free Inspection" })).toBeVisible();
  expect(await hasHorizontalOverflow(page)).toBe(false);

  const slotButtons = page.locator("button.rounded-md.border").filter({ hasNotText: "Book Free Inspection" });
  // The scheduler's default availability window is bounded (14 days —
  // src/app/api/availability/route.ts) and shared, real local-database
  // capacity across every e2e run in this repo that books an appointment
  // (there is no per-test tenant isolation yet — see docs/GOAL_AUDIT.md
  // Critical Path item 14). A long-running local dev database can end up
  // with that whole window saturated, which is an environment/test-data
  // condition, not a product bug this test exists to catch — skip rather
  // than fail so a real regression in the pre-booking UI (already
  // verified above) isn't masked by, or confused with, this.
  const slotCount = await slotButtons.count();
  test.skip(slotCount === 0, "No availability in the default booking window — local test-data capacity exhausted, not a product bug.");
  await slotButtons.first().click();

  const bookButton = page.getByRole("button", { name: "Book Free Inspection" });
  const bookBox = await bookButton.boundingBox();
  expect(bookBox!.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);

  await bookButton.click();
  await expect(page.getByRole("heading", { name: /you.re booked/i })).toBeVisible();
  expect(await hasHorizontalOverflow(page)).toBe(false);
});

test("the disqualification (not-eligible) screen has no overflow at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/inspection");
  await page.getByPlaceholder("ZIP code").fill("90210"); // out of the seeded service area
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: /thanks for reaching out/i })).toBeVisible();
  expect(await hasHorizontalOverflow(page)).toBe(false);
});

for (const width of WIDTHS) {
  test(`the owner dashboard has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
    const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "changeme123";

    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(OWNER_EMAIL);
    await page.getByPlaceholder("Password").fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await expect(page.getByRole("heading", { name: "Needs your attention today" })).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
}

test("the CRM lead-detail 'add a note' form has no overflow at 320px", async ({ page }) => {
  const stamp = Date.now();
  const visitorId = `e2e-mobile-notecheck-${stamp}`;
  let leadId: string | null = null;
  let leadToken: string | null = null;
  for (const answers of [
    { zipCode: "73301" },
    { isHomeowner: true },
    { pestType: "rodents" },
    { pestSeverity: "severe" },
    { hasExistingProvider: false },
    { timeline: "asap" },
  ]) {
    const r = await page.request.post("/api/leads", { data: { visitorId, leadId, leadToken, answers } });
    const body = await r.json();
    leadId = body.lead.id;
    leadToken = body.leadToken;
  }
  await page.request.post("/api/leads", {
    data: {
      visitorId,
      leadId,
      leadToken,
      contact: { firstName: "Note", lastName: `Check${stamp}`, email: `notecheck.${stamp}@example.com`, phone: "+15125550188" },
    },
  });

  await page.setViewportSize({ width: 320, height: 800 });
  const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? "owner@example.com";
  const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "changeme123";
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(OWNER_EMAIL);
  await page.getByPlaceholder("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto(`/dashboard/leads/${leadId}`);
  await expect(page.getByPlaceholder("Add a note…")).toBeVisible();
  expect(await hasHorizontalOverflow(page)).toBe(false);
  const addButton = page.getByRole("button", { name: "Add", exact: true });
  const addBox = await addButton.boundingBox();
  expect(addBox!.x + addBox!.width).toBeLessThanOrEqual(320 + 1);
});
