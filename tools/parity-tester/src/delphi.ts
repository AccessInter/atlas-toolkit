/**
 * Delphi VCL constructs migrated to TypeScript.
 * Target side of patterns/delphi/*. Parity-tested against golden values.
 */

export type Duplicates = "ignore" | "accept" | "error";

/**
 * Faithful subset of Delphi's TStringList.
 * - When `sorted`, entries are kept in order and the `duplicates` policy applies
 *   (Delphi: Duplicates only has an effect on a Sorted list).
 * - Comparison is case-insensitive by default (Delphi CompareText), unless
 *   `caseSensitive` is set.
 * - `values('name')` reads the first "name=value" entry (NameValueSeparator '=').
 */
export class StringList {
  private items: string[] = [];
  sorted = false;
  duplicates: Duplicates = "accept";
  caseSensitive = false;

  private cmp(a: string, b: string): number {
    const x = this.caseSensitive ? a : a.toLowerCase();
    const y = this.caseSensitive ? b : b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }

  /** Add returns the index, like Delphi's TStringList.Add. */
  add(s: string): number {
    if (!this.sorted) {
      this.items.push(s);
      return this.items.length - 1;
    }
    let lo = 0;
    let hi = this.items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cmp(this.items[mid], s) < 0) lo = mid + 1;
      else hi = mid;
    }
    if (this.items[lo] !== undefined && this.cmp(this.items[lo], s) === 0) {
      if (this.duplicates === "ignore") return lo;
      if (this.duplicates === "error") throw new Error("TStringList: duplicate not allowed");
    }
    this.items.splice(lo, 0, s);
    return lo;
  }

  /** -1 when not found, like Delphi. */
  indexOf(s: string): number {
    for (let i = 0; i < this.items.length; i++) {
      if (this.cmp(this.items[i], s) === 0) return i;
    }
    return -1;
  }

  get count(): number {
    return this.items.length;
  }

  get(i: number): string {
    return this.items[i];
  }

  toArray(): string[] {
    return [...this.items];
  }

  /** Values['name'] → value of the first "name=value" entry, '' if absent. */
  values(name: string): string {
    const prefix = `${name}=`;
    for (const it of this.items) {
      if (it.startsWith(prefix)) return it.slice(prefix.length);
    }
    return "";
  }
}
