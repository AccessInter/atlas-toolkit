import { describe, it, expect } from "vitest";
import { performVarying, performNested } from "../src/cobol";

// Golden values = what the legacy COBOL program DISPLAYed.
describe("PERFORM VARYING / AFTER → for loops", () => {
  it("PERFORM VARYING I FROM 1 BY 1 UNTIL I > 10 → 1..10", () => {
    expect(performVarying(1, 1, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("PERFORM VARYING I FROM 0 BY 2 UNTIL I > 8 → 0,2,4,6,8", () => {
    expect(performVarying(0, 2, 8)).toEqual([0, 2, 4, 6, 8]);
  });

  it("UNTIL is tested BEFORE the body: FROM 11 UNTIL I > 10 → [] ", () => {
    expect(performVarying(11, 1, 10)).toEqual([]);
  });

  it("nested AFTER: outer 1..2 slow, inner 1..3 fast", () => {
    expect(performNested(2, 3)).toEqual([
      [1, 1], [1, 2], [1, 3],
      [2, 1], [2, 2], [2, 3],
    ]);
  });
});
