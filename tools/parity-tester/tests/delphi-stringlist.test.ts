import { describe, it, expect } from "vitest";
import { StringList } from "../src/delphi";

describe("Delphi TStringList → StringList", () => {
  it("Add preserves insertion order when not sorted", () => {
    const sl = new StringList();
    sl.add("banana");
    sl.add("apple");
    expect(sl.toArray()).toEqual(["banana", "apple"]);
  });

  it("Sorted keeps entries ordered (case-insensitive by default)", () => {
    const sl = new StringList();
    sl.sorted = true;
    sl.add("Banana");
    sl.add("apple");
    sl.add("Cherry");
    expect(sl.toArray()).toEqual(["apple", "Banana", "Cherry"]);
  });

  it("Duplicates=ignore drops repeats on a sorted list", () => {
    const sl = new StringList();
    sl.sorted = true;
    sl.duplicates = "ignore";
    sl.add("x");
    sl.add("x");
    expect(sl.count).toBe(1);
  });

  it("Duplicates=error throws on a sorted list", () => {
    const sl = new StringList();
    sl.sorted = true;
    sl.duplicates = "error";
    sl.add("x");
    expect(() => sl.add("x")).toThrow(/duplicate/);
  });

  it("IndexOf returns -1 when not found", () => {
    const sl = new StringList();
    sl.add("a");
    expect(sl.indexOf("a")).toBe(0);
    expect(sl.indexOf("z")).toBe(-1);
  });

  it("Values['name'] reads name=value pairs", () => {
    const sl = new StringList();
    sl.add("host=localhost");
    sl.add("port=8080");
    expect(sl.values("port")).toBe("8080");
    expect(sl.values("missing")).toBe("");
  });
});
