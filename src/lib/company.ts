import { prisma } from "./prisma";
import { DEFAULT_SCORING_RULES, type ScoringRule } from "./scoring";
import type { BusinessHours } from "./scheduling";
import { assertValidIanaTimeZone } from "./timezone";

/**
 * v1 serves a single pest control company. Every table is already
 * companyId-scoped (see docs/ARCHITECTURE.md) so a second company can be
 * onboarded later without a schema change — this helper is the one place
 * "which company" gets resolved, so that day it becomes tenant-resolution
 * (subdomain/host/session), not a rewrite.
 */
export async function getActiveCompany() {
  const slug = process.env.DEFAULT_COMPANY_SLUG;
  const company = slug
    ? await prisma.company.findUnique({ where: { slug } })
    : await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });

  if (!company) {
    throw new Error(
      "No company configured. Run `npm run db:seed` to create one for local/dev use.",
    );
  }
  return company;
}

export function parseServiceZipCodes(company: { serviceZipCodes: string }): string[] {
  return JSON.parse(company.serviceZipCodes);
}

export function parseSupportedPests(company: { supportedPests: string }): string[] {
  return JSON.parse(company.supportedPests);
}

export function parseBusinessHours(company: { businessHours: string }): BusinessHours {
  return JSON.parse(company.businessHours);
}

export function parseCompanyTimeZone(company: { timezone: string }): string {
  return assertValidIanaTimeZone(company.timezone);
}

export function parseScoringRules(company: { scoringRules: string }): ScoringRule[] {
  try {
    const parsed = JSON.parse(company.scoringRules);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_SCORING_RULES;
  } catch {
    return DEFAULT_SCORING_RULES;
  }
}
