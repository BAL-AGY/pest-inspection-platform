export type JsonObject = Record<string, unknown>;

/** Parse an API response only when it actually contains JSON. */
export async function readJsonObject(response: Response): Promise<JsonObject | null> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) return null;

  try {
    const value: unknown = await response.json();
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as JsonObject
      : null;
  } catch {
    return null;
  }
}

export function homeownerApiError(response: Response, data: JsonObject | null): string {
  if (response.status === 429) return "Too many attempts. Please wait a moment and try again.";
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    return "Your inspection session could not be verified. Please refresh and start again.";
  }
  if (response.status >= 500) {
    return "We couldn't save your information right now. Please try again in a moment.";
  }

  const reason = data?.reason;
  return typeof reason === "string" && reason.length <= 300
    ? reason
    : "Please check your information and try again.";
}
