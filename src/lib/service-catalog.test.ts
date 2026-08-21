import { describe, expect, it } from "vitest";
import {
  DEFAULT_PEST_CATEGORIES,
  formatPotentialValueRange,
  parsePestCategories,
  parseServiceArrangements,
  pestCategoryForConcern,
} from "./service-catalog";

describe("service catalog", () => {
  it("keeps qualification category, potential range, and actual revenue as separate concepts", () => {
    expect(pestCategoryForConcern(DEFAULT_PEST_CATEGORIES, "ants")?.id).toBe("general_pest");
    expect(pestCategoryForConcern(DEFAULT_PEST_CATEGORIES, "fleas")?.id).toBe("fleas");
    expect(pestCategoryForConcern(DEFAULT_PEST_CATEGORIES, "termites")?.id).toBe("other");
    expect(formatPotentialValueRange(DEFAULT_PEST_CATEGORIES.find((item) => item.id === "general_pest")!)).toBe("$200–$1,000");
    expect(formatPotentialValueRange(DEFAULT_PEST_CATEGORIES.find((item) => item.id === "rodents")!)).toBe("$250–$5,000+");
    expect(formatPotentialValueRange(DEFAULT_PEST_CATEGORIES.find((item) => item.id === "other")!)).toBeNull();
  });

  it("uses validated company configuration and safely falls back for malformed data", () => {
    const custom = [{ ...DEFAULT_PEST_CATEGORIES[0], label: "Household Pests" }];
    expect(parsePestCategories({ pestCategoryConfig: JSON.stringify(custom) })[0].label).toBe("Household Pests");
    expect(parsePestCategories({ pestCategoryConfig: "not-json" })).toEqual(DEFAULT_PEST_CATEGORIES);
    expect(parseServiceArrangements({ serviceArrangements: JSON.stringify(["ONE_TIME"]) })).toEqual(["ONE_TIME"]);
    expect(parseServiceArrangements({ serviceArrangements: JSON.stringify(["INVALID"]) })).toEqual(["ONE_TIME", "QUARTERLY", "BIMONTHLY"]);
  });
});
