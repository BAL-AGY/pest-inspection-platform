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

  it("asks symptoms right after pestType", () => {
    const answers = {
      zipCode: "73301",
      isHomeowner: true,
      pestType: "ants",
    };
    expect(getNextQuestion(answers)?.id).toBe("symptoms");
  });

  it("skips switchReason when hasExistingProvider is false", () => {
    const answers = {
      zipCode: "73301",
      isHomeowner: true,
      pestType: "ants",
      symptoms: ["live_pests"],
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
      symptoms: ["live_pests"],
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
      symptoms: ["live_pests"],
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
      symptoms: ["live_pests"],
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
    symptoms: ["live_pests"],
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

describe("multi_select symptoms question", () => {
  const priorThroughPestType = { zipCode: "73301", isHomeowner: true, pestType: "rodents" };

  it("accepts a single selection", () => {
    const result = validateQualificationSubmission({
      priorAnswers: priorThroughPestType,
      submittedAnswers: { symptoms: ["droppings"] },
    });
    expect(result).toMatchObject({ success: true, answers: { symptoms: ["droppings"] } });
  });

  it("accepts multiple selections", () => {
    const result = validateQualificationSubmission({
      priorAnswers: priorThroughPestType,
      submittedAnswers: { symptoms: ["droppings", "noises", "nests_webs"] },
    });
    expect(result).toMatchObject({
      success: true,
      answers: { symptoms: ["droppings", "noises", "nests_webs"] },
    });
  });

  it("rejects an empty selection", () => {
    const result = validateQualificationSubmission({
      priorAnswers: priorThroughPestType,
      submittedAnswers: { symptoms: [] },
    });
    expect(result).toMatchObject({ success: false, issue: { code: "invalid_answer_type" } });
  });

  it("rejects a value outside the option set", () => {
    const result = validateQualificationSubmission({
      priorAnswers: priorThroughPestType,
      submittedAnswers: { symptoms: ["droppings", "not_a_real_symptom"] },
    });
    expect(result).toMatchObject({ success: false, issue: { code: "invalid_answer_value" } });
  });

  it("rejects a plain string instead of an array (legacy single-select shape)", () => {
    const result = validateQualificationSubmission({
      priorAnswers: priorThroughPestType,
      submittedAnswers: { symptoms: "droppings" },
    });
    expect(result).toMatchObject({ success: false, issue: { code: "invalid_answer_type" } });
  });

  it("advances to pestSeverity once symptoms is answered", () => {
    const answers = { ...priorThroughPestType, symptoms: ["live_pests"] };
    expect(getNextQuestion(answers)?.id).toBe("pestSeverity");
  });

  it("resubmitting the same selection alongside a later answer counts as only one new entry (Back/resume safe)", () => {
    // Simulates the funnel client resending the full cumulative answers
    // object (including the already-saved symptoms array) when answering
    // the next question — the exact shape produced by Back navigation
    // landing back on an already-answered step and resuming forward.
    const priorAnswers = { ...priorThroughPestType, symptoms: ["live_pests", "droppings"] };
    const result = validateQualificationSubmission({
      priorAnswers,
      // A fresh array with identical content but a different object
      // reference — exactly what JSON.parse(JSON.stringify(...)) over the
      // wire produces, even when nothing actually changed.
      submittedAnswers: {
        symptoms: JSON.parse(JSON.stringify(priorAnswers.symptoms)),
        pestSeverity: "ongoing",
      },
    });
    expect(result).toMatchObject({
      success: true,
      answers: { symptoms: ["live_pests", "droppings"], pestSeverity: "ongoing" },
    });
  });

  it("allows correcting a previously answered symptoms selection", () => {
    const priorAnswers = { ...priorThroughPestType, symptoms: ["live_pests"], pestSeverity: "ongoing" };
    const result = validateQualificationSubmission({
      priorAnswers,
      submittedAnswers: { symptoms: ["live_pests", "dead_pests"] },
    });
    expect(result).toMatchObject({ success: true, answers: { symptoms: ["live_pests", "dead_pests"] } });
  });
});
