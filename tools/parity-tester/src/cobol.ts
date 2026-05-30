/**
 * ATLAS parity-tester — migrated implementations of common COBOL constructs.
 *
 * Each function is the *target* (modern) side of a documented pattern in
 * `patterns/`. The accompanying tests assert that these implementations
 * reproduce the *legacy* behavior, using golden values that represent what
 * the original COBOL program produced. This is characterization testing:
 * the legacy is the source of truth, the migration must match it exactly.
 *
 * No runtime dependencies on purpose — decimal arithmetic uses scaled BigInt
 * (integer minor units), the safest way to reproduce COBOL fixed-point math
 * without floating-point drift.
 */

// ---------------------------------------------------------------------------
// Pattern: PERFORM VARYING / UNTIL  →  for / while
// ---------------------------------------------------------------------------

/** PERFORM VARYING I FROM `from` BY `by` UNTIL I > `untilOver` (UNTIL tested first). */
export function performVarying(from: number, by: number, untilOver: number): number[] {
  const out: number[] = [];
  for (let i = from; !(i > untilOver); i += by) out.push(i);
  return out;
}

/** Nested PERFORM ... AFTER: outer varies slowly, inner varies fast. */
export function performNested(
  outerMax: number,
  innerMax: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 1; i <= outerMax; i++) {
    for (let j = 1; j <= innerMax; j++) out.push([i, j]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pattern: EVALUATE  →  switch (true)
// ---------------------------------------------------------------------------

/**
 * EVALUATE TRUE
 *   WHEN SCORE >= 90  MOVE "A"
 *   WHEN SCORE >= 80  MOVE "B"
 *   WHEN SCORE >= 70  MOVE "C"
 *   WHEN OTHER        MOVE "F"
 * END-EVALUATE
 *
 * COBOL evaluates WHEN clauses top-to-bottom and stops at the first match
 * (no fall-through). `switch (true)` with `return` reproduces this exactly.
 */
export function evaluateGrade(score: number): string {
  switch (true) {
    case score >= 90:
      return "A";
    case score >= 80:
      return "B";
    case score >= 70:
      return "C";
    default:
      return "F";
  }
}

// ---------------------------------------------------------------------------
// Pattern: PIC S9(n)V9(2) / COMP-3 fixed-point arithmetic  →  scaled BigInt
// ---------------------------------------------------------------------------
//
// COBOL packed-decimal (COMP-3) and zoned-decimal fields hold an EXACT number
// of decimal places. COMPUTE without ROUNDED *truncates* toward zero — it does
// NOT round. Reproducing this with JS `number` (IEEE-754) silently corrupts
// money. We store values as integer minor units (e.g. cents) in BigInt.

const SCALE = 2n; // 2 implied decimals (V99)
const FACTOR = 10n ** SCALE; // 100n

/** "10.00" → 1000n (cents). Rejects values exceeding the declared scale. */
export function toMinor(value: string): bigint {
  const neg = value.trim().startsWith("-");
  const [intPart, fracRaw = ""] = value.trim().replace("-", "").split(".");
  const frac = (fracRaw + "00").slice(0, Number(SCALE));
  const scaled = BigInt(intPart) * FACTOR + BigInt(frac);
  return neg ? -scaled : scaled;
}

/** 1234n → "12.34" (for display / assertions). */
export function fromMinor(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const intPart = abs / FACTOR;
  const frac = (abs % FACTOR).toString().padStart(Number(SCALE), "0");
  return `${neg ? "-" : ""}${intPart}.${frac}`;
}

/** COMPUTE C = A + B  (exact, no drift). */
export function addDecimal(a: bigint, b: bigint): bigint {
  return a + b;
}

/** COMPUTE C = A * B  — both scaled by FACTOR, so divide once, truncating. */
export function multiplyDecimal(a: bigint, b: bigint): bigint {
  // (a/FACTOR) * (b/FACTOR) * FACTOR  ==  a*b/FACTOR, BigInt division truncates toward 0.
  return (a * b) / FACTOR;
}

/** COMPUTE C = A / B  (B is an integer divisor) — default COBOL truncation. */
export function divideTrunc(a: bigint, divisor: bigint): bigint {
  return a / divisor; // BigInt division truncates toward zero, like COBOL
}

/** COMPUTE C ROUNDED = A / B — COBOL half-up rounding away from zero. */
export function divideRounded(a: bigint, divisor: bigint): bigint {
  const neg = a < 0n !== divisor < 0n;
  const absA = a < 0n ? -a : a;
  const absD = divisor < 0n ? -divisor : divisor;
  const q = absA / absD;
  const r = absA % absD;
  const rounded = r * 2n >= absD ? q + 1n : q;
  return neg ? -rounded : rounded;
}

// ---------------------------------------------------------------------------
// Pattern: indexed file I/O (READ/WRITE/INVALID KEY)  →  Map
// ---------------------------------------------------------------------------

/**
 * VSAM/indexed file access keyed by a primary key. COBOL signals a missing
 * record via INVALID KEY; the migration returns `null`. Duplicate WRITE on an
 * existing key raises INVALID KEY in COBOL → we throw.
 */
export class IndexedFile<V> {
  private readonly store = new Map<string, V>();

  write(key: string, record: V): void {
    if (this.store.has(key)) {
      throw new Error(`INVALID KEY: duplicate '${key}'`);
    }
    this.store.set(key, record);
  }

  rewrite(key: string, record: V): void {
    if (!this.store.has(key)) {
      throw new Error(`INVALID KEY: '${key}' not found`);
    }
    this.store.set(key, record);
  }

  /** READ ... INVALID KEY → null. */
  read(key: string): V | null {
    return this.store.has(key) ? (this.store.get(key) as V) : null;
  }

  /** START + READ NEXT ordering: COBOL returns keys in collating sequence. */
  readSequential(): V[] {
    return [...this.store.keys()].sort().map((k) => this.store.get(k) as V);
  }
}
