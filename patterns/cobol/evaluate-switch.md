# COBOL EVALUATE → TypeScript switch

**Difficulty:** 🟢 Easy
**Version:** 1.0
**Last updated:** 2026-05-30

## Description

COBOL `EVALUATE` is a multi-branch selector. The most idiomatic and faithful
translation depends on the form: `EVALUATE TRUE` (range tests) maps to
`switch (true)`, while `EVALUATE <expr>` (value match) maps to a value `switch`.
COBOL stops at the **first** matching `WHEN` — there is **no fall-through** — so
each branch must `return` (or `break`).

## 1. EVALUATE TRUE (range / boolean tests)

### Source (COBOL)
```cobol
EVALUATE TRUE
    WHEN SCORE >= 90  MOVE "A" TO GRADE
    WHEN SCORE >= 80  MOVE "B" TO GRADE
    WHEN SCORE >= 70  MOVE "C" TO GRADE
    WHEN OTHER        MOVE "F" TO GRADE
END-EVALUATE.
```

### Target (TypeScript)
```typescript
function evaluateGrade(score: number): string {
    switch (true) {
        case score >= 90: return "A";
        case score >= 80: return "B";
        case score >= 70: return "C";
        default:          return "F";
    }
}
```

### Rules
- `EVALUATE TRUE` → `switch (true)`, each `WHEN cond` → `case cond:`
- `WHEN OTHER` → `default:`
- First match wins → always `return`/`break`; **order matters** (most specific first)

## 2. EVALUATE <expr> (value match)

### Source (COBOL)
```cobol
EVALUATE WS-STATUS
    WHEN "A"      MOVE "Active"   TO WS-LABEL
    WHEN "C"      MOVE "Closed"   TO WS-LABEL
    WHEN OTHER    MOVE "Unknown"  TO WS-LABEL
END-EVALUATE.
```

### Target (TypeScript)
```typescript
switch (wsStatus) {
    case "A": return "Active";
    case "C": return "Closed";
    default:  return "Unknown";
}
```

## Known edge cases

- **`WHEN A THRU B`** (range) → `case x >= A && x <= B:` under `switch (true)`.
- **Multiple values per branch** (`WHEN "A" "B"`) → stacked `case "A": case "B":`.
- **`EVALUATE` with multiple subjects** (`WHEN x ALSO y`) → combine conditions with `&&` under `switch (true)`.
- **Continue / no MOVE in a branch** → COBOL `CONTINUE` = an empty `case` that still `break`s; do not forget the `break`/`return` or TypeScript will fall through (a behavior COBOL does NOT have). **Flag any intentional fall-through in the discrepancy registry.**

## Parity test

[`tools/parity-tester/tests/evaluate.test.ts`](../../tools/parity-tester/tests/evaluate.test.ts) — checks every boundary value (90/89, 80/79, 70/69) against golden grades.

## Contributors
- Access International team (init)
