import type { LeadClassification } from "./pipeline";

/**
 * Lead scoring is company-configurable data, not hardcoded logic, so an
 * owner can eventually tune what makes a lead "hot" without a code change.
 * A rule awards `points` when `field` in the qualification answers matches
 * `value` under `operator`.
 */
export type ScoringOperator = "equals" | "in" | "truthy" | "falsy";

export interface ScoringRule {
  id: string;
  field: string;
  operator: ScoringOperator;
  value?: string | number | boolean | (string | number)[];
  points: number;
}

export type QualificationAnswers = Record<
  string,
  string | number | boolean | string[] | undefined
>;

export function evaluateRule(
  rule: ScoringRule,
  answers: QualificationAnswers,
): boolean {
  const actual = answers[rule.field];

  switch (rule.operator) {
    case "truthy":
      return Boolean(actual);
    case "falsy":
      return !actual;
    case "equals":
      return actual === rule.value;
    case "in": {
      const candidates = Array.isArray(rule.value) ? rule.value : [];
      if (Array.isArray(actual)) {
        return actual.some((a) => candidates.includes(a));
      }
      return candidates.includes(actual as string | number);
    }
    default:
      return false;
  }
}

export function computeLeadScore(
  answers: QualificationAnswers,
  rules: ScoringRule[],
): number {
  let score = 0;
  for (const rule of rules) {
    if (evaluateRule(rule, answers)) {
      score += rule.points;
    }
  }
  return Math.max(0, score);
}

export function classifyLead(
  score: number,
  mqlThreshold: number,
  sqlThreshold: number,
): LeadClassification {
  if (score >= sqlThreshold) return "sql";
  if (score >= mqlThreshold) return "mql";
  return "prospect";
}

/**
 * Sensible starting rule set every new Company is seeded with. Fully
 * editable per company afterward via Company.scoringRules.
 */
export const DEFAULT_SCORING_RULES: ScoringRule[] = [
  { id: "in-service-area", field: "inServiceArea", operator: "truthy", points: 20 },
  { id: "is-homeowner", field: "isHomeowner", operator: "truthy", points: 15 },
  {
    id: "severity-severe",
    field: "pestSeverity",
    operator: "equals",
    value: "severe",
    points: 25,
  },
  {
    id: "severity-ongoing",
    field: "pestSeverity",
    operator: "equals",
    value: "ongoing",
    points: 15,
  },
  {
    id: "timeline-asap",
    field: "timeline",
    operator: "equals",
    value: "asap",
    points: 20,
  },
  {
    id: "timeline-this-week",
    field: "timeline",
    operator: "equals",
    value: "this_week",
    points: 12,
  },
  {
    id: "high-risk-pest",
    field: "pestType",
    operator: "in",
    value: ["termites", "bed_bugs", "rodents"],
    points: 15,
  },
  {
    id: "dissatisfied-switcher",
    field: "switchReason",
    operator: "in",
    value: [
      "pest_returned_after_treatment",
      "poor_service",
      "recurring_infestation",
    ],
    points: 15,
  },
  { id: "contact-captured", field: "contactCaptured", operator: "truthy", points: 10 },
];
