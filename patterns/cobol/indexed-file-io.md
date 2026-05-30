# COBOL indexed file I/O (VSAM) → Map / key-value store

**Difficulty:** 🟡 Medium
**Version:** 1.0
**Last updated:** 2026-05-30

## Description

COBOL indexed files (VSAM KSDS) provide keyed access: `READ` by primary key,
`WRITE` a new record, `REWRITE` an existing one, and sequential access in
**key collating order** via `START` + `READ NEXT`. The `INVALID KEY` condition
signals a missing key on `READ`/`REWRITE` and a duplicate key on `WRITE`.

The minimal faithful target is a keyed store (`Map`), with `INVALID KEY` mapped
to `null` (on read) or a thrown error (on duplicate/missing write). For real
systems the same contract is implemented over a database table with a unique key.

## Source (COBOL)
```cobol
READ CUSTOMER-FILE
    INVALID KEY MOVE 'Y' TO WS-NOTFOUND
END-READ.

WRITE CUSTOMER-RECORD
    INVALID KEY DISPLAY 'DUPLICATE KEY'
END-WRITE.
```

## Target (TypeScript)
```typescript
class IndexedFile<V> {
    private store = new Map<string, V>();

    write(key: string, rec: V): void {            // INVALID KEY on duplicate
        if (this.store.has(key)) throw new Error(`INVALID KEY: duplicate '${key}'`);
        this.store.set(key, rec);
    }
    read(key: string): V | null {                 // INVALID KEY → null
        return this.store.has(key) ? this.store.get(key)! : null;
    }
    readSequential(): V[] {                        // START + READ NEXT order
        return [...this.store.keys()].sort().map(k => this.store.get(k)!);
    }
}
```

## Rules

- `READ ... INVALID KEY` → return `null`; the caller branches on it (no EOF flag needed).
- `WRITE ... INVALID KEY` (duplicate) → throw.
- `REWRITE ... INVALID KEY` (missing) → throw.
- `START` + `READ NEXT` → iterate keys in **collating sequence** (sort the keys); do not rely on insertion order.
- Alternate indexes → additional `Map`s (or DB indexes) kept in sync on write.

## Known edge cases

- **Collating sequence:** COBOL orders by the native key encoding (often EBCDIC). If the source ran on EBCDIC, a naive ASCII sort can reorder records — **flag in the discrepancy registry** if ordering is business-significant.
- **Fixed-width keys:** COBOL keys are space-padded to a fixed length. Trim or pad consistently so `"C1   "` and `"C1"` do not become two records.
- **Record locking / concurrent access:** the in-memory `Map` has none; a production port must reproduce the file's locking guarantees at the DB layer.

## Parity test

[`tools/parity-tester/tests/indexed-file.test.ts`](../../tools/parity-tester/tests/indexed-file.test.ts) — covers read hit/miss, duplicate write, missing rewrite, and sequential order.

## Contributors
- Access International team (init)
