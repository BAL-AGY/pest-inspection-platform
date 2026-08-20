import { describe, expect, it } from "vitest";
import { getNextQuestion, isFunnelComplete, isInServiceArea } from "./qualification";

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
