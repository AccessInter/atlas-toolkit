# COBOL fixed-point decimal (PIC S9V99 / COMP-3) → scaled BigInt

**Difficulty:** 🔴 Hard — the single most common source of money bugs in migrations
**Version:** 1.0
**Last updated:** 2026-05-30

## Description

COBOL numeric fields (`PIC S9(n)V9(m)`, packed `COMP-3`, zoned display) hold an
**exact** number of decimal places and perform **base-10** arithmetic.
Translating them to JavaScript `number` (IEEE-754 binary floating point)
silently corrupts values: `0.1 + 0.2 !== 0.3`. For money, interest, tax and
balances this is unacceptable.

The faithful target is **integer minor units stored as `BigInt`** (e.g. cents
for `V99`). This reproduces COBOL's exactness and its **truncation** semantics.

## The two rules that bite

1. **`COMPUTE` truncates toward zero** by default — it does **not** round. Rounding only happens with the explicit `ROUNDED` clause.
2. **No floating point, ever.** Scale every value to an integer, compute, then unscale only for display.

## Source (COBOL)
```cobol
01 WS-A   PIC S9(5)V99 COMP-3 VALUE 5.00.
01 WS-B   PIC S9(5)V99 COMP-3 VALUE 3.00.
01 WS-R   PIC S9(5)V99 COMP-3.

COMPUTE WS-R = WS-A / WS-B.            *> 1.66  (1.6667 truncated)
COMPUTE WS-R ROUNDED = WS-A / WS-B.   *> 1.67
```

## Target (TypeScript)
```typescript
const SCALE = 2n;
const FACTOR = 10n ** SCALE;          // 100n  → 2 implied decimals (V99)

const toMinor   = (v: string) => /* "5.00" → 500n */ ...;
const fromMinor = (c: bigint) => /* 166n → "1.66" */ ...;

// COMPUTE WS-R = WS-A / WS-B  (truncate toward zero, like BigInt division)
const trunc   = toMinor("5.00") / 3n;                 // 166n → "1.66"

// COMPUTE WS-R ROUNDED = WS-A / WS-B  (half-up, away from zero)
const rounded = divideRounded(toMinor("5.00"), 3n);   // 167n → "1.67"
```

Full implementation: [`tools/parity-tester/src/cobol.ts`](../../tools/parity-tester/src/cobol.ts).

## Rules

- `PIC S9(n)V9(m)` → values scaled by `10^m`, stored as `BigInt`.
- `ADD` / `SUBTRACT` → `+` / `-` on the scaled integers (always exact).
- `MULTIPLY` of two `V99` values → `(a * b) / FACTOR` (divide once to re-normalize, truncating).
- `DIVIDE` → `BigInt` division (truncates toward zero) = default COBOL behavior.
- `ROUNDED` → explicit half-up rounding away from zero.
- Display/`PIC` editing happens **only** at output time via `fromMinor`.

## Known edge cases

- **Float trap:** `0.10 + 0.20` must equal `0.30` exactly — proven in the test.
- **Negative truncation:** COBOL truncates toward **zero**, not toward −∞. `-5.00 / 3 = -1.66` (not `-1.67`). `BigInt` division matches this; `Math.floor` would not.
- **Intermediate precision:** COBOL keeps high intermediate precision then applies the receiving field's scale once. Mirror that — do not round at every step.
- **Mixed scales** (`V99` × `V9999`): normalize to the larger scale before computing, then re-normalize to the receiving field.

## Parity test

[`tools/parity-tester/tests/decimal-arithmetic.test.ts`](../../tools/parity-tester/tests/decimal-arithmetic.test.ts) — 7 assertions covering add, multiply-with-truncation, divide truncated vs ROUNDED, negatives, and the IEEE-754 trap.

## Contributors
- Access International team (init)
