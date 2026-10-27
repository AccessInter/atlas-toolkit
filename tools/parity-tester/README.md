# parity-tester

A minimal, dependency-free harness that runs the **migrated TypeScript
implementations** of ATLAS patterns against **golden values** captured from the
legacy COBOL behavior. Any divergence fails the run. This is the executable
counterpart to the documents under [`../../patterns`](../../patterns).

## Run

```bash
cd tools/parity-tester
npm install
npm test
```

Expected: all parity tests pass.

## Layout

- `src/cobol.ts` — migrated implementations (the *target* side of each pattern). Decimal math uses scaled `BigInt` (integer minor units), never IEEE-754 floats.
- `tests/*.test.ts` — one parity test per pattern, asserting equivalence with the golden values the legacy program produced.

Each file under [`patterns/`](../../patterns) links to its matching test here.
