import { describe, it, expect } from "vitest";
import { evaluateGrade } from "../src/cobol";

// EVALUATE TRUE stops at the first matching WHEN — no fall-through.
// Golden values = the grade the legacy program MOVEd for each score.
describe("EVALUATE TRUE → switch (true)", () => {
  it.each([
    [100, "A"],
    [90, "A"], // boundary: >= 90
    [89, "B"],
    [80, "B"], // boundary: >= 80
    [79, "C"],
    [70, "C"], // boundary: >= 70
    [69, "F"],
    [0, "F"],
  ])("score %i → %s", (score, grade) => {
    expect(evaluateGrade(score)).toBe(grade);
  });
});
