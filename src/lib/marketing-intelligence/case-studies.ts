import fs from "node:fs";
import path from "node:path";
import { type CaseStudy, type CaseStudyValidationError, parseCaseStudy } from "./case-study-schema";

// Case studies are versioned, human-curated repo content — not tenant data —
// so they live as individual JSON files under docs/marketing-intelligence/
// case-studies/, not in the database. This keeps every study reviewable in a
// normal PR diff and lets `dateAccessed`/sourceUrl stay honest over time.
// See docs/marketing-intelligence/README.md for how to add one.
const CASE_STUDIES_DIR = path.join(process.cwd(), "docs", "marketing-intelligence", "case-studies");

export interface LoadedCaseStudies {
  studies: CaseStudy[];
  errors: CaseStudyValidationError[];
}

// Reads and validates every *.json file in the case-studies directory.
// Malformed studies are rejected (returned in `errors`, never silently
// dropped or auto-corrected) rather than allowed to enter the benchmark or
// recommendation engines with fabricated/coerced values.
export function loadCaseStudies(dir: string = CASE_STUDIES_DIR): LoadedCaseStudies {
  const studies: CaseStudy[] = [];
  const errors: CaseStudyValidationError[] = [];
  const seenIds = new Set<string>();

  let entries: string[];
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    // Directory doesn't exist yet — a legitimate empty state, not an error.
    return { studies, errors };
  }

  for (const file of entries.sort()) {
    const fullPath = path.join(dir, file);
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
    } catch (err) {
      errors.push({ file, issues: [`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`] });
      continue;
    }
    const result = parseCaseStudy(file, raw);
    if ("error" in result) {
      errors.push(result.error);
      continue;
    }
    if (seenIds.has(result.study.id)) {
      errors.push({ file, issues: [`Duplicate case-study id "${result.study.id}" — ids must be unique.`] });
      continue;
    }
    seenIds.add(result.study.id);
    studies.push(result.study);
  }

  return { studies, errors };
}

export function getCaseStudyById(id: string, dir?: string): CaseStudy | null {
  return loadCaseStudies(dir).studies.find((s) => s.id === id) ?? null;
}
