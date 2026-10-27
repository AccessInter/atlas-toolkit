/**
 * CBTRN02C - Daily Transaction Posting batch.
 *
 * Faithful port of COBOL program CBTRN02C (rules RG-01..RG-23; batch
 * rules BATCH-01..BATCH-23; parity case O-9).
 *
 * Role: read today's transactions SEQUENTIALLY (daily_transactions, file order
 * = ORDER BY rowid_pk), validate each one (XREF card -> ACCTDAT account ->
 * credit limit -> expiration), then:
 *   - if valid: post (UPDATE tran_cat_balance + UPDATE accounts curr_bal/cyc
 *     according to the SIGN of the amount + INSERT transactions);
 *   - if rejected: record the reject (transaction_rejects) with the reason code.
 *
 * FINANCIAL INVARIANTS:
 *   - All amounts are INTEGER CENTS (see lib/zoned.ts). NEVER floats:
 *     integer additions/subtractions only -> exact 2-decimal precision.
 *   - The SIGN of the amount carries the credit/debit direction (RG-18 / BATCH-18).
 *     The debit accumulator sums NEGATIVE values - never "normalise" to positive.
 *
 * DECISIONS applied:
 *   - D-12: the original COBOL has no transactionality, but on the D1 target each
 *     posted record is written in an ATOMIC `batch()` (same observable logic,
 *     without any real partial inconsistency).
 *   - D-13: source bug code 109 (account REWRITE failure never written to rejects)
 *     cannot occur on this target - the account is re-read just before and the
 *     batch is atomic - so 109 is never emitted to rejects.
 *   - D-14: ACCT-ACTIVE-STATUS is never tested at posting -> NO status check
 *     added (parity; adding a test would create rejects absent from the original).
 *   - D-15: TRANSACT (OUTPUT, recreated) -> INSERT into the `transactions` table on the target.
 *   - D-16: PROC-TS in DB2 format `YYYY-MM-DD-HH.MM.SS.mmmm00`.
 *
 * RULE RG-08 / BATCH-08 (major parity point): limit (102) AND expiration
 * (103) are tested WITHOUT early exit -> if both fail, only the LAST
 * reason (103) is kept. Reproduced identically below.
 */

import type {
  Env,
  AccountRow,
  CardXrefRow,
  DailyTransactionRow,
  TranCatBalanceRow,
} from '../lib/db';
import { all, get } from '../lib/db';

/** Reject reason code (RG / BATCH). 109 is never emitted (D-13). */
export interface RejectRecord {
  tranId: string;
  reasonCode: 100 | 101 | 102 | 103 | 109;
}

export interface BatchResult {
  processed: number;
  posted: number;
  rejected: number;
  rejects: RejectRecord[];
  returnCode: number;
}

/* ------------------------------------------------------------------ */
/* Reject reason labels (CBTRN02C)                                   */
/* ------------------------------------------------------------------ */

const REJECT_LABELS: Readonly<Record<100 | 101 | 102 | 103 | 109, string>> = {
  100: 'INVALID CARD NUMBER FOUND', // RG-02 / BATCH-02
  101: 'ACCOUNT RECORD NOT FOUND', // RG-04 / BATCH-04
  102: 'OVERLIMIT TRANSACTION', // RG-06 / BATCH-06
  103: 'TRANSACTION RECEIVED AFTER ACCT EXPIRATION', // RG-07 / BATCH-07
  109: 'ACCOUNT RECORD NOT FOUND', // RG-19 / BATCH-19 (D-13: never written to rejects)
};

/**
 * BATCH-11 / RG-11 / D-16 - Processing timestamp in DB2 format
 * `YYYY-MM-DD-HH.MM.SS.mmmm00` (milliseconds on 2 digits + final '00', see
 * Z-GET-DB2-FORMAT-TIMESTAMP). Not part of the financial invariants
 * (parity case O-9 is independent of the time).
 */
function db2Timestamp(now: Date): string {
  const p2 = (n: number): string => String(n).padStart(2, '0');
  const yyyy = String(now.getUTCFullYear()).padStart(4, '0');
  const mm = p2(now.getUTCMonth() + 1);
  const dd = p2(now.getUTCDate());
  const hh = p2(now.getUTCHours());
  const mi = p2(now.getUTCMinutes());
  const ss = p2(now.getUTCSeconds());
  // DB2-MIL = 2 digits of milliseconds; DB2-REST = '0000'.
  const mil = p2(Math.floor(now.getUTCMilliseconds() / 10));
  return `${yyyy}-${mm}-${dd}-${hh}.${mi}.${ss}.${mil}0000`;
}

/* ------------------------------------------------------------------ */
/* Main posting loop                                                 */
/* ------------------------------------------------------------------ */

/**
 * postDailyBatch - equivalent of the PROCEDURE DIVISION of CBTRN02C
 * (INITIALIZE -> PROCESS loop -> TERMINATE).
 *
 * Reproduces file order (RG: sequential READ DALYTRAN) via ORDER BY rowid_pk.
 * Each transaction is read, validated, then posted OR rejected. RETURN-CODE = 4 if
 * and only if there is at least one reject (RG-23 / BATCH-23 / INV-10).
 */
export async function postDailyBatch(env: Env): Promise<BatchResult> {
  const db = env.DB;

  let processed = 0;
  let posted = 0;
  const rejects: RejectRecord[] = [];

  // RG: SEQUENTIAL read of today's transactions file.
  // File order is insertion order -> ORDER BY rowid_pk (parity case O-9 depends
  // on the order: #n = n-th daily transaction of account 7; #5 is checked against
  // the totals as they stood before the rejected #4, which changed nothing).
  const dailyRows = await all<DailyTransactionRow>(
    db,
    'SELECT * FROM daily_transactions ORDER BY rowid_pk ASC',
  );

  for (const tran of dailyRows) {
    processed += 1; // RG : ADD 1 TO WS-TRANSACTION-COUNT

    // BATCH-01 / RG-01 - reset the reject reason before each transaction.
    // 0 = no reject (sequential chaining of the validations).
    let reasonCode: 0 | 100 | 101 | 102 | 103 = 0;

    /* ---- 1500-VALIDATE-TRAN ---- */

    // BATCH-02 / RG-02 - Card lookup in the cross-reference (key = card_num).
    // Missing -> reject 100 (equivalent of INVALID KEY on XREF).
    const xref = await get<CardXrefRow>(
      db,
      'SELECT * FROM card_xref WHERE card_num = ?',
      tran.card_num,
    );

    let account: AccountRow | null = null;

    if (xref === null) {
      reasonCode = 100;
    } else {
      // BATCH-03 / RG-03 - account lookup only if the card was found.
      // BATCH-04 / RG-04 - Master account lookup by xref.acct_id.
      // Missing -> reject 101.
      account = await get<AccountRow>(
        db,
        'SELECT * FROM accounts WHERE acct_id = ?',
        xref.acct_id,
      );

      if (account === null) {
        reasonCode = 101;
      } else {
        // BATCH-05 / RG-05 - Projected balance (EVERYTHING in integer cents):
        //   WS-TEMP-BAL = ACCT-CURR-CYC-CREDIT - ACCT-CURR-CYC-DEBIT + AMT.
        // NB: curr_cyc_debit is NEGATIVE (RG-18) -> subtracting a negative adds it.
        const wsTempBal =
          account.curr_cyc_credit - account.curr_cyc_debit + tran.amount;

        // BATCH-06 / RG-06 - Limit check: credit_limit >= projected -> OK, otherwise 102.
        // `>=` comparison: EQUALITY is accepted (parity case O-9 point (b)).
        if (account.credit_limit >= wsTempBal) {
          // limit OK - no reject here.
        } else {
          reasonCode = 102;
        }

        // BATCH-07 / RG-07 - Expiration check: expiration_date >= ORIG-TS(1:10)
        // -> OK, otherwise 103. ALPHANUMERIC comparison of the first 10 chars of
        // the origin timestamp (YYYY-MM-DD format: lexicographic order = chronological).
        const origDate = tran.orig_ts.slice(0, 10);
        if (account.expiration_date >= origDate) {
          // expiration OK - no reject here.
        } else {
          // RG-08 / BATCH-08 - LAST REASON WINS: this test has NO early
          // exit; if the limit (102) also failed, 103 OVERWRITES 102.
          // Reproduced identically (parity) - never "optimise" into an
          // early exit, it would change the observed reject code.
          reasonCode = 103;
        }
      }
    }

    /* ---- POST or REJECT (BATCH-09 / RG-09) ---- */

    if (reasonCode === 0 && account !== null && xref !== null) {
      // 2000-POST-TRANSACTION (order RG-21 / BATCH-21).
      await postTransaction(env, tran, account);
      posted += 1;
    } else {
      // 2500-WRITE-REJECT-REC (BATCH-09).
      // The "clean" rejects are 100/101/102/103. Code 109 NEVER occurs
      // here (it belongs to the POST path, where reason=0 on entry) -> D-13.
      const code = (reasonCode === 0 ? 101 : reasonCode) as 100 | 101 | 102 | 103;
      await persistReject(env, tran.tran_id, code);
      rejects.push({ tranId: tran.tran_id, reasonCode: code });
    }
  }

  // TERMINATE.
  const rejected = rejects.length;
  // RG-23 / BATCH-23 / INV-10 - RETURN-CODE = 4 IFF at least one reject, otherwise 0.
  const returnCode = rejected > 0 ? 4 : 0;

  return { processed, posted, rejected, rejects, returnCode };
}

/* ------------------------------------------------------------------ */
/* 2000-POST-TRANSACTION                                               */
/* ------------------------------------------------------------------ */

/**
 * Posts a valid transaction. Order RG-21 / BATCH-21:
 *   (1) UPDATE tran_cat_balance (create or accumulate)
 *   (2) UPDATE accounts (curr_bal + cycle split by sign)
 *   (3) INSERT transactions
 *
 * D-12: the 3 writes are issued in an ATOMIC `db.batch([...])` - same observable
 * logic as the COBOL (same values written), without the real partial
 * inconsistency caused by the original lack of commit/rollback.
 *
 * EVERYTHING in cents (integers): no floating-point operation (RG-15..RG-18).
 */
async function postTransaction(
  env: Env,
  tran: DailyTransactionRow,
  account: AccountRow,
): Promise<void> {
  const db = env.DB;

  // ---- (1) UPDATE tran_cat_balance (RG-12..RG-16 / BATCH-12..BATCH-16) ----
  // Composite key = (acct_id of the resolved account, type_cd, cat_cd of the transaction).
  const tcatbal = await get<TranCatBalanceRow>(
    db,
    'SELECT * FROM tran_cat_balance WHERE acct_id = ? AND type_cd = ? AND cat_cd = ?',
    account.acct_id,
    tran.type_cd,
    tran.cat_cd,
  );

  const statements = [];

  if (tcatbal === null) {
    // BATCH-13 / RG-13 - not found -> CREATE (not a reject).
    // BATCH-15 / RG-15 - record initialised to 0, key set, balance = amount.
    statements.push(
      db
        .prepare(
          'INSERT INTO tran_cat_balance (acct_id, type_cd, cat_cd, balance) VALUES (?, ?, ?, ?)',
        )
        .bind(account.acct_id, tran.type_cd, tran.cat_cd, tran.amount),
    );
  } else {
    // BATCH-16 / RG-16 - existing -> balance += amount (signed), rewrite.
    const newBalance = tcatbal.balance + tran.amount;
    statements.push(
      db
        .prepare(
          'UPDATE tran_cat_balance SET balance = ? WHERE acct_id = ? AND type_cd = ? AND cat_cd = ?',
        )
        .bind(newBalance, account.acct_id, tran.type_cd, tran.cat_cd),
    );
  }

  // ---- (2) UPDATE accounts (RG-17, RG-18 / BATCH-17, BATCH-18) ----
  // RG-17 - current balance: curr_bal += amount (signed; a negative amount reduces it).
  const newCurrBal = account.curr_bal + tran.amount;

  // RG-18 / BATCH-18 - cycle split by SIGN:
  //   amount >= 0 -> curr_cyc_credit += amount (amount = 0 treated as credit);
  //   amount <  0 -> curr_cyc_debit  += amount (DEBIT receives the NEGATIVE value).
  let newCycCredit = account.curr_cyc_credit;
  let newCycDebit = account.curr_cyc_debit;
  if (tran.amount >= 0) {
    newCycCredit = account.curr_cyc_credit + tran.amount;
  } else {
    newCycDebit = account.curr_cyc_debit + tran.amount;
  }

  // RG-19 / BATCH-19 - account rewrite.
  // D-13 / PARITY: source bug 109 reproduced - the COBOL sets reason 109
  // on account REWRITE failure but NEVER writes it to rejects and still writes the
  // transaction. On the target, the account was just re-read and batch() is
  // atomic -> this case CANNOT occur; 109 is therefore never emitted.
  statements.push(
    db
      .prepare(
        'UPDATE accounts SET curr_bal = ?, curr_cyc_credit = ?, curr_cyc_debit = ? WHERE acct_id = ?',
      )
      .bind(newCurrBal, newCycCredit, newCycDebit, account.acct_id),
  );

  // ---- (3) INSERT transactions (RG-10, RG-11, RG-20 / BATCH-10, BATCH-11, BATCH-20) ----
  // D-15 - TRANSACT (OUTPUT recreated in COBOL) -> INSERT into the `transactions` table.
  // RG-10 - field-by-field copy from the daily transaction.
  // RG-11 / D-16 - proc_ts = current DB2 timestamp.
  statements.push(
    db
      .prepare(
        `INSERT INTO transactions
           (tran_id, type_cd, cat_cd, source, description, amount,
            merchant_id, merchant_name, merchant_city, merchant_zip,
            card_num, orig_ts, proc_ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        tran.tran_id,
        tran.type_cd,
        tran.cat_cd,
        tran.source,
        tran.description,
        tran.amount,
        tran.merchant_id,
        tran.merchant_name,
        tran.merchant_city,
        tran.merchant_zip,
        tran.card_num,
        tran.orig_ts,
        db2Timestamp(new Date()),
      ),
  );

  // D-12 - ATOMIC issue of the 3 writes (TCATBAL -> account -> transaction).
  await db.batch(statements);
}

/* ------------------------------------------------------------------ */
/* 2500-WRITE-REJECT-REC                                               */
/* ------------------------------------------------------------------ */

/**
 * Records a reject in transaction_rejects (DALYREJS in COBOL).
 * Code + exact reason label (INV-8: code in {100,101,102,103}).
 */
async function persistReject(
  env: Env,
  tranId: string,
  code: 100 | 101 | 102 | 103,
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO transaction_rejects (tran_id, reject_code, reject_label) VALUES (?, ?, ?)',
  )
    .bind(tranId, code, REJECT_LABELS[code])
    .run();
}
