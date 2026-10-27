/**
 * Reusable validators — foundation of the COACTUPC (account update, 48 validations)
 * and COTRN02C (add transaction) modules.
 *
 * Each validator returns a `ValidationResult`: { ok: true } or
 * { ok: false, message }. The messages reproduce the spirit of the original
 * COBOL messages (see parity cases O-6, O-7, O-8). Business logic stays decoupled
 * from display (handlers decide the rendering).
 */

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

const OK: ValidationResult = { ok: true };
const fail = (message: string): ValidationResult => ({ ok: false, message });

/* ------------------------------------------------------------------ */
/* Elementary fields                                                   */
/* ------------------------------------------------------------------ */

/** Required field: non-empty after trim. */
export function required(value: string, fieldLabel: string): ValidationResult {
  return value.trim().length > 0 ? OK : fail(`${fieldLabel} can NOT be empty.`);
}

/** Purely numeric (digits only, e.g. account ID, FICO, CVV). */
export function isNumeric(value: string, fieldLabel: string): ValidationResult {
  return /^[0-9]+$/.test(value) ? OK : fail(`${fieldLabel} must be numeric.`);
}

/** Alphanumeric (letters, digits, spaces). */
export function isAlphanumeric(value: string, fieldLabel: string): ValidationResult {
  return /^[A-Za-z0-9 ]+$/.test(value) ? OK : fail(`${fieldLabel} must be alphanumeric.`);
}

/** Exact length. */
export function hasLength(value: string, length: number, fieldLabel: string): ValidationResult {
  return value.length === length
    ? OK
    : fail(`${fieldLabel} must be exactly ${length} characters.`);
}

/** Length within the inclusive range [min, max]. */
export function lengthBetween(
  value: string,
  min: number,
  max: number,
  fieldLabel: string,
): ValidationResult {
  const n = value.length;
  return n >= min && n <= max
    ? OK
    : fail(`${fieldLabel} length must be between ${min} and ${max}.`);
}

/**
 * Yes/No flag: 'Y' or 'N' only (parity case O-6, RG-04).
 * The message reproduces the COBOL spirit "must be Y or N".
 */
export function isYesNo(value: string, fieldLabel: string): ValidationResult {
  return value === 'Y' || value === 'N' ? OK : fail(`${fieldLabel} must be Y or N.`);
}

/**
 * Signed amount in S9(...)V99 format — accepts an optional sign, digits,
 * and exactly 2 optional decimals (e.g. "2500.00", "-579.88", "194").
 * Parity case O-8: "ABC" → invalid; "2500.00" → valid.
 * On success, the value in CENTS is obtained via parseMoneyToCents.
 */
export function isMoney(value: string, fieldLabel: string): ValidationResult {
  return /^-?\d+(\.\d{1,2})?$/.test(value.trim())
    ? OK
    : fail(`${fieldLabel} is not valid.`);
}

/**
 * Converts a validated monetary input ("194", "2500.00", "-579.88") to an
 * integer number of cents. Use AFTER isMoney(). Throws if the format is invalid.
 */
export function parseMoneyToCents(value: string): number {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error(`parseMoneyToCents: format invalide ${JSON.stringify(value)}`);
  }
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, frac = ''] = unsigned.split('.');
  const cents = Number.parseInt(whole!, 10) * 100 + Number.parseInt(frac.padEnd(2, '0'), 10);
  return negative ? -cents : cents;
}

/**
 * FICO within the inclusive range [300, 850] (parity case O-7, RG-26).
 * Accepts the value as a numeric string or a number.
 */
export function isFicoInRange(value: string | number, fieldLabel = 'FICO score'): ValidationResult {
  const n = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(n)) return fail(`${fieldLabel} must be numeric.`);
  return n >= 300 && n <= 850 ? OK : fail(`${fieldLabel} should be between 300 and 850.`);
}

/* ------------------------------------------------------------------ */
/* YYYY-MM-DD date with correct leap-year handling                     */
/* ------------------------------------------------------------------ */

/** Gregorian leap year. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Number of days in a month (1..12) of a given year. */
export function daysInMonth(year: number, month: number): number {
  const table = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return table[month - 1] ?? 0;
}

/**
 * Strict 'YYYY-MM-DD' date with calendar validation (month 1..12,
 * day valid for the month, correct leap year). Equivalent of CSUTLDTC/CSUTLDPY.
 */
export function isValidDate(value: string, fieldLabel = 'Date'): ValidationResult {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return fail(`${fieldLabel} must be in YYYY-MM-DD format.`);
  const year = Number.parseInt(m[1]!, 10);
  const month = Number.parseInt(m[2]!, 10);
  const day = Number.parseInt(m[3]!, 10);
  if (month < 1 || month > 12) return fail(`${fieldLabel} has an invalid month.`);
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) return fail(`${fieldLabel} has an invalid day.`);
  return OK;
}

/* ------------------------------------------------------------------ */
/* US state (lookup CSLKPCDY)                                          */
/* ------------------------------------------------------------------ */

/**
 * Valid US state codes — extracted from the CSLKPCDY.cpy copybook
 * (50 states + DC + 5 territories: AS, GU, MP, PR, VI). 56 codes in total.
 */
export const US_STATE_CODES: ReadonlySet<string> = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'AS', 'GU', 'MP', 'PR', 'VI',
]);

/** Checks a US state code (case-insensitive → compared in uppercase). */
export function isValidUsState(value: string, fieldLabel = 'State code'): ValidationResult {
  return US_STATE_CODES.has(value.trim().toUpperCase())
    ? OK
    : fail(`${fieldLabel} is not a valid US state code.`);
}

/* ------------------------------------------------------------------ */
/* Composition                                                         */
/* ------------------------------------------------------------------ */

/**
 * Applies a series of validators and returns the FIRST error encountered
 * (COBOL semantics: first error message displayed). { ok:true } if all pass.
 */
export function all_(...results: ValidationResult[]): ValidationResult {
  for (const r of results) {
    if (!r.ok) return r;
  }
  return OK;
}
