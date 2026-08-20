import { describe, expect, it } from "vitest";
import {
  deriveQualificationState,
  getNextQuestion,
  isFunnelComplete,
  isInServiceArea,
  validateQualificationSubmission,
} from "./qualification";

describe("getNextQuestion", () => {
  it("starts with zipCode", () => {
    expect(getNextQuestion({})?.id).toBe("zipCode");
  });

  it("skips switchReason when hasExistingProvider is false", () => {
    const answers = {
      zipCode: "73301",
      isHomeowner: true,
      pestType: "ants",
      pestSeverity: "ongoing",
      hasExistingProvider: false,
    };
    expect(getNextQuestion(answers)?.id).toBe("timeline");
  });

  it("asks switchReason when hasExistingProvider is true", () => {
    const answers = {
      zipCode: "73301",
      isHomeowner: true,
      pestType: "ants",
      pestSeverity: "ongoing",
      hasExistingProvider: true,
    };
    expect(getNextQuestion(answers)?.id).toBe("switchReason");
  });

  it("reports funnel complete once all applicable questions are answered", () => {
    const answers = {
      zipCode: "73301",
      isHomeowner: true,
      pestType: "ants",
      pestSeverity: "ongoing",
      hasExistingProvider: false,
      timeline: "asap",
    };
    expect(isFunnelComplete(answers)).toBe(true);
  });
});

describe("isInServiceArea", () => {
  it("returns true for a serviced ZIP", () => {
    expect(isInServiceArea("73301", ["73301", "78701"])).toBe(true);
  });

  it("returns false for an unserviced ZIP", () => {
    expect(isInServiceArea("90210", ["73301", "78701"])).toBe(false);
  });

  it("returns false when zip is missing", () => {
    expect(isInServiceArea(undefined, ["73301"])).toBe(false);
  });
});

describe("validateQualificationSubmission", () => {
  it("rejects unknown questions, wrong types, and invalid options", () => {
    expect(
      validateQualificationSubmission({ priorAnswers: {}, submittedAnswers: { score: 999 } }),
    ).toMatchObject({ success: false, issue: { code: "unknown_question" } });
    expect(
      validateQualificationSubmission({ priorAnswers: {}, submittedAnswers: { zipCode: 73301 } }),
    ).toMatchObject({ success: false, issue: { code: "invalid_answer_type" } });
    expect(
      validateQualificationSubmission({
        priorAnswers: { zipCode: "73301", isHomeowner: true },
        submittedAnswers: { pestType: "scorpions" },
      }),
    ).toMatchObject({ success: false, issue: { code: "invalid_answer_value" } });
  });

  it("allows only the next visible question and safely permits corrections", () => {
    expect(
      validateQualificationSubmission({ priorAnswers: {}, submittedAnswers: { pestType: "ants" } }),
    ).toMatchObject({ success: false, issue: { code: "invalid_progression" } });
    expect(
      validateQualificationSubmission({
        priorAnswers: { zipCode: "73301" },
        submittedAnswers: { zipCode: "90210" },
      }),
    ).toMatchObject({ success: true, answers: { zipCode: "90210" } });
  });

  it("requires switchReason only for the existing-provider branch", () => {
    const base = {
      zipCode: "73301",
      isHomeowner: true,
      pestType: "ants",
      pestSeverity: "ongoing",
    };
    expect(
      validateQualificationSubmission({
        priorAnswers: { ...base, hasExistingProvider: true },
        submittedAnswers: { timeline: "asap" },
      }),
    ).toMatchObject({ success: false, issue: { code: "invalid_progression" } });
    expect(
      validateQualificationSubmission({
        priorAnswers: { ...base, hasExistingProvider: false },
        submittedAnswers: { switchReason: "poor_service" },
      }),
    ).toMatchObject({ success: false, issue: { code: "answer_not_applicable" } });

    expect(
      validateQualificationSubmission({
        priorAnswers: {
          ...base,
          hasExistingProvider: true,
          switchReason: "poor_service",
          timeline: "asap",
        },
        submittedAnswers: { hasExistingProvider: false },
      }),
    ).toMatchObject({
      success: true,
      answers: { hasExistingProvider: false, timeline: "asap" },
    });
  });
});

describe("deriveQualificationState", () => {
  const completeAnswers = {
    zipCode: "73301",
    isHomeowner: true,
    pestType: "ants",
    pestSeverity: "ongoing",
    hasExistingProvider: false,
    timeline: "asap",
  };

  it("requires completion, contact, service area, and a supported pest for booking", () => {
    expect(
      deriveQualificationState({
        answers: completeAnswers,
        serviceZipCodes: ["73301"],
        supportedPests: ["ants"],
        hasContact: true,
      }),
    ).toMatchObject({ complete: true, eligibleForBooking: true });
    expect(
      deriveQualificationState({
        answers: { ...completeAnswers, pestType: "other" },
        serviceZipCodes: ["73301"],
        supportedPests: ["ants"],
        hasContact: true,
      }),
    ).toMatchObject({ complete: true, supportedPest: false, eligibleForBooking: false });
  });
});
