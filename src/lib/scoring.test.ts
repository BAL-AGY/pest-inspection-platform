import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCORING_RULES,
  classifyLead,
  computeLeadScore,
  evaluateRule,
} from "./scoring";

describe("evaluateRule", () => {
  it("evaluates truthy operator", () => {
    expect(
      evaluateRule(
        { id: "a", field: "isHomeowner", operator: "truthy", points: 5 },
        { isHomeowner: true },
      ),
    ).toBe(true);
    expect(
      evaluateRule(
        { id: "a", field: "isHomeowner", operator: "truthy", points: 5 },
        { isHomeowner: false },
      ),
    ).toBe(false);
  });

  it("evaluates equals operator", () => {
    expect(
      evaluateRule(
        { id: "a", field: "pestSeverity", operator: "equals", value: "severe", points: 5 },
        { pestSeverity: "severe" },
      ),
    ).toBe(true);
  });

  it("evaluates in operator against scalar answers", () => {
    expect(
      evaluateRule(
        {
          id: "a",
          field: "pestType",
          operator: "in",
          value: ["termites", "rodents"],
          points: 5,
        },
        { pestType: "termites" },
      ),
    ).toBe(true);
    expect(
      evaluateRule(
        {
          id: "a",
          field: "pestType",
          operator: "in",
          value: ["termites", "rodents"],
          points: 5,
        },
        { pestType: "ants" },
      ),
    ).toBe(false);
  });
});

describe("computeLeadScore + classifyLead", () => {
  it("scores an ideal lead as SQL", () => {
    const answers = {
      inServiceArea: true,
      isHomeowner: true,
      pestSeverity: "severe",
      timeline: "asap",
      pestType: "termites",
      contactCaptured: true,
    };
    const score = computeLeadScore(answers, DEFAULT_SCORING_RULES);
    expect(score).toBeGreaterThanOrEqual(70);
    expect(classifyLead(score, 40, 70)).toBe("sql");
  });

  it("scores a low-intent lead as prospect", () => {
    const answers = {
      inServiceArea: false,
      isHomeowner: false,
      pestSeverity: "just_noticed",
      timeline: "just_researching",
      pestType: "spiders",
      contactCaptured: false,
    };
    const score = computeLeadScore(answers, DEFAULT_SCORING_RULES);
    expect(classifyLead(score, 40, 70)).toBe("prospect");
  });

  it("scores a mid-intent lead as MQL", () => {
    const answers = {
      inServiceArea: true,
      isHomeowner: true,
      pestSeverity: "ongoing",
      timeline: "this_month",
      pestType: "ants",
      contactCaptured: true,
    };
    const score = computeLeadScore(answers, DEFAULT_SCORING_RULES);
    expect(classifyLead(score, 40, 70)).toBe("mql");
  });

  it("never returns a negative score", () => {
    expect(computeLeadScore({}, DEFAULT_SCORING_RULES)).toBe(0);
  });
});
