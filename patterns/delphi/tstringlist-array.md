# Delphi TStringList → TypeScript array / class

**Difficulty:** 🟡 Medium
**Version:** 1.0
**Last updated:** 2026-05-30

## Description

Delphi's `TStringList` is far more than a list of strings: it carries sorting,
duplicate policies, case sensitivity, name=value lookup and delimited
serialization. A naive migration to `string[]` silently drops these behaviors.
The faithful target keeps the behaviors that the original code relied on — often
a small wrapper class, sometimes a `Map` when only `Values[...]` is used.

## Source (Delphi)
```pascal
var SL: TStringList;
begin
  SL := TStringList.Create;
  try
    SL.Sorted := True;
    SL.Duplicates := dupIgnore;
    SL.Add('Banana');
    SL.Add('apple');
    SL.Add('apple');          // ignored: Sorted + dupIgnore
    ShowMessage(SL[0]);       // 'apple'
    ShowMessage(SL.Values['port']);
  finally
    SL.Free;                  // manual lifetime — gone in TS
  end;
end;
```

## Target (TypeScript)
```typescript
const sl = new StringList();
sl.sorted = true;
sl.duplicates = "ignore";
sl.add("Banana");
sl.add("apple");
sl.add("apple");             // ignored
sl.get(0);                   // "apple"
sl.values("port");
// no Free — garbage collected
```

Full implementation: [`tools/parity-tester/src/delphi.ts`](../../tools/parity-tester/src/delphi.ts).

## Rules

- Plain `TStringList` with no options → `string[]`.
- `Sorted := True` → keep the list ordered on insert (binary insert).
- `Duplicates` (`dupIgnore` / `dupError` / `dupAccept`) → only meaningful when sorted; reproduce the chosen policy on `add`.
- `Add` returns the index (Delphi contract) — preserve it.
- `IndexOf` → returns `-1` when absent (not `undefined`).
- `Values['name']` → parse `name=value` entries (or migrate to a `Map<string,string>` if that is the only usage).
- `Free` / `try…finally` → **delete**; lifetime is handled by the GC.

## Known edge cases

- **Case sensitivity:** Delphi compares with `CompareText` (case-insensitive) by default; set it explicitly if the source toggled `CaseSensitive`. A wrong default reorders a sorted list.
- **Duplicates only when sorted:** on an unsorted list, `Duplicates` is ignored in Delphi too — do not "fix" it.
- **`CommaText` / `DelimitedText`:** quoting and delimiter rules differ from `Array.join(',')`; port them explicitly if used.
- **Objects[]** (the paired pointer array) → a parallel structure or a richer record type.

## Parity test

[`tools/parity-tester/tests/delphi-stringlist.test.ts`](../../tools/parity-tester/tests/delphi-stringlist.test.ts) — covers order, sorted insert, both duplicate policies, IndexOf, and Values.

## Contributors
- Access International team (init)
