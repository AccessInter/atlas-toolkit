# COBOL PERFORM loops → TypeScript

**Difficulty:** 🟢 Easy
**Version:** 1.1
**Last updated:** 2026-05-30

## Description

COBOL `PERFORM VARYING` and `PERFORM UNTIL` map to standard `for` / `while`
loops in TypeScript. This pattern covers the 5 common forms plus known edge cases.

## 1. PERFORM VARYING (counter)

### Source (COBOL)
```cobol
PERFORM VARYING I FROM 1 BY 1 UNTIL I > 10
    DISPLAY I
END-PERFORM.
```

### Target (TypeScript)
```typescript
for (let i = 1; i <= 10; i++) {
    console.log(i);
}
```

### Rules
- `VARYING X FROM A BY B UNTIL cond` → `for (let x = A; !cond; x += B)`
- `UNTIL` is evaluated **before** each iteration (like `while`)
- `DISPLAY` → `console.log` (or a logger)

## 2. PERFORM UNTIL (while)

### Source (COBOL)
```cobol
PERFORM UNTIL EOF-FLAG = 'Y'
    READ INPUT-FILE
        AT END MOVE 'Y' TO EOF-FLAG
    END-READ
END-PERFORM.
```

### Target (TypeScript)
```typescript
let eofFlag = 'N';
while (eofFlag !== 'Y') {
    const record = await inputFile.read();
    if (record === null) eofFlag = 'Y';
    else { /* process record */ }
}
```

### Rules
- `PERFORM UNTIL` = a `while` with the inverted condition
- `AT END` = a null-check on the target side

## 3. PERFORM VARYING ... AFTER (nested)

### Source (COBOL)
```cobol
PERFORM VARYING I FROM 1 BY 1 UNTIL I > 5
    AFTER J FROM 1 BY 1 UNTIL J > 3
        COMPUTE RESULT = I * J
END-PERFORM.
```

### Target (TypeScript)
```typescript
for (let i = 1; i <= 5; i++) {
    for (let j = 1; j <= 3; j++) {
        const result = i * j;
    }
}
```

### Rules
- Each `AFTER` becomes one nested loop
- Iteration order: outer counter varies slowly, inner counter varies fast (same as TS)

## 4. PERFORM THRU (section range — deprecated)

### Source (COBOL)
```cobol
PERFORM SECTION-A THRU SECTION-C.
```

### Target (TypeScript)
No direct translation. `PERFORM THRU` is a disguised goto.

**Recommendation:** refactor into explicit functions called in order.

```typescript
sectionA();
sectionB();
sectionC();
```

### Discrepancy to track
If a `PERFORM THRU` skipped intermediate sections via `GO TO`, the refactor can
change behavior. **Flag it in the discrepancy registry.**

## 5. PERFORM TIMES (fixed repetition)

### Source (COBOL)
```cobol
PERFORM 5 TIMES
    DISPLAY "Hello"
END-PERFORM.
```

### Target (TypeScript)
```typescript
for (let _i = 0; _i < 5; _i++) {
    console.log("Hello");
}
```

## Known edge cases

- **Negative step:** `PERFORM VARYING I FROM 10 BY -1 UNTIL I < 1` → `for (let i = 10; i >= 1; i--)`
- **Composite condition:** `UNTIL (A > 100) AND (B = 'Y')` → `while (!(a > 100 && b === 'Y'))`
- **Mutating the control variable inside the loop:** common in COBOL, an anti-pattern in TS — refactor into an explicit `while`.

## Parity test

[`tools/parity-tester/tests/perform-loops.test.ts`](../../tools/parity-tester/tests/perform-loops.test.ts) — runnable, asserts the loop output against golden values.

## Contributors
- Access International team (init)
