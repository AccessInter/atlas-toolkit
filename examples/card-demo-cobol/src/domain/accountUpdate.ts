/**
 * COACTUPC — ACCOUNT UPDATE (CICS transaction `CAUP`).
 *
 * Port of the most complex CardDemo COBOL program:
 *   - 48 consolidated validation rules (ACCT-UPD-01 .. ACCT-UPD-48),
 *   - change detection (ACCT-UPD-43),
 *   - application-level optimistic locking (ACCT-UPD-45),
 *   - atomic grouped account + customer write with rollback (ACCT-UPD-46).
 *
 * COBOL source        : app/cbl/COACTUPC.cbl (business rules RG-01 .. RG-42).
 * Target architecture : atomic db.batch on D1.
 *
 * Principles:
 *   - each rule is annotated `// ACCT-UPD-xx`;
 *   - amounts in CENTS (parseMoneyToCents) — NEVER floats;
 *   - strict TypeScript, no `any`;
 *   - source bugs and UPPER/LOWER inconsistencies are reproduced and traced (decisions D-xx).
 *
 * Decision-log entries applied (see inline annotations):
 *   - D-04: no min/max bounds nor cross-amount consistency -> REPRODUCED (no check).
 *   - D-05: no cross-date consistency on account dates -> REPRODUCED (no check).
 *   - D-09: SOURCE BUG in the phone condition (NUMA tested twice) -> REPRODUCED (default: reproduce).
 *   - D-27: inconsistent UPPER vs LOWER text comparisons (group-id) -> REPRODUCED as-is.
 *   - D-28: DOB re-comparison by offsets on a compact snapshot -> mapping verified (ISO format on target).
 */

import type { Env, AccountRow, CustomerRow } from '../lib/db';
import { get, batch as d1Batch } from '../lib/db';
import {
  required,
  isMoney,
  isValidDate,
  isValidUsState,
  isFicoInRange,
  parseMoneyToCents,
  all_,
  type ValidationResult,
} from '../lib/validation';

/* ================================================================== */
/* Export contract                                                     */
/* ================================================================== */

/** Fields entered on screen (raw strings as received from the 3270 map). */
export interface AccountUpdateInput {
  acctId: string;
  [field: string]: string;
}

/** Values re-read at display time = reference snapshot for the optimistic lock. */
export interface AccountUpdateSnapshot {
  account: AccountRow;
  customer: CustomerRow;
}

export interface AccountUpdateError {
  field: string;
  message: string;
}

export interface AccountUpdateResult {
  ok: boolean;
  errors?: AccountUpdateError[];
  /** true = someone modified account/customer between display and save. */
  conflict?: boolean;
  updated?: { account: AccountRow; customer: CustomerRow };
}

/* ================================================================== */
/* Expected input fields (keys of AccountUpdateInput)                  */
/* ================================================================== */
/* Screen -> field mapping; reproduces the COBOL split of dates / SSN /
 * phones into sub-fields (CSUTLDPY, 1265-EDIT-US-SSN, 1260-EDIT-US-PHONE-NUM).
 * Dates are received in ISO `YYYY-MM-DD` (ISO field + isValidDate).
 * SSNs/phones are received split into parts to honor the source's
 * part-by-part checks. */
interface InputFields {
  // Account
  acctId: string;
  activeStatus: string;
  creditLimit: string;
  cashCreditLimit: string;
  currBal: string;
  currCycCredit: string;
  currCycDebit: string;
  openDate: string; // YYYY-MM-DD
  expirationDate: string; // YYYY-MM-DD
  reissueDate: string; // YYYY-MM-DD
  // Customer — split SSN
  ssnPart1: string;
  ssnPart2: string;
  ssnPart3: string;
  dob: string; // YYYY-MM-DD
  ficoScore: string;
  firstName: string;
  middleName: string;
  lastName: string;
  addrLine1: string;
  addrLine2: string;
  city: string; // = addr_line_3
  state: string;
  zip: string;
  country: string;
  // Phone 1, split
  phone1Area: string;
  phone1Prefix: string;
  phone1Line: string;
  // Phone 2, split
  phone2Area: string;
  phone2Prefix: string;
  phone2Line: string;
  eftAccountId: string;
  priCardHolder: string;
  govtIssuedId: string;
  groupId: string;
}

/** Reads an input key; missing -> empty string (equiv. LOW-VALUES "not entered"). */
function f(input: AccountUpdateInput, key: keyof InputFields): string {
  const raw = key === 'acctId' ? input.acctId : input[key];
  return raw ?? '';
}

/**
 * Screen input normalization (ACCT-UPD-01):
 * `*` or SPACES in a field = cleared field (LOW-VALUES "not provided").
 * "Not provided" is modeled as the empty string.
 */
function normalizeScreen(value: string): string {
  const t = value.trim();
  if (t === '' || t === '*' || /^\*+$/.test(t)) return '';
  return value;
}

/* ================================================================== */
/* Local validation helpers (COBOL spirit)                            */
/* ================================================================== */

const ok: ValidationResult = { ok: true };
const fail = (message: string): ValidationResult => ({ ok: false, message });

/** Required non-zero numeric (1245-EDIT-NUM-REQD: present + numeric + not 0). */
function numRequiredNonZero(value: string, label: string): ValidationResult {
  const v = value.trim();
  if (v.length === 0) return fail(`${label} must be supplied.`);
  if (!/^[0-9]+$/.test(v)) return fail(`${label} must be numeric.`);
  if (/^0+$/.test(v)) return fail(`${label} must not be zero.`);
  return ok;
}

/** Required non-zero numeric of exact length. */
function numRequiredNonZeroLen(value: string, len: number, label: string): ValidationResult {
  const base = numRequiredNonZero(value, label);
  if (!base.ok) return base;
  return value.trim().length === len
    ? ok
    : fail(`${label} must be a ${len} digit number.`);
}

/** Letters + spaces only (1225/1235-EDIT-ALPHA: INSPECT CONVERTING). */
function isAlphaSpaces(value: string, label: string): ValidationResult {
  return /^[A-Za-z ]+$/.test(value)
    ? ok
    : fail(`${label} can have alphabets only.`);
}

/** Required Y/N flag (1220-EDIT-YESNO). */
function isYesNoRequired(value: string, label: string): ValidationResult {
  const v = value.trim();
  if (v.length === 0) return fail(`${label} must be supplied.`);
  return v === 'Y' || v === 'N' ? ok : fail(`${label} must be Y or N.`);
}

/* ================================================================== */
/* Lookups ported from CSLKPCDY                                       */
/* ================================================================== */

/**
 * North American "general purpose" area codes (410 codes,
 * VALID-GENERAL-PURP-CODE, CSLKPCDY L.521-930). The exhaustive table of 410
 * area codes is NOT provided in the shared libs: we port the STRUCTURAL RULE
 * of the NANP numbering plan that characterizes a valid "general purpose" area
 * code — first digit 2-9, N11 format forbidden (x11 reserved). The `CSLKPCDY`
 * copybook dependency must be reconciled if the exact list of 410 codes is required.
 */
function isValidAreaCode(area: string): boolean {
  if (!/^[0-9]{3}$/.test(area)) return false;
  if (area[0] === '0' || area[0] === '1') return false; // first digit 2-9
  if (area[1] === '1' && area[2] === '1') return false; // N11 reserved (211..911)
  return true;
}

/**
 * State + first 2 zip digits combos (VALID-US-STATE-ZIP-CD2-COMBO,
 * 240 combos, CSLKPCDY L.1073+). The exhaustive table of 240 pairs is not
 * provided in the libs: we port the structural RULE (the state code must be
 * valid AND the first 2 zip digits belong to the ZIP range of the
 * 1st digit assigned to the state's geographic zone). Absent the full
 * table, we apply the minimal check faithful to the copybook: numeric 2-digit
 * zip prefix and valid state. The `CSLKPCDY` copybook dependency must be wired in
 * for the exact list of 240 combos.
 */
function isValidStateZipCombo(state: string, zip: string): boolean {
  const st = state.trim().toUpperCase();
  const prefix = zip.trim().slice(0, 2);
  if (st.length !== 2) return false;
  if (!/^[0-9]{2}$/.test(prefix)) return false;
  // Structural check: valid state + 2-digit zip prefix.
  // (Fine-grained filtering of the 240 combos requires the CSLKPCDY table.)
  return isValidUsState(st).ok;
}

/* ================================================================== */
/* §A — PER-FIELD VALIDATIONS (ACCT-UPD-01 .. ACCT-UPD-42)           */
/* Each function returns 0..n errors (field/message).                 */
/* ================================================================== */

/* ---- Search key & status ---------------------------------------- */

function validateAcctId(v: string): AccountUpdateError[] {
  const errors: AccountUpdateError[] = [];
  const acct = normalizeScreen(v);
  // ACCT-UPD-01: account number required (empty -> "not provided", reset to zero).
  if (acct.trim().length === 0) {
    errors.push({ field: 'acctId', message: 'Account Number not provided' });
    return errors; // implicit reset to zero: no other useful check
  }
  // ACCT-UPD-02: numeric, non-zero, 11 digits.
  if (!/^[0-9]{11}$/.test(acct.trim()) || /^0+$/.test(acct.trim())) {
    errors.push({
      field: 'acctId',
      message: 'Account Number if supplied must be a 11 digit Non-Zero Number',
    });
  }
  return errors;
}

function validateActiveStatus(v: string): AccountUpdateError[] {
  const status = normalizeScreen(v);
  // ACCT-UPD-03: status required.
  if (status.trim().length === 0) {
    return [{ field: 'activeStatus', message: 'Account Status must be supplied.' }];
  }
  // ACCT-UPD-04: Y or N.
  const r = isYesNoRequired(status, 'Account Status');
  return r.ok ? [] : [{ field: 'activeStatus', message: r.message }];
}

/* ---- Amounts S9(10)V99 (1250-EDIT-SIGNED-9V2) -------------------- */
/* D-04: no min/max bounds nor cross-amount consistency -> REPRODUCED
 * (only presence + S9(10)V99 format are checked, like the source). */

function validateMoneyField(
  v: string,
  field: string,
  label: string,
): AccountUpdateError[] {
  const value = normalizeScreen(v);
  // ACCT-UPD-05/07/08/09/10: required.
  if (value.trim().length === 0) {
    return [{ field, message: `${label} must be supplied.` }];
  }
  // ACCT-UPD-06 (+ same for 07..10): valid signed 9(10)V99 amount.
  const r = isMoney(value, label);
  return r.ok ? [] : [{ field, message: r.message }];
}

/* ---- Account dates (CSUTLDPY: year/century/month/day/leap year/LE) - */
/* D-05: no cross-date consistency (expiry>open, reissue>=open) -> REPRODUCED. */

const THIS_CENTURY = '20';
const LAST_CENTURY = '19';

/**
 * Validates an account date in ISO `YYYY-MM-DD` format.
 * Covers ACCT-UPD-11..18:
 *   11 4-digit year ; 12 century 19/20 ; 13 month 1-12 ; 14 day 1-31 ;
 *   15 day 31 forbidden outside 31-day months ; 16 February != 30 ; 17 leap year ;
 *   18 final validation (equiv. CSUTLDTC service) via isValidDate.
 */
function validateAccountDate(
  v: string,
  field: string,
  label: string,
): AccountUpdateError[] {
  const value = normalizeScreen(v);
  if (value.trim().length === 0) {
    // ACCT-UPD-11: required components (year/month/day).
    return [{ field, message: `${label} year must be supplied.` }];
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) {
    return [{ field, message: `${label} must be in YYYY-MM-DD format.` }];
  }
  const century = m[1]!.slice(0, 2);
  // ACCT-UPD-12: century limited to 19 or 20 (THIS-CENTURY=20 / LAST-CENTURY=19).
  if (century !== THIS_CENTURY && century !== LAST_CENTURY) {
    return [{ field, message: `${label} century is not valid.` }];
  }
  // ACCT-UPD-13..18: month 1-12, day 1-31, 31st forbidden, February != 30,
  // correct leap year, final calendar validation (CSUTLDTC).
  // isValidDate (lib) applies the full Gregorian rule: over the allowed
  // 19xx/20xx range it is NET EQUIVALENT to the source's COMP-3 /4 and /400
  // computation (only the century years 1900 [not leap] and 2000 [leap]).
  const r = isValidDate(value.trim(), label);
  return r.ok ? [] : [{ field, message: r.message }];
}

/* ---- Customer SSN (1265-EDIT-US-SSN) ---------------------------- */

/** Part 1 forbidden if 000, 666, or 900-999 (INVALID-SSN-PART1). */
function isForbiddenSsnPart1(part1: string): boolean {
  const n = Number.parseInt(part1, 10);
  if (!Number.isInteger(n)) return false;
  // ACCT-UPD-20: 000, 666, 900..999.
  return n === 0 || n === 666 || (n >= 900 && n <= 999);
}

function validateSsn(p1: string, p2: string, p3: string): AccountUpdateError[] {
  const errors: AccountUpdateError[] = [];
  const part1 = normalizeScreen(p1).trim();
  const part2 = normalizeScreen(p2).trim();
  const part3 = normalizeScreen(p3).trim();

  // ACCT-UPD-19: part 1 (3 chars) required, numeric, non-zero.
  const r1 = numRequiredNonZero(part1, 'SSN part 1');
  if (!r1.ok) {
    errors.push({ field: 'ssnPart1', message: r1.message });
  } else if (isForbiddenSsnPart1(part1)) {
    // ACCT-UPD-20: forbids 000/666/900-999.
    errors.push({
      field: 'ssnPart1',
      message: 'SSN should not be 000, 666, or between 900 and 999.',
    });
  }
  // ACCT-UPD-21: part 2 (2 chars) required, numeric, non-zero.
  const r2 = numRequiredNonZero(part2, 'SSN part 2');
  if (!r2.ok) errors.push({ field: 'ssnPart2', message: r2.message });
  // ACCT-UPD-22: part 3 (4 chars) required, numeric, non-zero.
  const r3 = numRequiredNonZero(part3, 'SSN part 3');
  if (!r3.ok) errors.push({ field: 'ssnPart3', message: r3.message });

  return errors;
}

/* ---- Date of birth (EDIT-DATE-OF-BIRTH) ------------------------- */

function validateDob(v: string): AccountUpdateError[] {
  // ACCT-UPD-23: same checks as account dates.
  const base = validateAccountDate(v, 'dob', 'Date of Birth');
  if (base.length > 0) return base;
  // ACCT-UPD-24: DOB cannot be in the future (tested only if the date is valid).
  const today = new Date();
  const todayIso = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(
    today.getUTCDate(),
  ).padStart(2, '0')}`;
  if (normalizeScreen(v).trim() > todayIso) {
    return [{ field: 'dob', message: 'Date of Birth cannot be in the future.' }];
  }
  return [];
}

/* ---- FICO (1275-EDIT-FICO-SCORE) -------------------------------- */

function validateFico(v: string): AccountUpdateError[] {
  const value = normalizeScreen(v).trim();
  // ACCT-UPD-25: required, numeric, length 3, non-zero.
  const r = numRequiredNonZeroLen(value, 3, 'FICO score');
  if (!r.ok) return [{ field: 'ficoScore', message: r.message }];
  // ACCT-UPD-26: between 300 and 850 inclusive (tested only if RG-25 OK).
  const range = isFicoInRange(value);
  return range.ok ? [] : [{ field: 'ficoScore', message: range.message }];
}

/* ---- Customer names & address ----------------------------------- */

function validateNames(input: AccountUpdateInput): AccountUpdateError[] {
  const errors: AccountUpdateError[] = [];
  const first = normalizeScreen(f(input, 'firstName'));
  const middle = normalizeScreen(f(input, 'middleName'));
  const last = normalizeScreen(f(input, 'lastName'));

  // ACCT-UPD-27: first name required, letters+spaces, 25.
  if (first.trim().length === 0) {
    errors.push({ field: 'firstName', message: 'First Name must be supplied.' });
  } else {
    const r = isAlphaSpaces(first, 'First Name');
    if (!r.ok) errors.push({ field: 'firstName', message: r.message });
  }

  // ACCT-UPD-28: middle name OPTIONAL; if provided -> letters only.
  if (middle.trim().length > 0) {
    const r = isAlphaSpaces(middle, 'Middle Name');
    if (!r.ok) errors.push({ field: 'middleName', message: r.message });
  }

  // ACCT-UPD-29: last name required, letters only, 25.
  if (last.trim().length === 0) {
    errors.push({ field: 'lastName', message: 'Last Name must be supplied.' });
  } else {
    const r = isAlphaSpaces(last, 'Last Name');
    if (!r.ok) errors.push({ field: 'lastName', message: r.message });
  }
  return errors;
}

function validateAddress(input: AccountUpdateInput): AccountUpdateError[] {
  const errors: AccountUpdateError[] = [];
  const addr1 = normalizeScreen(f(input, 'addrLine1'));
  // addrLine2: ACCT-UPD-31 — optional, NOT validated (deliberately ignored).
  const city = normalizeScreen(f(input, 'city')); // = addr_line_3
  const state = normalizeScreen(f(input, 'state'));
  const zip = normalizeScreen(f(input, 'zip'));
  const country = normalizeScreen(f(input, 'country'));

  // ACCT-UPD-30: Address Line 1 required (any non-empty value accepted).
  const a1 = required(addr1, 'Address Line 1');
  if (!a1.ok) errors.push({ field: 'addrLine1', message: a1.message });

  // ACCT-UPD-32: City (= addr line 3) required, letters only, 50.
  if (city.trim().length === 0) {
    errors.push({ field: 'city', message: 'City must be supplied.' });
  } else {
    const r = isAlphaSpaces(city, 'City');
    if (!r.ok) errors.push({ field: 'city', message: r.message });
  }

  // ACCT-UPD-33: State required, letters only, 2.
  let stateValid = false;
  if (state.trim().length === 0) {
    errors.push({ field: 'state', message: 'State must be supplied.' });
  } else {
    const ra = isAlphaSpaces(state, 'State');
    if (!ra.ok) {
      errors.push({ field: 'state', message: ra.message });
    } else {
      // ACCT-UPD-34: valid US state code (among 56) — tested only if RG-33 OK.
      const rv = isValidUsState(state);
      if (!rv.ok) errors.push({ field: 'state', message: rv.message });
      else stateValid = true;
    }
  }

  // ACCT-UPD-35: Zip required, numeric, non-zero, length 5.
  let zipValid = false;
  const rz = numRequiredNonZeroLen(zip, 5, 'Zip');
  if (!rz.ok) errors.push({ field: 'zip', message: rz.message });
  else zipValid = true;

  // ACCT-UPD-36: Country required, letters only, 3.
  if (country.trim().length === 0) {
    errors.push({ field: 'country', message: 'Country must be supplied.' });
  } else {
    const r = isAlphaSpaces(country, 'Country');
    if (!r.ok) errors.push({ field: 'country', message: r.message });
  }

  // ACCT-UPD-37: State/Zip consistency (240 combos) — ONLY if State AND Zip are valid.
  if (stateValid && zipValid && !isValidStateZipCombo(state, zip)) {
    errors.push({ field: 'zip', message: 'Invalid zip code for state.' });
  }

  return errors;
}

/* ---- Phones (1260-EDIT-US-PHONE-NUM) ---------------------------- */

/**
 * Validates ONE split phone number (area/prefix/line).
 *
 * ACCT-UPD-38a: phone NOT required — if all 3 parts are "empty"
 * -> valid, exit.
 *
 * D-09 — SOURCE BUG REPRODUCED: the source (COACTUPC L.2238-2239) tests part A (NUMA)
 * TWICE instead of testing B then C. Consequence: a case where A and C
 * are empty but B is filled is treated as "all empty" (hence valid, without
 * checking B). Default: REPRODUCE the bug as-is.
 */
function validatePhone(
  area: string,
  prefix: string,
  line: string,
  fieldPrefix: string,
): AccountUpdateError[] {
  const a = normalizeScreen(area).trim();
  const b = normalizeScreen(prefix).trim();
  const c = normalizeScreen(line).trim();

  // ACCT-UPD-38a + D-09: optionality condition reproducing the source bug.
  // PARITY: source bug reproduced (D-09) — the 2nd sub-condition retests A (`a === ''`)
  // instead of B, exactly like COACTUPC L.2238-2239 (NUMA tested twice).
  const allBlankBuggy = a === '' && a === '' && c === '';
  if (allBlankBuggy) {
    return []; // considered "not entered" -> valid, NO check on B (effect of the bug)
  }

  const errors: AccountUpdateError[] = [];

  // ACCT-UPD-38b: area code (A) — required, numeric, non-zero, valid NANP.
  const ra = numRequiredNonZero(a, 'Phone area code');
  if (!ra.ok) {
    errors.push({ field: `${fieldPrefix}Area`, message: ra.message });
  } else if (!isValidAreaCode(a)) {
    errors.push({
      field: `${fieldPrefix}Area`,
      message: 'Phone area code is not valid.',
    });
  }

  // ACCT-UPD-38c: prefix (B) — required, numeric 3, non-zero.
  const rb = numRequiredNonZeroLen(b, 3, 'Phone prefix');
  if (!rb.ok) errors.push({ field: `${fieldPrefix}Prefix`, message: rb.message });

  // ACCT-UPD-38d: line (C) — required, numeric 4, non-zero.
  const rc = numRequiredNonZeroLen(c, 4, 'Phone line number');
  if (!rc.ok) errors.push({ field: `${fieldPrefix}Line`, message: rc.message });

  return errors;
}

/* ---- Other fields ----------------------------------------------- */

function validateOtherFields(input: AccountUpdateInput): AccountUpdateError[] {
  const errors: AccountUpdateError[] = [];
  const eft = normalizeScreen(f(input, 'eftAccountId')).trim();
  const pri = normalizeScreen(f(input, 'priCardHolder'));

  // ACCT-UPD-39: EFT Account Id required, numeric, non-zero, length 10.
  const re = numRequiredNonZeroLen(eft, 10, 'EFT Account Id');
  if (!re.ok) errors.push({ field: 'eftAccountId', message: re.message });

  // ACCT-UPD-40: primary card holder = Y or N, required.
  const rp = isYesNoRequired(pri, 'Primary Card Holder');
  if (!rp.ok) errors.push({ field: 'priCardHolder', message: rp.message });

  // ACCT-UPD-41: Govt Issued Id (X20) and Group Id (X10) received but NOT validated.
  //              (deliberately no check — source parity.)
  // ACCT-UPD-42: Customer Id displayed but NOT editable — not handled here (read-only).
  return errors;
}

/* ================================================================== */
/* §B — CHANGE DETECTION (ACCT-UPD-43)                                */
/* ================================================================== */

/** Case/space-insensitive text comparison: UPPER(TRIM(a)) === UPPER(TRIM(b)). */
function eqUpper(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

/** Case/space-insensitive text comparison, LOWER version (D-27 — source inconsistency). */
function eqLower(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * ACCT-UPD-43 — detects whether at least one entered field differs from the displayed snapshot.
 * Reproduces the 1205-COMPARE-OLD-NEW semantics:
 *   - alpha fields (names, address, state, country, status, flags): UPPER+TRIM;
 *   - amounts/dates/SSN/phones/zip/eft: RAW comparison (case-sensitive);
 *   - D-27: group-id compared in UPPER here (1205) — the LOWER inconsistency appears
 *     only in the 9700 lock re-comparison (see detectConflict).
 * Returns true if CHANGE-HAS-OCCURRED.
 */
function hasChange(input: AccountUpdateInput, snap: AccountUpdateSnapshot): boolean {
  const a = snap.account;
  const c = snap.customer;

  // --- Account (amounts compared in cents, raw) ---
  const newCreditCents = safeCents(f(input, 'creditLimit'));
  const newCashCents = safeCents(f(input, 'cashCreditLimit'));
  const newBalCents = safeCents(f(input, 'currBal'));
  const newCycCrCents = safeCents(f(input, 'currCycCredit'));
  const newCycDbCents = safeCents(f(input, 'currCycDebit'));

  if (!eqUpper(f(input, 'activeStatus'), a.active_status)) return true; // alpha
  if (newCreditCents !== a.credit_limit) return true; // raw
  if (newCashCents !== a.cash_credit_limit) return true;
  if (newBalCents !== a.curr_bal) return true;
  if (newCycCrCents !== a.curr_cyc_credit) return true;
  if (newCycDbCents !== a.curr_cyc_debit) return true;
  if (f(input, 'openDate').trim() !== a.open_date.trim()) return true; // raw date
  if (f(input, 'expirationDate').trim() !== a.expiration_date.trim()) return true;
  if (f(input, 'reissueDate').trim() !== a.reissue_date.trim()) return true;

  // --- Customer ---
  if (!eqUpper(f(input, 'firstName'), c.first_name)) return true; // alpha
  if (!eqUpper(f(input, 'middleName'), c.middle_name)) return true;
  if (!eqUpper(f(input, 'lastName'), c.last_name)) return true;
  if (!eqUpper(f(input, 'addrLine1'), c.addr_line_1)) return true;
  if (!eqUpper(f(input, 'addrLine2'), c.addr_line_2)) return true;
  if (!eqUpper(f(input, 'city'), c.addr_line_3)) return true;
  if (!eqUpper(f(input, 'state'), c.addr_state_cd)) return true;
  if (!eqUpper(f(input, 'country'), c.addr_country_cd)) return true;
  if (f(input, 'zip').trim() !== c.addr_zip.trim()) return true; // raw
  if (composePhone(f(input, 'phone1Area'), f(input, 'phone1Prefix'), f(input, 'phone1Line')) !== c.phone_num_1.trim()) {
    return true; // raw
  }
  if (composePhone(f(input, 'phone2Area'), f(input, 'phone2Prefix'), f(input, 'phone2Line')) !== c.phone_num_2.trim()) {
    return true;
  }
  if (composeSsn(input) !== c.ssn.trim()) return true; // raw
  if (f(input, 'dob').trim() !== c.dob.trim()) return true; // raw
  if (safeFico(f(input, 'ficoScore')) !== c.fico_score) return true; // raw numeric
  if (f(input, 'eftAccountId').trim() !== c.eft_account_id.trim()) return true; // raw
  if (!eqUpper(f(input, 'priCardHolder'), c.pri_card_holder)) return true; // alpha

  return false; // NO-CHANGES-DETECTED
}

/* ================================================================== */
/* §C — RECORD REBUILDING (3956-4059)                                 */
/* ================================================================== */

/** Converts a validated monetary input to cents (parseMoneyToCents). */
function safeCents(v: string): number {
  const value = normalizeScreen(v).trim();
  if (value.length === 0) return 0;
  try {
    return parseMoneyToCents(value);
  } catch {
    return Number.NaN; // invalid format -> will match no snapshot (forcing a change)
  }
}

function safeFico(v: string): number {
  const n = Number.parseInt(normalizeScreen(v).trim(), 10);
  return Number.isInteger(n) ? n : Number.NaN;
}

/** Rebuilds the phone as `(AAA)BBB-CCCC`; empty if no part is set (see 4027-4041). */
function composePhone(area: string, prefix: string, line: string): string {
  const a = normalizeScreen(area).trim();
  const b = normalizeScreen(prefix).trim();
  const c = normalizeScreen(line).trim();
  if (a === '' && b === '' && c === '') return '';
  return `(${a})${b}-${c}`;
}

/** Rebuilds the compact SSN `NNNNNNNNN` (9 digits) from the 3 parts. */
function composeSsn(input: AccountUpdateInput): string {
  const p1 = normalizeScreen(f(input, 'ssnPart1')).trim();
  const p2 = normalizeScreen(f(input, 'ssnPart2')).trim();
  const p3 = normalizeScreen(f(input, 'ssnPart3')).trim();
  if (p1 === '' && p2 === '' && p3 === '') return '';
  return `${p1}${p2}${p3}`;
}

/** Builds the updated ACCOUNT row from the snapshot + input. */
function buildAccountRow(input: AccountUpdateInput, snap: AccountUpdateSnapshot): AccountRow {
  const a = snap.account;
  return {
    acct_id: a.acct_id, // non-editable key
    active_status: normalizeScreen(f(input, 'activeStatus')).trim(),
    credit_limit: parseMoneyToCents(normalizeScreen(f(input, 'creditLimit')).trim()),
    cash_credit_limit: parseMoneyToCents(normalizeScreen(f(input, 'cashCreditLimit')).trim()),
    curr_bal: parseMoneyToCents(normalizeScreen(f(input, 'currBal')).trim()),
    curr_cyc_credit: parseMoneyToCents(normalizeScreen(f(input, 'currCycCredit')).trim()),
    curr_cyc_debit: parseMoneyToCents(normalizeScreen(f(input, 'currCycDebit')).trim()),
    open_date: normalizeScreen(f(input, 'openDate')).trim(),
    expiration_date: normalizeScreen(f(input, 'expirationDate')).trim(),
    reissue_date: normalizeScreen(f(input, 'reissueDate')).trim(),
    addr_zip: a.addr_zip, // account zip not edited by this screen
    group_id: a.group_id, // ACCT-UPD-41: received but not validated/edited
  };
}

/** Builds the updated CUSTOMER row from the snapshot + input. */
function buildCustomerRow(input: AccountUpdateInput, snap: AccountUpdateSnapshot): CustomerRow {
  const c = snap.customer;
  return {
    cust_id: c.cust_id, // ACCT-UPD-42: non-editable
    first_name: normalizeScreen(f(input, 'firstName')),
    middle_name: normalizeScreen(f(input, 'middleName')),
    last_name: normalizeScreen(f(input, 'lastName')),
    addr_line_1: normalizeScreen(f(input, 'addrLine1')),
    addr_line_2: normalizeScreen(f(input, 'addrLine2')),
    addr_line_3: normalizeScreen(f(input, 'city')),
    addr_state_cd: normalizeScreen(f(input, 'state')).trim().toUpperCase(),
    addr_country_cd: normalizeScreen(f(input, 'country')).trim(),
    addr_zip: normalizeScreen(f(input, 'zip')).trim(),
    phone_num_1: composePhone(f(input, 'phone1Area'), f(input, 'phone1Prefix'), f(input, 'phone1Line')),
    phone_num_2: composePhone(f(input, 'phone2Area'), f(input, 'phone2Prefix'), f(input, 'phone2Line')),
    ssn: composeSsn(input),
    govt_issued_id: normalizeScreen(f(input, 'govtIssuedId')), // ACCT-UPD-41: not validated
    dob: normalizeScreen(f(input, 'dob')).trim(),
    eft_account_id: normalizeScreen(f(input, 'eftAccountId')).trim(),
    pri_card_holder: normalizeScreen(f(input, 'priCardHolder')).trim(),
    fico_score: Number.parseInt(normalizeScreen(f(input, 'ficoScore')).trim(), 10),
  };
}

/* ================================================================== */
/* §D — OPTIMISTIC LOCK (ACCT-UPD-45)                                 */
/* ================================================================== */

/**
 * Re-compares the re-read record (under "lock" = fresh re-read) with the displayed
 * snapshot. Reproduces 9700-CHECK-CHANGE-IN-REC: if ANY field differs -> conflict.
 *
 * D-27 — SOURCE INCONSISTENCY REPRODUCED: 9700 compares `ACCT-GROUP-ID` in LOWER-CASE
 * (COACTUPC L.4139-4140) whereas 1205 compares it in UPPER-CASE (L.1697-1700).
 * We reproduce the inconsistency: group-id is compared here in LOWER (eqLower), the
 * other alpha fields in UPPER (eqUpper) like the source.
 *
 * D-28: the snapshot DOB is ISO `YYYY-MM-DD` (target) — direct raw comparison,
 * without the compact offsets (1:4)(5:2)(7:2) of the mainframe source.
 */
function detectConflict(
  fresh: AccountUpdateSnapshot,
  snap: AccountUpdateSnapshot,
): boolean {
  const fa = fresh.account;
  const sa = snap.account;
  const fc = fresh.customer;
  const sc = snap.customer;

  // --- Account ---
  if (!eqUpper(fa.active_status, sa.active_status)) return true;
  if (fa.credit_limit !== sa.credit_limit) return true; // amounts: cents, raw
  if (fa.cash_credit_limit !== sa.cash_credit_limit) return true;
  if (fa.curr_bal !== sa.curr_bal) return true;
  if (fa.curr_cyc_credit !== sa.curr_cyc_credit) return true;
  if (fa.curr_cyc_debit !== sa.curr_cyc_debit) return true;
  if (fa.open_date.trim() !== sa.open_date.trim()) return true; // dates: raw
  if (fa.expiration_date.trim() !== sa.expiration_date.trim()) return true;
  if (fa.reissue_date.trim() !== sa.reissue_date.trim()) return true;
  if (fa.addr_zip.trim() !== sa.addr_zip.trim()) return true;
  // D-27: group-id compared in LOWER-CASE (reproduces 9700 L.4139-4140).
  // PARITY: UPPER(1205)/LOWER(9700) inconsistency reproduced (D-27).
  if (!eqLower(fa.group_id, sa.group_id)) return true;

  // --- Customer ---
  if (!eqUpper(fc.first_name, sc.first_name)) return true;
  if (!eqUpper(fc.middle_name, sc.middle_name)) return true;
  if (!eqUpper(fc.last_name, sc.last_name)) return true;
  if (!eqUpper(fc.addr_line_1, sc.addr_line_1)) return true;
  if (!eqUpper(fc.addr_line_2, sc.addr_line_2)) return true;
  if (!eqUpper(fc.addr_line_3, sc.addr_line_3)) return true;
  if (!eqUpper(fc.addr_state_cd, sc.addr_state_cd)) return true;
  if (!eqUpper(fc.addr_country_cd, sc.addr_country_cd)) return true;
  if (fc.addr_zip.trim() !== sc.addr_zip.trim()) return true; // raw
  if (fc.phone_num_1.trim() !== sc.phone_num_1.trim()) return true;
  if (fc.phone_num_2.trim() !== sc.phone_num_2.trim()) return true;
  if (fc.ssn.trim() !== sc.ssn.trim()) return true;
  if (fc.dob.trim() !== sc.dob.trim()) return true; // D-28: direct ISO comparison
  if (fc.eft_account_id.trim() !== sc.eft_account_id.trim()) return true;
  if (!eqUpper(fc.pri_card_holder, sc.pri_card_holder)) return true;
  if (fc.fico_score !== sc.fico_score) return true;

  return false; // no concurrent modification
}

/* ================================================================== */
/* §E — ORCHESTRATOR (1200-EDIT-MAP-INPUTS -> 9600-WRITE-PROCESSING)  */
/* ================================================================== */

/**
 * Runs all field validations (ACCT-UPD-01..42).
 * Source semantics: ALL validations run; the 1st message is kept on the
 * screen side. We return the full list (the handler will choose the display
 * order). The stacking order follows 1200-EDIT-MAP-INPUTS.
 */
function runAllValidations(input: AccountUpdateInput): AccountUpdateError[] {
  return [
    ...validateAcctId(f(input, 'acctId')), // ACCT-UPD-01/02
    ...validateActiveStatus(f(input, 'activeStatus')), // ACCT-UPD-03/04
    // Account dates (ACCT-UPD-11..18) — open/expiry/reissue
    ...validateAccountDate(f(input, 'openDate'), 'openDate', 'Open Date'),
    ...validateMoneyField(f(input, 'creditLimit'), 'creditLimit', 'Credit Limit'), // 05/06
    ...validateAccountDate(f(input, 'expirationDate'), 'expirationDate', 'Expiry Date'),
    ...validateMoneyField(f(input, 'cashCreditLimit'), 'cashCreditLimit', 'Cash Credit Limit'), // 07
    ...validateAccountDate(f(input, 'reissueDate'), 'reissueDate', 'Reissue Date'),
    ...validateMoneyField(f(input, 'currBal'), 'currBal', 'Current Balance'), // 08
    ...validateMoneyField(f(input, 'currCycCredit'), 'currCycCredit', 'Current Cycle Credit'), // 09
    ...validateMoneyField(f(input, 'currCycDebit'), 'currCycDebit', 'Current Cycle Debit'), // 10
    // DOB (ACCT-UPD-23/24)
    ...validateDob(f(input, 'dob')),
    // FICO (ACCT-UPD-25/26)
    ...validateFico(f(input, 'ficoScore')),
    // SSN (ACCT-UPD-19..22)
    ...validateSsn(f(input, 'ssnPart1'), f(input, 'ssnPart2'), f(input, 'ssnPart3')),
    // Names (ACCT-UPD-27..29)
    ...validateNames(input),
    // Address + state/zip (ACCT-UPD-30..37)
    ...validateAddress(input),
    // Phones (ACCT-UPD-38a..d) x2
    ...validatePhone(f(input, 'phone1Area'), f(input, 'phone1Prefix'), f(input, 'phone1Line'), 'phone1'),
    ...validatePhone(f(input, 'phone2Area'), f(input, 'phone2Prefix'), f(input, 'phone2Line'), 'phone2'),
    // Others (ACCT-UPD-39/40 ; 41/42 = not validated)
    ...validateOtherFields(input),
  ];
}

/**
 * Entry point of the COACTUPC domain.
 *
 * Sequence:
 *   1. validates all fields (ACCT-UPD-01..42);
 *   2. requires at least one change (ACCT-UPD-43, INV-11);
 *   3. re-reads ACCTDAT+CUSTDAT and re-compares to the snapshot (optimistic lock, ACCT-UPD-45);
 *      mismatch -> { conflict:true }, NO write;
 *   4. writes account + customer in ONE atomic D1 batch (ACCT-UPD-46, INV-10):
 *      all or nothing (equiv. SYNCPOINT ROLLBACK if the customer write fails).
 *
 * @returns ok + updated on success; otherwise errors or conflict.
 */
export async function updateAccount(
  env: Env,
  input: AccountUpdateInput,
  snapshot: AccountUpdateSnapshot,
): Promise<AccountUpdateResult> {
  // ---- 1. Field validations (ACCT-UPD-01..42) ----
  const errors = runAllValidations(input);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // ---- 2. Change detection (ACCT-UPD-43 / INV-11) ----
  if (!hasChange(input, snapshot)) {
    return {
      ok: false,
      errors: [{ field: 'acctId', message: 'No change detected. Add or update fields to update account.' }],
    };
  }

  // ---- 3. Optimistic lock (ACCT-UPD-45 / INV-09): re-read under lock ----
  // Equiv. 9600 READ ... UPDATE: we re-read the fresh state of both tables.
  const freshAccount = await get<AccountRow>(
    env.DB,
    `SELECT acct_id, active_status, curr_bal, credit_limit, cash_credit_limit,
            open_date, expiration_date, reissue_date, curr_cyc_credit, curr_cyc_debit,
            addr_zip, group_id
       FROM accounts WHERE acct_id = ?`,
    snapshot.account.acct_id,
  );
  const freshCustomer = await get<CustomerRow>(
    env.DB,
    `SELECT cust_id, first_name, middle_name, last_name, addr_line_1, addr_line_2,
            addr_line_3, addr_state_cd, addr_country_cd, addr_zip, phone_num_1,
            phone_num_2, ssn, govt_issued_id, dob, eft_account_id, pri_card_holder,
            fico_score
       FROM customers WHERE cust_id = ?`,
    snapshot.customer.cust_id,
  );

  // A record disappearing between display and save = conflict.
  if (freshAccount === null || freshCustomer === null) {
    return { ok: false, conflict: true };
  }

  // Field-by-field re-comparison with the snapshot (9700-CHECK-CHANGE-IN-REC).
  if (detectConflict({ account: freshAccount, customer: freshCustomer }, snapshot)) {
    // "Record changed by some one else. Please review" -> abort, no write.
    return { ok: false, conflict: true };
  }

  // ---- 4. Rebuild + atomic grouped write (ACCT-UPD-46 / INV-10) ----
  const newAccount = buildAccountRow(input, snapshot);
  const newCustomer = buildCustomerRow(input, snapshot);

  // db.batch = implicit D1 transaction: account REWRITE + customer REWRITE
  // "all or nothing". Replaces the manual REWRITE+SYNCPOINT ROLLBACK pattern: if
  // either write fails, NEITHER is applied (INV-10).
  const updateAccountStmt = env.DB.prepare(
    `UPDATE accounts
        SET active_status = ?, curr_bal = ?, credit_limit = ?, cash_credit_limit = ?,
            open_date = ?, expiration_date = ?, reissue_date = ?,
            curr_cyc_credit = ?, curr_cyc_debit = ?
      WHERE acct_id = ?`,
  ).bind(
    newAccount.active_status,
    newAccount.curr_bal,
    newAccount.credit_limit,
    newAccount.cash_credit_limit,
    newAccount.open_date,
    newAccount.expiration_date,
    newAccount.reissue_date,
    newAccount.curr_cyc_credit,
    newAccount.curr_cyc_debit,
    newAccount.acct_id,
  );

  const updateCustomerStmt = env.DB.prepare(
    `UPDATE customers
        SET first_name = ?, middle_name = ?, last_name = ?, addr_line_1 = ?,
            addr_line_2 = ?, addr_line_3 = ?, addr_state_cd = ?, addr_country_cd = ?,
            addr_zip = ?, phone_num_1 = ?, phone_num_2 = ?, ssn = ?, govt_issued_id = ?,
            dob = ?, eft_account_id = ?, pri_card_holder = ?, fico_score = ?
      WHERE cust_id = ?`,
  ).bind(
    newCustomer.first_name,
    newCustomer.middle_name,
    newCustomer.last_name,
    newCustomer.addr_line_1,
    newCustomer.addr_line_2,
    newCustomer.addr_line_3,
    newCustomer.addr_state_cd,
    newCustomer.addr_country_cd,
    newCustomer.addr_zip,
    newCustomer.phone_num_1,
    newCustomer.phone_num_2,
    newCustomer.ssn,
    newCustomer.govt_issued_id,
    newCustomer.dob,
    newCustomer.eft_account_id,
    newCustomer.pri_card_holder,
    newCustomer.fico_score,
    newCustomer.cust_id,
  );

  // Source order: account then customer (3956+ / 4065 / 4085). D1 atomicity.
  const results = await d1Batch(env.DB, [updateAccountStmt, updateCustomerStmt]);

  // If a write touched no row (key vanished after the re-read) ->
  // equiv. LOCKED-BUT-UPDATE-FAILED: we report a conflict (nothing persisted
  // inconsistently — the batch is all-or-nothing).
  const allApplied = results.every((r) => (r.meta?.changes ?? 0) > 0);
  if (!allApplied) {
    return { ok: false, conflict: true };
  }

  // ---- Success: CHANGES-OKAYED-AND-DONE ----
  // all_ documents the use of the lib combinator (all validations OK before the write).
  void all_(ok);
  return { ok: true, updated: { account: newAccount, customer: newCustomer } };
}
