// src/domain/transactionList.ts
// TypeScript port of COBOL program COTRN00C - "TRANSACTION LIST".
//
// Paginated browse, 10 rows/page, navigation PF7 (previous page) / PF8 (next page).
// Source: COBOL/CICS/VSAM (TRANSACT file, KSDS keyed on TRAN-ID X(16)).
// Target: Cloudflare Workers + D1 (SQLite). Keyset pagination (D-06) that emulates
// the VSAM STARTBR / READNEXT / READPREV cursor.
//
// Business rules are annotated with their TRAN-LIST-xx ID; decisions with D-xx;
// COBOL pitfalls that are reproduced/fixed are annotated // PARITY:.

import type { Env, TransactionRow } from '../lib/db';
import { all } from '../lib/db';
import { formatMoney } from '../lib/zoned';

// TRAN-LIST-01: at most 10 transactions displayed per page (OCCURS 10 TIMES).
const PAGE_SIZE = 10;

// TRAN-LIST-12: one more row (the 11th) than the 10 displayed is read.
// This sentinel row is used ONLY to know whether one more page exists in the
// direction being browsed; it is never displayed.
// PARITY: reproduces the COBOL 11th "sentinel" READNEXT (then ENDBR), whose
//         only effect is to set CDEMO-CT00-NEXT-PAGE-FLG.
const FETCH_SIZE = PAGE_SIZE + 1;

export interface TxListPage {
  /** RAW rows of the page, always in ascending tran_id order (KSDS order). */
  rows: TransactionRow[];
  /** Current page number (TRAN-LIST-13/14). See the note on page tracking below. */
  page: number;
  /** PF8/F8 active (TRAN-LIST-10): a next page really exists. */
  hasNext: boolean;
  /** PF7/F7 active (TRAN-LIST-09): a previous page really exists. */
  hasPrev: boolean;
  /** TRAN-LIST-17: key of the first displayed row = CDEMO-CT00-TRNID-FIRST (PF7 bound). */
  firstKey?: string;
  /** TRAN-LIST-17: key of the last displayed row = CDEMO-CT00-TRNID-LAST (PF8 bound). */
  lastKey?: string;
}

/**
 * Paginated transaction list, faithful to COTRN00C.
 *
 * @param env  Injected D1 access (env as first argument, no global state).
 * @param opts.startKey  Reference key for keyset pagination.
 *   - direction 'forward'  : browse from startKey INCLUSIVE (>=), reproducing
 *     the default GTEQ positioning of the CICS STARTBR (TRAN-LIST-04; GTEQ is
 *     commented out in the source but GTEQ is the IBM default).
 *     Empty / undefined startKey = start of file (LOW-VALUES -> '').
 *   - direction 'backward' : startKey = CDEMO-CT00-TRNID-FIRST of the page being
 *     left; browse STRICTLY below it (tran_id < startKey).
 * @param opts.direction  'forward' (PF8, default) or 'backward' (PF7).
 */
export async function listTransactions(
  env: Env,
  opts: { startKey?: string; direction?: 'forward' | 'backward' },
): Promise<TxListPage> {
  // No LOW-VALUES in TS. A missing or empty key = start of file.
  const startKey: string = opts.startKey ?? '';
  const direction: 'forward' | 'backward' = opts.direction ?? 'forward';

  if (direction === 'backward') {
    return pageBackward(env, startKey);
  }
  return pageForward(env, startKey);
}

/**
 * PROCESS-PAGE-FORWARD (PF8 / first display).
 * COBOL: STARTBR RIDFLD(WS-TRAN-ID-FIRST) GTEQ, then READNEXT up to 10,
 *        then 11th sentinel READNEXT.
 * SQL: WHERE tran_id >= :startKey ORDER BY tran_id ASC LIMIT 11.
 */
async function pageForward(env: Env, startKey: string): Promise<TxListPage> {
  // Ascending tran_id order = native VSAM KSDS order (READNEXT).
  // GTEQ (>=) faithfully reproduces RIDFLD ... GTEQ: the start key is included.
  // D-06: parameterised query (injection-safe), no VSAM cursor.
  // The full TRANSACT record is fetched (TransactionRow = CVTRA05Y): the real
  // columns are tran_id / description / amount / orig_ts (see lib/db.ts),
  // NOT tran_desc/tran_amt/tran_date. The screen mapping (date from orig_ts,
  // description truncation, amount format) is done in the presentation layer.
  const fetched = await all<TransactionRow>(
    env.DB,
    'SELECT * FROM transactions WHERE tran_id >= ? ORDER BY tran_id ASC LIMIT ?',
    startKey,
    FETCH_SIZE,
  );

  // TRAN-LIST-12: the 11th row is the "next page exists" sentinel
  // (NEXT-PAGE-YES). PARITY: if exactly 10 records remain,
  // fetched.length === 10 => hasNext = false (NEXT-PAGE-NO).
  const hasNext = fetched.length > PAGE_SIZE;
  const rows = fetched.slice(0, PAGE_SIZE); // sentinel removed, never displayed.

  // TRAN-LIST-09: a previous page exists as soon as we are not at the very
  // start of the file. startKey === '' = first page (LOW-VALUES) -> PF7 inactive
  // (COBOL guard CDEMO-CT00-PAGE-NUM > 1).
  const hasPrev = startKey !== '' && rows.length > 0;

  return finalize(rows, hasNext, hasPrev);
}

/**
 * PROCESS-PAGE-BACKWARD (PF7).
 * COBOL: STARTBR then READPREV, filling the screen from index 10 down to 1
 *        (WS-IDX decreasing) to PRESERVE ascending order on display.
 * SQL: WHERE tran_id < :startKey ORDER BY tran_id DESC LIMIT 11, then re-reverse.
 */
async function pageBackward(env: Env, startKey: string): Promise<TxListPage> {
  // TRAN-LIST-23: read in DESC order (equiv. READPREV) starting from the key of
  // the first row of the current page (CDEMO-CT00-TRNID-FIRST), STRICTLY below
  // it (tran_id < startKey). The '<' (not '<=') reproduces the "skip" of the
  // repositioning row consumed before the READPREV loop, avoiding
  // redisplaying the pivot row.
  const fetched = await all<TransactionRow>(
    env.DB,
    'SELECT * FROM transactions WHERE tran_id < ? ORDER BY tran_id DESC LIMIT ?',
    startKey,
    FETCH_SIZE,
  );

  // TRAN-LIST-12 / TRAN-LIST-21 : "previous page exists" sentinel (11th READPREV).
  const hasPrev = fetched.length > PAGE_SIZE;

  // Keep at most 10 rows (the closest to startKey, i.e. the largest keys below
  // startKey, since the order is DESC); the sentinel (11th, smallest) is dropped.
  const desc = fetched.slice(0, PAGE_SIZE);

  // TRAN-LIST-23: RE-REVERSE to restore ascending order on display.
  // PARITY: equivalent to the COBOL fill of WS-IDX 10->1 (backward loop),
  //         which ends with a screen sorted by ascending key (oldest
  //         transaction on row 1), identical to forward.
  const rows = desc.slice().reverse();

  // TRAN-LIST-10: coming from a backward page, a next page always exists
  // (the one we came from), except in the degenerate empty-page case.
  const hasNext = rows.length > 0;

  return finalize(rows, hasNext, hasPrev);
}

/**
 * Computes firstKey / lastKey (TRAN-LIST-17 = CDEMO-CT00-TRNID-FIRST / -LAST)
 * from the displayed rows, ascending order guaranteed.
 *
 * Note (page number, TRAN-LIST-13/14): CDEMO-CT00-PAGE-NUM is a screen-state
 * counter incremented (forward, if >=1 row read) / decremented with a floor
 * of 1 (backward) by F8/F7 on the CICS side. Keyset pagination is STATELESS: the
 * absolute page number cannot be rebuilt from a single keyset query
 * without a global COUNT. So page = 1 is exposed as a neutral value;
 * the real page-number tracking (increment/decrement) belongs to the
 * route/screen layer that holds the navigation state (no global state in
 * the domain). firstKey/lastKey are enough to chain pages.
 */
function finalize(rows: TransactionRow[], hasNext: boolean, hasPrev: boolean): TxListPage {
  const firstKey = rows.length > 0 ? rows[0]!.tran_id : undefined;
  const lastKey = rows.length > 0 ? rows[rows.length - 1]!.tran_id : undefined;

  const result: TxListPage = {
    rows,
    page: 1,
    hasNext,
    hasPrev,
  };
  // Optional fields: only added when defined (strict TS,
  // exactOptionalPropertyTypes-friendly).
  if (firstKey !== undefined) {
    result.firstKey = firstKey;
  }
  if (lastKey !== undefined) {
    result.lastKey = lastKey;
  }
  return result;
}

// ---------------------------------------------------------------------------
// PRESENTATION helpers (COTRN0A screen layer). Provided here to document the
// original truncations/formats; they NEVER alter rows (raw data). The route
// layer applies them when rendering HTML.
// ---------------------------------------------------------------------------

// TRAN-LIST-24: source TRAN-DESC X(100) truncated to X(26) on display
// (screen field TDESCnnI PIC X(26)). SILENT truncation, NO ellipsis.
// The real field on TransactionRow is called `description` (see lib/db.ts), not
// `tran_desc`; the truncation applies to its value.
// PARITY: cut hard at 26 characters, exactly like the COBOL MOVE of an X(100)
//         into an X(26) (visual data loss, no "..."). Source display bug
//         reproduced.
const SCRN_DESC_LEN = 26;

/** Truncates the description (`description` field) to the 3270 screen width X(26). */
export function truncateDesc(description: string): string {
  return description.slice(0, SCRN_DESC_LEN);
}

/**
 * Amount formatting for the screen.
 * The real amount on TransactionRow is `amount`, a signed INTEGER of cents
 * (never a float); formatting goes through formatMoney (lib/zoned.ts).
 * PARITY: no float computation - formatMoney throws if given a non-integer.
 */
export function formatTxAmount(amountCents: number): string {
  return formatMoney(amountCents);
}

/**
 * TRAN-LIST-15: the displayed date is the ORIGIN DATE of the transaction,
 * reformatted MM/DD/YY. The COBOL splits TRAN-ORIG-TS (X(26),
 * "YYYY-MM-DD-HH.MM.SS.mmmmmm") via WS-TIMESTAMP then recomposes MM/DD/YY.
 * The real field on TransactionRow is `orig_ts` (not `tran_date`).
 * PARITY: YYYY-MM-DD is extracted positionally from the first 10 characters and
 *         reordered to MM/DD/YY (last 2 digits of the year), like the COBOL
 *         sub-field MOVE - no calendar parsing (no validation/normalisation:
 *         a malformed timestamp comes out as is, reproducing the mainframe
 *         "byte copy" behaviour).
 */
export function formatTxDate(origTs: string): string {
  // Fixed positions: 0-3 year, 5-6 month, 8-9 day ('-' separators at 4 and 7).
  const yy = origTs.slice(2, 4);
  const mm = origTs.slice(5, 7);
  const dd = origTs.slice(8, 10);
  return `${mm}/${dd}/${yy}`;
}

// TRAN-LIST-06 / TRAN-LIST-07: the 'S'/'s' selection (WS-SCRN-SEL) that routes to
// COTRN01C (transaction detail) is OUT OF SCOPE for this list module; it is handled
// by the route/navigation layer. No selection logic here.
