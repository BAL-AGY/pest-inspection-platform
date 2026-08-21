const baseUrlValue = process.env.STAGING_BASE_URL?.trim();

if (!baseUrlValue) {
  throw new Error("STAGING_BASE_URL is required (for example, https://SERVICE-NAME.onrender.com).");
}

const baseUrl = new URL(baseUrlValue);
if (baseUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(baseUrl.hostname)) {
  throw new Error("STAGING_BASE_URL must use HTTPS unless it targets localhost.");
}

async function check(path, expectedStatus, expectedBody) {
  const response = await fetch(new URL(path, baseUrl), {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  if (response.status !== expectedStatus || !body.includes(expectedBody)) {
    throw new Error(`${path} failed: expected HTTP ${expectedStatus} containing ${JSON.stringify(expectedBody)}.`);
  }
  console.log(`PASS ${path} (${response.status})`);
}

await check("/", 200, "STAGING DEMO");
await check("/api/health/live", 200, '"status":"ok"');
await check("/api/health/ready", 200, '"status":"ready"');
await check("/api/health", 200, '"status":"healthy"');
