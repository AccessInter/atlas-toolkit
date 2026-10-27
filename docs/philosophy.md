**Languages:** [Français](philosophy.fr.md) · **English**

# ATLAS Toolkit philosophy

## The problem

Thousands of organizations (banks, insurance, public sector, industry, telecoms) run COBOL, Delphi and BizTalk applications that have been in production for 20 to 40 years. They work, they run the business, but:

- The developers who maintain them are retiring
- The documentation is incomplete or lost
- The business rules are buried in the code
- Modernizing is expensive and risky

**Result**: every modernization program reinvents everything. No shared patterns, no common tooling, no catalog of the traps others have already hit.

## Our conviction

**Legacy modernization is an engineering discipline, not an adventure.** The patterns exist and they repeat. The mistakes are often the same. So are the checks.

At Access International, we have been modernizing COBOL and Delphi since 1999. ATLAS, our methodology, starts from what actually runs in production: when the source code is incomplete or doubtful, it reads the compiled program directly, recovers the calculation rules and checks that they match the source supplied.

We decided to open up **the reusable building blocks** — patterns, parity tooling, example scaffolds — under the MIT License.

## What we open

- ✅ Translation patterns (source → target) with tests
- ✅ Comparison tooling (parity-tester)
- ✅ Public examples (AWS samples, open datasets)
- ✅ Example scaffolds
- ✅ Vocabulary and references

## What we keep closed

- ❌ The detailed ATLAS steps and guiding principles (the complete methodology)
- ❌ Our lessons-learned record from client engagements
- ❌ Our clients' code (confidentiality)
- ❌ The discrepancy-registry templates (proprietary format)

**Why this boundary**: the value of ATLAS is not in the technical patterns (they exist elsewhere). It lies in how the method is put together and in operational discipline. We share the building blocks; the method is what we sell.

## What we hope for from the community

### What helps

- Reporting bugs in the patterns
- Proposing new patterns (especially Delphi, BizTalk, PowerBuilder — poorly documented stacks)
- Porting an example to another target stack (Java, Python, Go, Rust)
- Translating the patterns EN ↔ FR

### What is not the right door

- Free help on your commercial migration program — contact us at [access-international.dev/en/contact](https://access-international.dev/en/contact/)
- General COBOL documentation (see the IBM docs, Wikipedia)
- Programming courses (see freeCodeCamp, Codecademy)

## Inspirations

- Martin Fowler's [Strangler Fig pattern](https://martinfowler.com/bliki/StranglerFigApplication.html)
- The [Kubernetes community model](https://github.com/kubernetes/community) for open-source organization
- [OpenJDK](https://openjdk.org) for the technical tone
- [Refactoring Guru](https://refactoring.guru) for the teaching approach

## Governance

ATLAS Toolkit is maintained by Access International. Editorial decisions (which contributions are accepted, which patterns are included) are made by the Access team. The MIT License guarantees free use; the [`examples/card-demo-cobol`](../examples/card-demo-cobol) folder, derived from AWS CardDemo, stays under Apache-2.0.

If the project grows, a steering committee including external contributors will be created (after 10+ active contributors).

## Contact

- Website: [access-international.dev](https://access-international.dev)
- Contact form: [access-international.dev/en/contact](https://access-international.dev/en/contact/)
- Issues: [github.com/AccessInter/atlas-toolkit/issues](https://github.com/AccessInter/atlas-toolkit/issues)
