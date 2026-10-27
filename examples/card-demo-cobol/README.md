# card-demo-cobol — AWS CardDemo, COBOL → TypeScript

A working port of part of [AWS CardDemo](https://github.com/aws-samples/aws-mainframe-modernization-carddemo) (a COBOL / CICS / VSAM / JCL credit card sample application) to **TypeScript on Cloudflare Workers + D1**, with executable parity tests.

## Scope

6 of the CardDemo COBOL programs are ported:

| COBOL program | Transaction | What it does | TypeScript module |
|---|---|---|---|
| `COSGN00C` | CC00 | Sign-on | [`src/domain/auth.ts`](src/domain/auth.ts) |
| `COACTVWC` | CAVW | Account view (card xref → account → customer) | [`src/domain/accountView.ts`](src/domain/accountView.ts) |
| `COACTUPC` | CAUP | Account update, with optimistic lock | [`src/domain/accountUpdate.ts`](src/domain/accountUpdate.ts) |
| `COTRN00C` | CT00 | Paginated transaction list (STARTBR / READNEXT) | [`src/domain/transactionList.ts`](src/domain/transactionList.ts) |
| `COTRN02C` | CT02 | Add a transaction | [`src/domain/transactionAdd.ts`](src/domain/transactionAdd.ts) |
| `CBTRN02C` | batch | Daily transaction posting | [`src/batch/postTransactions.ts`](src/batch/postTransactions.ts) |

Shared building blocks live in `src/lib/`: zoned-decimal (overpunch) codec, field validation, session, D1 access. VSAM files map to SQL tables in [`schema.sql`](schema.sql); [`seed.sql`](seed.sql) holds the CardDemo sample data decoded from its ASCII and EBCDIC files.

## Design choices

- **Money is integer cents**, never floating point. `PIC S9(n)V99` fields are decoded to cents and formatted only for display.
- **Parity over modernization**: known behaviours of the COBOL source (including bugs, such as the case-insensitive password check) are reproduced on purpose and documented in the code.
- **No business logic in the HTTP layer**: [`src/index.ts`](src/index.ts) only routes requests to the domain and batch modules.

## Run the tests

Requirements: Node.js 22.13 or later (the tests use the built-in `node:sqlite`) and [pnpm](https://pnpm.io).

```bash
cd examples/card-demo-cobol
pnpm install
pnpm test        # 30 parity tests, offline
pnpm typecheck
```

The tests run the real modules against an in-memory SQLite database loaded with `schema.sql` + `seed.sql`, through a small D1-compatible shim ([`tests/helpers/d1.ts`](tests/helpers/d1.ts)). No mocks, no network.

Test IDs are stable labels: `O-x` are parity cases with expected values derived from the COBOL logic on the sample data (O-11 uses a synthetic input; for example `O-9`: after the daily batch, account 7 ends at balance `900.21`, cycle credit `1287.09`, cycle debit `-579.88`), `INV-x` are invariants checked over all 300 daily transactions, and `D-xx` / `RG-xx` / `AUTH-xx` / `ACCT-UPD-xx` refer to individual business rules.

## Run the demo dashboard (optional)

Local dashboard (no Cloudflare account needed):

```bash
pnpm wrangler d1 execute carddemo-db --local --file=schema.sql
pnpm wrangler d1 execute carddemo-db --local --file=seed.sql
pnpm dev                                      # http://localhost:8787
```

Deploy to your own Cloudflare account:

```bash
pnpm wrangler d1 create carddemo-db           # copy the returned id into wrangler.toml
pnpm wrangler d1 execute carddemo-db --remote --file=schema.sql
pnpm wrangler d1 execute carddemo-db --remote --file=seed.sql
pnpm run deploy
```

The batch endpoint posts the daily transactions only once per database. To replay it locally, delete the `.wrangler/` folder and run the three local commands again.

## Porting to another stack

This example is the reference for ports to other targets (for example Java 21 + Spring Boot 3). A port is considered faithful when it passes the same parity cases and invariants as this TypeScript version.

## License

This example is derived from AWS CardDemo, © Amazon.com, Inc. or its affiliates, licensed under the **Apache License 2.0**: see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). The COBOL programs were ported to TypeScript and modified; the sample data in `seed.sql` was decoded from the original data files.

This folder stays under Apache-2.0. The rest of the atlas-toolkit repository is under the MIT License.
