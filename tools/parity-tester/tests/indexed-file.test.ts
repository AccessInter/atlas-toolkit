import { describe, it, expect } from "vitest";
import { IndexedFile } from "../src/cobol";

// Indexed (VSAM) file access. INVALID KEY → null on READ, throw on duplicate WRITE.
describe("Indexed file I/O → Map", () => {
  it("WRITE then READ returns the record; missing key → null (INVALID KEY)", () => {
    const f = new IndexedFile<{ name: string }>();
    f.write("C001", { name: "Alice" });
    expect(f.read("C001")).toEqual({ name: "Alice" });
    expect(f.read("C999")).toBeNull();
  });

  it("duplicate WRITE raises INVALID KEY", () => {
    const f = new IndexedFile<number>();
    f.write("K", 1);
    expect(() => f.write("K", 2)).toThrow(/INVALID KEY/);
  });

  it("REWRITE on a missing key raises INVALID KEY", () => {
    const f = new IndexedFile<number>();
    expect(() => f.rewrite("nope", 1)).toThrow(/INVALID KEY/);
  });

  it("READ NEXT returns records in key collating sequence", () => {
    const f = new IndexedFile<string>();
    f.write("C003", "c");
    f.write("C001", "a");
    f.write("C002", "b");
    expect(f.readSequential()).toEqual(["a", "b", "c"]);
  });
});
