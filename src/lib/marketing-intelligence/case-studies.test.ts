import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCaseStudies } from "./case-studies";
import { FIXTURE_metaFreeInspectionHigh1 } from "./__fixtures__/test-case-studies";

// These tests write TEST/FIXTURE files to a scratch temp directory — never
// to docs/marketing-intelligence/case-studies/ — so they can never leak into
// what the production dashboard loads.
describe("loadCaseStudies", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "case-studies-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty result when the directory doesn't exist yet (legitimate empty state)", () => {
    const result = loadCaseStudies(path.join(dir, "does-not-exist"));
    expect(result.studies).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("loads a valid case study file", () => {
    fs.writeFileSync(path.join(dir, "one.json"), JSON.stringify(FIXTURE_metaFreeInspectionHigh1));
    const result = loadCaseStudies(dir);
    expect(result.studies).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.studies[0].id).toBe(FIXTURE_metaFreeInspectionHigh1.id);
  });

  it("rejects malformed JSON without crashing or dropping other valid files", () => {
    fs.writeFileSync(path.join(dir, "good.json"), JSON.stringify(FIXTURE_metaFreeInspectionHigh1));
    fs.writeFileSync(path.join(dir, "broken.json"), "{ not valid json");
    const result = loadCaseStudies(dir);
    expect(result.studies).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toBe("broken.json");
  });

  it("rejects a study that fails schema validation, without fabricating defaults", () => {
    fs.writeFileSync(path.join(dir, "invalid.json"), JSON.stringify({ id: "x" }));
    const result = loadCaseStudies(dir);
    expect(result.studies).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });

  it("rejects a duplicate case-study id", () => {
    fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify(FIXTURE_metaFreeInspectionHigh1));
    fs.writeFileSync(path.join(dir, "b.json"), JSON.stringify(FIXTURE_metaFreeInspectionHigh1));
    const result = loadCaseStudies(dir);
    expect(result.studies).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].issues[0]).toMatch(/duplicate/i);
  });

  it("ignores non-JSON files in the directory", () => {
    fs.writeFileSync(path.join(dir, "README.md"), "# not a case study");
    const result = loadCaseStudies(dir);
    expect(result.studies).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
