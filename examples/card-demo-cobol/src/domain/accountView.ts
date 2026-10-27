/**
 * COACTVWC — Account View (CICS transaction `CAVW`).
 *
 * PURELY READ-ONLY program (no writes). Its core is a chain of
 * THREE guarded sequential VSAM reads:
 *
 *   Step 1 — CROSS-REFERENCE (CXACAIX)  key = account no.  -> customer no. + card no.
 *   Step 2 — ACCOUNT MASTER  (ACCTDAT)  key = account no.  -> account data
 *   Step 3 — CUSTOMER MASTER (CUSTDAT)  key = customer no. (from step 1) -> customer data
 *
 * Each step gates the next: if a read fails (NOTFND), the chain stops and a
 * specific message identifies the failing step.
 *
 * Design decisions applied:
 *   - D-01: `S9(10)V99` signed zoned amounts are kept in CENTS (integers),
 *           as stored in the database (AccountRow.*_bal/limit = INTEGER cents).
 *           This module performs NO float calculation or conversion.
 *
 * Parity mapping:
 *   - VSAM READ by key -> SELECT ... WHERE pk = ? (helper get -> null on NOTFND).
 *   - VSAM keys = zero-padded numeric strings (pitfall):
 *     account = 11 characters, customer = 9 characters. NEVER a bare integer (padding lost).
 *
 * This module exposes ONLY the read-chain logic (pure function from a business-logic
 * standpoint). Screen formatting (SSN NNN-NN-NNNN = ACCT-VIEW-17, prompt =
 * ACCT-VIEW-18) and navigation (keys = ACCT-VIEW-19, F3 = ACCT-VIEW-20)
 * belong to the handler/presentation, outside the scope of getAccount.
 */

import type { Env, AccountRow, CustomerRow, CardXrefRow } from '../lib/db';
import { get } from '../lib/db';

/**
 * Result of the lookup chain.
 * - ok=true  : the full chain succeeded (xref + account + customer found).
 * - ok=false : stopped at a step; `error` carries the equivalent COBOL message and
 *              `notFound` identifies the failing step ('account' = validation/xref by
 *              account, 'customer' = customer missing, 'xref' = account missing from the xref).
 *
 * NB on the partial case (ACCT-VIEW-16, edge case): if the xref and
 * the account are found but the customer is missing (broken referential integrity),
 * `account` and `xref` are set while ok=false + notFound='customer'.
 * This reproduces the COBOL partial display (account fields shown via FOUND-ACCT,
 * customer fields hidden).
 */
export interface AccountViewResult {
  ok: boolean;
  account?: AccountRow;
  customer?: CustomerRow;
  xref?: CardXrefRow;
  error?: string;
  notFound?: 'account' | 'customer' | 'xref';
}

/**
 * Validates the entered account number, then runs the xref -> account -> customer chain.
 *
 * @param env    Worker bindings (env.DB = D1)
 * @param acctId account number as entered (validation reproduces 2210-EDIT-ACCOUNT)
 */
export async function getAccount(env: Env, acctId: string): Promise<AccountViewResult> {
  // ----------------------------------------------------------------------------
  // 2210-EDIT-ACCOUNT — Input validation (COACTVWC l.649-685)
  // ----------------------------------------------------------------------------

  // ACCT-VIEW-01 (COACTVWC:628-633) — Cleaned input: '*' or spaces = empty field.
  // In COBOL, ACCTSIDI = '*' OR spaces -> CC-ACCT-ID := LOW-VALUES. So an input made
  // only of spaces or asterisks is normalized to an empty string.
  const raw = acctId ?? '';
  const cleaned = raw.trim() === '' || /^\*+$/.test(raw.trim()) ? '' : raw.trim();

  // ACCT-VIEW-02 (COACTVWC:653-661) — Account number not provided -> error, immediate exit.
  // (FLG-ACCTFILTER-BLANK + "Account number not provided" + CDEMO-ACCT-ID := 0.)
  if (cleaned === '') {
    return {
      ok: false,
      error: 'Account number not provided',
      notFound: 'account',
    };
  }

  // ACCT-VIEW-03 (COACTVWC:666-676) — Invalid account number: non-numeric OR equal to zero
  // -> "Account Filter must be a non-zero 11 digit number".
  // PARITY: we test "all digits" and "non-zero" as the COBOL does (CC-ACCT-ID NOT
  // NUMERIC OR = ZEROS). The COBOL does not enforce an exact length of 11 here (the
  // PIC 9(11) field guarantees it on the 3270 side); so we do NOT add a length check.
  const isNumeric = /^[0-9]+$/.test(cleaned);
  const isZero = isNumeric && Number.parseInt(cleaned, 10) === 0;
  if (!isNumeric || isZero) {
    return {
      ok: false,
      error: 'Account Filter must be a non-zero 11 digit number',
      notFound: 'account',
    };
  }

  // ACCT-VIEW-04 (COACTVWC:677-680) — Valid account number -> copied for the rest of the flow.
  // RG-07 / Step 0 (COACTVWC:691): the account key feeds the chain. Pitfall:
  // the VSAM key is an 11-character numeric string, LEFT zero-padded, not a bare
  // integer (otherwise padding is lost at READ). So we rebuild the canonical key.
  const acctKey = cleaned.padStart(11, '0');

  // ----------------------------------------------------------------------------
  // 9000-READ-ACCT — Read-chain orchestrator (COACTVWC l.687-722)
  // ----------------------------------------------------------------------------

  // === Step 1 — 9200-GETCARDXREF-BYACCT (COACTVWC l.723-773) ===
  // ACCT-VIEW-05 (COACTVWC:727-740) — Cross-ref read by account number.
  // PARITY: the loaded record is CARD-XREF-RECORD (card_num, cust_id, acct_id);
  // we fetch cust_id (-> step 3 key) and card_num. (the source is AMBIGUOUS on the
  // exact semantics of the AIX path: no impact on the logic, key = account no.)
  const xref = await get<CardXrefRow>(
    env.DB,
    'SELECT card_num, cust_id, acct_id FROM card_xref WHERE acct_id = ?',
    acctKey,
  );

  // ACCT-VIEW-09 (COACTVWC:741-758) — Cross-ref not found (NOTFND):
  // INPUT-ERROR + FLG-ACCTFILTER-NOT-OK + "Account:<id> not found in Cross ref file".
  // RG-09 guard after step 1 (COACTVWC:697-699): account missing from the xref => we do NOT
  // chain the ACCTDAT read. Immediate exit from 9000.
  if (xref === null) {
    return {
      ok: false,
      error: `Account:${acctKey} not found in Cross ref file`,
      notFound: 'xref',
    };
  }

  // RG-08 (COACTVWC:738-740): XREF-CUST-ID -> CDEMO-CUST-ID (step 3 key).
  // Pitfall: customer key = 9-character zero-padded numeric string.
  const custKey = (xref.cust_id ?? '').padStart(9, '0');

  // === Step 2 — 9300-GETACCTDATA-BYACCT (COACTVWC l.774-823) ===
  // ACCT-VIEW-07 (COACTVWC:776-788) — Account master read with the SAME account-number key.
  // Success -> FOUND-ACCT-IN-MASTER. Amounts kept in cents (D-01, see AccountRow).
  const account = await get<AccountRow>(
    env.DB,
    'SELECT acct_id, active_status, curr_bal, credit_limit, cash_credit_limit, ' +
      'open_date, expiration_date, reissue_date, curr_cyc_credit, curr_cyc_debit, ' +
      'addr_zip, group_id FROM accounts WHERE acct_id = ?',
    acctKey,
  );

  // ACCT-VIEW-11 (COACTVWC:789-807) — Account master not found (NOTFND):
  // "Account:<id> not found in Acct Master file".
  //
  // PARITY: the apparent guard RG-11 (COACTVWC:704-706) tests the 88-level
  // DID-NOT-FIND-ACCT-IN-ACCTDAT whose SET is COMMENTED OUT (l.792) -> the guard is INOPERATIVE
  // in the source code. The flow is actually stopped by INPUT-ERROR (set in the
  // NOTFND branch l.790-791, tested upstream in 0000-MAIN l.387).
  // So we reproduce the EFFECTIVE BEHAVIOR (stop on missing account), not the dead
  // guard: we exit here without reading CUSTDAT. (Pitfall.)
  if (account === null) {
    // NB: `account` is deliberately OMITTED (not set to undefined) — tsconfig
    // exactOptionalPropertyTypes forbids `account: undefined` on an optional field.
    return {
      ok: false,
      xref,
      error: `Account:${acctKey} not found in Acct Master file`,
      notFound: 'account',
    };
  }

  // === Step 3 — 9400-GETCUSTDATA-BYCUST (COACTVWC l.825-872) ===
  // ACCT-VIEW-08 (COACTVWC:826-838) — Customer master read by customer number (from the xref).
  const customer = await get<CustomerRow>(
    env.DB,
    'SELECT cust_id, first_name, middle_name, last_name, addr_line_1, addr_line_2, ' +
      'addr_line_3, addr_state_cd, addr_country_cd, addr_zip, phone_num_1, phone_num_2, ' +
      'ssn, govt_issued_id, dob, eft_account_id, pri_card_holder, fico_score ' +
      'FROM customers WHERE cust_id = ?',
    custKey,
  );

  // ACCT-VIEW-12 (COACTVWC:839-857) — Customer master not found (NOTFND):
  // INPUT-ERROR + FLG-CUSTFILTER-NOT-OK (not acct-filter) +
  // "CustId:<id> not found in customer master".
  //
  // PARITY: same pitfall as above — the apparent guard RG-13 (COACTVWC:713-715) tests
  // DID-NOT-FIND-CUST-IN-CUSTDAT whose SET is COMMENTED OUT (l.842) -> guard INOPERATIVE.
  // The flow is stopped by INPUT-ERROR. We reproduce the effective behavior.
  //
  // EDGE CASE + ACCT-VIEW-16: account found but customer missing
  // (broken referential integrity) -> PARTIAL display. We return account + xref while marking
  // ok=false / notFound='customer', so the handler shows the account fields
  // (FOUND-ACCT-IN-MASTER true) and hides the customer fields.
  if (customer === null) {
    return {
      ok: false,
      account,
      xref,
      error: `CustId:${custKey} not found in customer master`,
      notFound: 'customer',
    };
  }

  // ----------------------------------------------------------------------------
  // Full chain — FOUND-ACCT-IN-MASTER AND FOUND-CUST-IN-MASTER.
  // Amounts left in CENTS (D-01); no conversion here.
  // ----------------------------------------------------------------------------
  //
  // PARITY — ACCT-VIEW-14 (message-overwrite protection, COACTVWC:744/793/845,
  // RG-19): not modeled explicitly here because the chain returns at the FIRST failure
  // encountered (immediate return at each step). The "first message kept" behavior is
  // therefore structurally guaranteed by the early exits above, with no state variable.
  return {
    ok: true,
    account,
    customer,
    xref,
  };
}
