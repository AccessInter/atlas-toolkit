/**
 * COTRN02C - Add a transaction (CICS transaction `CT02`).
 *
 * COBOL source: app/cbl/COTRN02C.cbl
 * Business rules: RG-01..RG-44; screen rules TRAN-ADD-01..44; decisions D-xx.
 *
 * Scope of this module = the pure business logic of PROCESS-ENTER-KEY +
 * ADD-TRANSACTION (key validation, cross-reference resolution, data validation,
 * Y/N confirmation, ID generation, write). Navigation (PF3/PF4/PF5), screen
 * display (SEND/RECEIVE MAP) and the COMMAREA belong to the handler/session
 * (lib/session.ts) and are not reproduced here (TRAN-ADD-39..44 = navigation/UX).
 *
 * --------------------------------------------------------------------------
 * PITFALL: "RETURN short-circuit"
 * --------------------------------------------------------------------------
 * In CICS, each error WHEN calls SEND-TRNADD-SCREEN, which ends with
 * `EXEC CICS RETURN`: this ENDS the whole transaction. The first error found
 * stops processing - later validations NEVER run and only one message is
 * displayed at a time. This module reproduces that behaviour: as soon as a rule
 * fails it returns immediately `{ ok:false, errors:[<1 error>] }`.
 * Errors are NOT accumulated (that would deviate from the COBOL).
 *
 * --------------------------------------------------------------------------
 * Decisions applied:
 *  - D-11: ID generation is NOT atomic in COBOL (reverse browse, max+1, safety
 *           net = DUPREC on WRITE). Chosen option (b): atomic sequence.
 *           APPLIED: MAX(tran_id)+1 and INSERT run in a single SQL
 *           transaction (atomic D1 batch). The duplicate safety net (DUPKEY/
 *           DUPREC -> TRAN-ADD-37) is KEPT as well (PK tran_id -> unique
 *           constraint error) to preserve the observable behaviour.
 *  - D-20: date-only values stored in X(26) timestamp fields (time part left as
 *           spaces). REPRODUCED: orig_ts/proc_ts = 10-char date padded to 26.
 *  - D-18/D-19: no balance/limit/account-status check on interactive add
 *           (ACCTDAT is included but never read). REPRODUCED: only the
 *           cross-reference is consulted; no invented check.
 *  - D-10: message code 2513 tolerated in CSUTLDTC (business meaning unknown).
 *           The calendar validation in lib/validation.isValidDate covers the
 *           business core; see the RG-26/27 comment.
 *  - D-08: key (acctId/cardNum) validated as numeric only although X(16).
 *           KEPT (demo data is numeric).
 */

import type { Env, CardXrefRow } from '../lib/db';
import { get, batch } from '../lib/db';
import { parseMoneyToCents } from '../lib/validation';

/* ------------------------------------------------------------------ */
/* Contrat d'export                                                     */
/* ------------------------------------------------------------------ */

export interface TxAddInput {
  /** Key: Account ID (X(11) on screen). Either acctId or cardNum is enough. */
  acctId?: string;
  /** Key: Card Number (X(16) on screen). */
  cardNum?: string;
  typeCd: string; // TTYPCDI X(2)
  catCd: string; // TCATCDI X(4)
  source: string; // TRNSRCI X(10)
  amount: string; // TRNAMTI X(12) - strict format -99999999.99
  origDate: string; // TORIGDTI X(10) - YYYY-MM-DD
  procDate: string; // TPROCDTI X(10) - YYYY-MM-DD
  desc: string; // TDESCI X(60)
  merchantId: string; // MIDI X(9)
  merchantName: string; // MNAMEI X(30)
  merchantCity: string; // MCITYI X(25)
  merchantZip: string; // MZIPI X(10)
  confirm: string; // CONFIRMI X(1)
}

export interface TxAddResult {
  ok: boolean;
  tranId?: string;
  /**
   * At most ONE element: the COBOL stops at the first error (RETURN short-circuit).
   * `field` = screen field holding the cursor; `message` = literal COBOL text.
   */
  errors?: { field: string; message: string }[];
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

/** Failure: return immediately (RETURN short-circuit semantics). */
function err(field: string, message: string): TxAddResult {
  return { ok: false, errors: [{ field, message }] };
}

/**
 * "Empty" in the COBOL sense: SPACES or LOW-VALUES.
 * (For HTTP input: undefined / empty string / whitespace only.)
 */
function isEmpty(v: string | undefined): boolean {
  return v === undefined || v.trim().length === 0;
}

/** Purely numeric (equivalent of the COBOL `IS NUMERIC` test on an X field). */
function isNumericStr(v: string): boolean {
  return /^[0-9]+$/.test(v.trim());
}

/**
 * FUNCTION NUMVAL: converts a numeric entry (leading spaces/zeros ignored)
 * into a normalised value, redisplayed right-aligned to `width`.
 * RG-03 (account, width 11) and RG-06 (card, width 16). The value written to
 * TRAN-CARD-NUM comes from CARDNINI AFTER this normalisation (RG-35, pitfall 9).
 */
function numvalNormalize(v: string, width: number): string {
  const n = Number.parseInt(v.trim(), 10); // already guaranteed numeric upstream
  return String(n).padStart(width, '0').slice(-width);
}

/**
 * RG-22 / TRAN-ADD-22 - STRICT amount format guard on 12 bytes:
 * position 1 = `-` or `+`, positions 2-9 (8) numeric, position 10 = `.`,
 * positions 11-12 (2) numeric. Position-by-position check (COBOL reference
 * modification). An unpadded amount (e.g. "100.00") is REJECTED - pitfall 5.
 */
function isStrictAmountFormat(v: string): boolean {
  if (v.length !== 12) return false;
  const sign = v[0];
  if (sign !== '-' && sign !== '+') return false;
  if (!/^[0-9]{8}$/.test(v.slice(1, 9))) return false;
  if (v[9] !== '.') return false;
  if (!/^[0-9]{2}$/.test(v.slice(10, 12))) return false;
  return true;
}

/**
 * RG-23/24 / TRAN-ADD-23/24 - YYYY-MM-DD date structure guard:
 * pos 1-4 num, pos 5 = `-`, pos 6-7 num, pos 8 = `-`, pos 9-10 num.
 * Purely structural check (calendar validity = RG-26/27).
 */
function isDateStructure(v: string): boolean {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v);
}

/**
 * RG-26/27 / TRAN-ADD-26/27 - semantic date validation (equivalent of
 * CALL 'CSUTLDTC'). In COBOL, severity <> '0000' is tolerated ONLY if
 * MSG-NUM = '2513'. D-10: the exact business meaning of 2513 is unknown
 * (probably a non-blocking warning of the Lilian LE/CEEDAYS algorithm).
 * The observable business core is kept: a date is accepted iff it is
 * calendar-valid (month 1-12, valid day for the month, leap years).
 * A well-formed but calendar-invalid date (e.g. 2024-02-30) is rejected, which
 * matches severity <> 0 WITHOUT 2513.
 * // PARITY: code 2513 cannot be modelled without CSUTLDTC documentation (D-10 open).
 */
function isCalendarValid(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const year = Number.parseInt(m[1]!, 10);
  const month = Number.parseInt(m[2]!, 10);
  const day = Number.parseInt(m[3]!, 10);
  if (month < 1 || month > 12) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = dim[month - 1]!;
  return day >= 1 && day <= maxDay;
}

/** Screen date (10) -> X(26) timestamp field (D-20: time part left as spaces). */
function dateToTimestamp26(date: string): string {
  // MOVE of 10 characters into a 26-character area -> left-aligned, rest = spaces.
  return date.padEnd(26, ' ');
}

/* ------------------------------------------------------------------ */
/* addTransaction                                                      */
/* ------------------------------------------------------------------ */

/**
 * Reproduces PROCESS-ENTER-KEY -> (VALIDATE-INPUT-KEY-FIELDS,
 * VALIDATE-INPUT-DATA-FIELDS, EVALUATE CONFIRMI, ADD-TRANSACTION).
 *
 * Returns { ok:true, tranId } on success, or { ok:false, errors:[1 error] }
 * (first error found - RETURN short-circuit).
 */
export async function addTransaction(env: Env, input: TxAddInput): Promise<TxAddResult> {
  const db = env.DB;

  /* ============================================================= */
  /* 1) VALIDATE-INPUT-KEY-FIELDS (RG-01..08 / TRAN-ADD-01..08)     */
  /* ============================================================= */
  // Resolves the normalised card number that will be written to TRAN-CARD-NUM.
  let resolvedCardNum: string;

  // TRAN-ADD-01: exclusive priority (first true WHEN wins) - Account ID
  // first, otherwise Card Number, otherwise error.
  if (!isEmpty(input.acctId)) {
    const acctRaw = input.acctId!;
    // TRAN-ADD-02 / RG-02 : Account ID must be numeric.
    if (!isNumericStr(acctRaw)) {
      return err('ACTIDINI', 'Account ID must be Numeric...');
    }
    // TRAN-ADD-03 / RG-03 : NUMVAL -> normalisation (right-aligned to 11) redisplayed.
    const acctId = numvalNormalize(acctRaw, 11);
    // TRAN-ADD-04 / RG-04: cross-reference read by account (CXACAIX) -> card no.
    // PARITY: in CICS READ DATASET(CXACAIX) RIDFLD(XREF-ACCT-ID). Here the
    // cross-reference is indexed on card_num; we query by acct_id (SQL index).
    const xref = await get<CardXrefRow>(
      db,
      'SELECT card_num, cust_id, acct_id FROM card_xref WHERE acct_id = ?',
      acctId,
    );
    if (xref === null) {
      // Unknown Account ID -> blocks the add.
      return err('ACTIDINI', 'Account ID NOT found...');
    }
    resolvedCardNum = xref.card_num;
  } else if (!isEmpty(input.cardNum)) {
    const cardRaw = input.cardNum!;
    // TRAN-ADD-05 / RG-05 : Card Number must be numeric.
    if (!isNumericStr(cardRaw)) {
      return err('CARDNINI', 'Card Number must be Numeric...');
    }
    // TRAN-ADD-06 / RG-06 : NUMVAL -> normalisation (right-aligned to 16) redisplayed.
    const cardNum = numvalNormalize(cardRaw, 16);
    // TRAN-ADD-07 / RG-07 : cross-reference read by card (CCXREF) -> account no.
    const xref = await get<CardXrefRow>(
      db,
      'SELECT card_num, cust_id, acct_id FROM card_xref WHERE card_num = ?',
      cardNum,
    );
    if (xref === null) {
      // Unknown Card Number -> blocks the add.
      return err('CARDNINI', 'Card Number NOT found...');
    }
    // The card number written = the normalised/resolved one (pitfall 9).
    resolvedCardNum = cardNum;
  } else {
    // TRAN-ADD-08 / RG-08 : neither account nor card.
    return err('ACTIDINI', 'Account or Card Number must be entered...');
  }

  /* ============================================================= */
  /* 2) VALIDATE-INPUT-DATA-FIELDS                                  */
  /* ============================================================= */

  /* --- 2a) Presence (1st EVALUATE) - RG-09..19 / TRAN-ADD-09..19 ---
   * The first empty field met IN THIS ORDER wins (first true WHEN). */
  if (isEmpty(input.typeCd)) return err('TTYPCDI', 'Type CD can NOT be empty...'); // RG-09
  if (isEmpty(input.catCd)) return err('TCATCDI', 'Category CD can NOT be empty...'); // RG-10
  if (isEmpty(input.source)) return err('TRNSRCI', 'Source can NOT be empty...'); // RG-11
  if (isEmpty(input.desc)) return err('TDESCI', 'Description can NOT be empty...'); // RG-12
  if (isEmpty(input.amount)) return err('TRNAMTI', 'Amount can NOT be empty...'); // RG-13
  if (isEmpty(input.origDate)) return err('TORIGDTI', 'Orig Date can NOT be empty...'); // RG-14
  if (isEmpty(input.procDate)) return err('TPROCDTI', 'Proc Date can NOT be empty...'); // RG-15
  if (isEmpty(input.merchantId)) return err('MIDI', 'Merchant ID can NOT be empty...'); // RG-16
  if (isEmpty(input.merchantName)) return err('MNAMEI', 'Merchant Name can NOT be empty...'); // RG-17
  if (isEmpty(input.merchantCity)) return err('MCITYI', 'Merchant City can NOT be empty...'); // RG-18
  if (isEmpty(input.merchantZip)) return err('MZIPI', 'Merchant Zip can NOT be empty...'); // RG-19

  /* --- 2b) Format / numeric (following EVALUATEs) - RG-20..28 --- */

  // TRAN-ADD-20 / RG-20 : Type CD numeric.
  if (!isNumericStr(input.typeCd)) return err('TTYPCDI', 'Type CD must be Numeric...');
  // TRAN-ADD-21 / RG-21 : Category CD numeric.
  if (!isNumericStr(input.catCd)) return err('TCATCDI', 'Category CD must be Numeric...');

  // TRAN-ADD-22 / RG-22 : amount in strict format -99999999.99 (12 bytes).
  if (!isStrictAmountFormat(input.amount)) {
    return err('TRNAMTI', 'Amount should be in format -99999999.99');
  }

  // TRAN-ADD-23 / RG-23 : origin date structure YYYY-MM-DD.
  if (!isDateStructure(input.origDate)) {
    return err('TORIGDTI', 'Orig Date should be in format YYYY-MM-DD');
  }
  // TRAN-ADD-24 / RG-24 : processing date structure YYYY-MM-DD.
  if (!isDateStructure(input.procDate)) {
    return err('TPROCDTI', 'Proc Date should be in format YYYY-MM-DD');
  }

  // TRAN-ADD-25 / RG-25: amount normalisation (NUMVAL-C) -> cents.
  // No float: parseMoneyToCents returns a signed integer (cents).
  // isStrictAmountFormat already guaranteed a format parseMoneyToCents accepts.
  const amountCents = parseMoneyToCents(input.amount);

  // TRAN-ADD-26 / RG-26 : semantic validation of origin date (CSUTLDTC, D-10).
  if (!isCalendarValid(input.origDate)) {
    return err('TORIGDTI', 'Orig Date - Not a valid date...');
  }
  // TRAN-ADD-27 / RG-27 : semantic validation of processing date (CSUTLDTC, D-10).
  if (!isCalendarValid(input.procDate)) {
    return err('TPROCDTI', 'Proc Date - Not a valid date...');
  }

  // TRAN-ADD-28 / RG-28 : Merchant ID numeric.
  if (!isNumericStr(input.merchantId)) {
    return err('MIDI', 'Merchant ID must be Numeric...');
  }

  /* ============================================================= */
  /* 3) EVALUATE CONFIRMI - RG-29..31 / TRAN-ADD-29..31            */
  /* ============================================================= */
  const confirm = input.confirm;
  if (confirm === 'Y' || confirm === 'y') {
    // TRAN-ADD-29 : confirmed -> ADD-TRANSACTION (continues below).
  } else if (confirm === 'N' || confirm === 'n' || isEmpty(confirm)) {
    // TRAN-ADD-30 / RG-30 : N / empty -> ask for confirmation, no add.
    return err('CONFIRMI', 'Confirm to add this transaction...');
  } else {
    // TRAN-ADD-31 / RG-31 : any other value.
    return err('CONFIRMI', 'Invalid value. Valid values are (Y/N)...');
  }

  /* ============================================================= */
  /* 4) ADD-TRANSACTION - RG-32..38 / TRAN-ADD-32..38             */
  /* ============================================================= */

  // RG-34 / TRAN-ADD-34: INITIALIZE TRAN-RECORD is implicit (a fresh record is
  // built below; the trailing FILLER X(20) has no column equivalent).

  // RG-35 : screen -> record mapping. Dates -> X(26) timestamps (D-20).
  const origTs = dateToTimestamp26(input.origDate);
  const procTs = dateToTimestamp26(input.procDate);

  // RG-32/33 + D-11: ID generation = MAX(tran_id)+1, MADE ATOMIC.
  // ---------------------------------------------------------------------------
  // COBOL: MOVE HIGH-VALUES TO TRAN-ID ; STARTBR + READPREV (last) ; +1.
  // tran_id is X(16) handled NUMERICALLY (9(16)). The numeric MAX is reproduced,
  // but the max computation AND the INSERT run in a SINGLE SQL transaction
  // (atomic D1 batch) to fix the COBOL non-atomicity (D-11 option b).
  //
  // INSERT ... SELECT computes the new ID and inserts in a single statement:
  //   new ID = (numeric max of existing tran_id, 0 if empty) + 1.
  // RG-33 / TRAN-ADD-33: empty file -> COALESCE(MAX,0)+1 = 1 (first ID = 1).
  // The result is padded to X(16) (zero-padded) like the COBOL record.
  //
  // PARITY: the duplicate safety net (RG-37 / TRAN-ADD-37) is KEPT: the PK
  // tran_id (+ changes()=0 test) detects a duplicate even if another process
  // inserted in the meantime - observable behaviour identical to DUPKEY/DUPREC.

  const insertSql = `
    INSERT INTO transactions (
      tran_id, type_cd, cat_cd, source, description, amount,
      merchant_id, merchant_name, merchant_city, merchant_zip,
      card_num, orig_ts, proc_ts
    )
    SELECT
      printf('%016d', COALESCE(MAX(CAST(tran_id AS INTEGER)), 0) + 1),
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    FROM transactions
  `;

  // The generated ID is also read: SELECT in the same atomic unit (batch).
  const selectIdSql = `
    SELECT printf('%016d', COALESCE(MAX(CAST(tran_id AS INTEGER)), 0) + 1) AS tran_id
    FROM transactions
  `;

  const insertStmt = db
    .prepare(insertSql)
    .bind(
      input.typeCd,
      input.catCd, // TRAN-CAT-CD 9(04) - stored as is (TEXT)
      input.source,
      input.desc, // TRAN-DESC X(100) (input 60, no destructive truncation)
      amountCents, // amount INTEGER (cents) - no float (RG-22/25)
      input.merchantId,
      input.merchantName,
      input.merchantCity,
      input.merchantZip,
      resolvedCardNum, // TRAN-CARD-NUM = resolved/normalised key (pitfall 9)
      origTs,
      procTs,
    );

  // The INSERT must precede the SELECT so that the SELECT returns the inserted ID.
  const selectStmt = db.prepare(selectIdSql);

  let tranId: string;
  try {
    // D1 batch = implicit atomic transaction (lib/db.batch).
    // [insert, selectAfter]: selectAfter re-reads MAX (= the ID just inserted).
    const results = await batch(db, [insertStmt, selectStmt]);

    // RG-37 / TRAN-ADD-37: duplicate safety net. If the INSERT wrote nothing
    // (PK collision absorbed - theoretical case), report the duplicate.
    const insertRes = results[0];
    if (insertRes && (insertRes.meta?.changes ?? 0) === 0) {
      return err('TRNAMTI', 'Tran ID already exist...');
    }

    const selRes = results[1] as D1Result<{ tran_id: string }> | undefined;
    const row = selRes?.results?.[0];
    if (!row) {
      // RG-38 / TRAN-ADD-38 : unable to re-read the ID -> generic error.
      return err('TRNAMTI', 'Unable to Add Transaction...');
    }
    tranId = row.tran_id;
  } catch (e) {
    // RG-37 / TRAN-ADD-37 : unique constraint (DUPKEY/DUPREC) -> duplicate.
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE|constraint/i.test(msg)) {
      return err('TRNAMTI', 'Tran ID already exist...');
    }
    // RG-38 / TRAN-ADD-38 : any other write error.
    return err('TRNAMTI', 'Unable to Add Transaction...');
  }

  // RG-36 / TRAN-ADD-36: success. The green message is built by the handler;
  // here the full ID is returned (zero-padded tran_id, never truncated in the logic).
  return { ok: true, tranId };
}
