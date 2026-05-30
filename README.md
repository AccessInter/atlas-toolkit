**Languages:** [Français](README.fr.md) · **English**

# ATLAS Toolkit

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/AccessInter/atlas-toolkit?style=social)](https://github.com/AccessInter/atlas-toolkit)
[![Contributors](https://img.shields.io/github/contributors/AccessInter/atlas-toolkit)](https://github.com/AccessInter/atlas-toolkit/graphs/contributors)

> **Open-source patterns, tools and examples for legacy modernization** — COBOL, Delphi, BizTalk to cloud-native stacks.

Maintained by [Access International](https://access-international.dev), a nearshore IT services firm that has been modernizing legacy code since 1999 for clients across **North America and Europe**, with delivery centers in Tunis. This toolkit captures the repeatable patterns we identified across our migration POCs.

## Why this toolkit

Legacy modernization is a strategic project for thousands of organizations (banks, insurance, public sector, industry). Yet every program reinvents the wheel. There is no shared catalog, few patterns documented in open source, and no common tooling to prove functional parity.

**ATLAS Toolkit opens up our patterns.** Not the entire methodology (which remains proprietary), but the reusable technical building blocks: translation patterns, parity testing, migration scaffolds, discrepancy rules.

## Contents

### `/patterns`

Documented translation patterns, with source → target example plus parity tests.

| Source | Target | Pattern | File |
|---|---|---|---|
| COBOL | TypeScript | PERFORM loops → for / while | [`perform-loops.md`](patterns/cobol/perform-loops.md) |
| COBOL | TypeScript | EVALUATE → switch | [`evaluate-switch.md`](patterns/cobol/evaluate-switch.md) |
| COBOL | TypeScript | PIC S9V99 / COMP-3 → scaled BigInt | [`decimal-arithmetic.md`](patterns/cobol/decimal-arithmetic.md) |
| COBOL | TypeScript | Indexed file I/O → Map | [`indexed-file-io.md`](patterns/cobol/indexed-file-io.md) |
| Delphi | TypeScript | TStringList → Array | Coming soon |
| BizTalk | Azure Logic Apps | XLANG orchestration → workflow.json | Coming soon |

### `/tools`

- [`tools/parity-tester`](tools/parity-tester) — runnable harness that checks each migrated implementation against golden values captured from the legacy behavior (`npm install && npm test` → 23 passing parity tests).

### `/docs`

- [`docs/philosophy.md`](docs/philosophy.md) — why we document these patterns

### Roadmap

Building blocks planned, not yet published — **contributions welcome**:

- **`/tools`** — more CLI tools: `discrepancy-registry` (signable discrepancy registry), `cobol-splitter` (splits a monolithic COBOL program into modules).
- **`/examples`** — complete, working examples, starting with CARDDEMO (IBM sample) migrated COBOL → TypeScript.
- Additional patterns (see the "Coming soon" rows in the table above).

## Quickstart

```bash
# Clone
git clone https://github.com/AccessInter/atlas-toolkit.git
cd atlas-toolkit
```

Start with [`patterns/cobol/perform-loops.md`](patterns/cobol/perform-loops.md) — a first documented pattern (COBOL source → TypeScript target, with a parity test).

## Contributing

Contributions are **welcome and encouraged.** Found a migration pattern that works? A useful tool to compare runs? An educational example?

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the detailed process.

**Good first issues:**
- [Issues labeled `good first issue`](https://github.com/AccessInter/atlas-toolkit/labels/good%20first%20issue)

## Who uses this toolkit

- [Access International](https://access-international.dev) (maintainer)
- *Add your company via PR — we love to know*

## Supported target stacks

- **TypeScript** (Cloudflare Workers, Node.js, Deno)
- **Java 21** (Spring Boot)
- **.NET 8** (ASP.NET Core)
- **Python** (FastAPI, Polars for batch)
- **Azure Logic Apps** (for BizTalk orchestrations)

## Related migration guides

In-depth modernization playbooks on our site — architecture, parity strategy, and target-stack trade-offs for each path:

- [COBOL to Java](https://access-international.dev/en/journeys/cobol-to-java/)
- [COBOL to TypeScript](https://access-international.dev/en/journeys/cobol-to-typescript/)
- [COBOL to .NET Core](https://access-international.dev/en/journeys/cobol-to-dotnet-core/)
- [COBOL to Python](https://access-international.dev/en/journeys/cobol-to-python/)
- [Delphi to .NET Core](https://access-international.dev/en/journeys/delphi-to-dotnet-core/)
- [Delphi to Java](https://access-international.dev/en/journeys/delphi-to-java/)
- [BizTalk to Azure Logic Apps](https://access-international.dev/en/journeys/biztalk-to-azure/)
- [AS/400 modernization](https://access-international.dev/en/journeys/as400-modernisation/)
- [Mainframe to AWS](https://access-international.dev/en/journeys/mainframe-to-aws/)
- [IBM Z mainframe to Azure](https://access-international.dev/en/journeys/mainframe-ibm-to-azure/)

## License

MIT. You can use the patterns and tools in your commercial projects, with no required attribution — but it is appreciated.

## Links

- Website: [access-international.dev](https://access-international.dev)
- Full methodology: [access-international.dev/en/atlas-methodology](https://access-international.dev/en/atlas-methodology)
- Contact: [access-international.dev/en/contact](https://access-international.dev/en/contact)
- Nearshore modernization for North America: [access-international.dev/en/why-tunisia](https://access-international.dev/en/why-tunisia)

---

*"The legacy code that runs banks, insurance companies and public administrations is not a problem to hide — it is a heritage to modernize with method."*
