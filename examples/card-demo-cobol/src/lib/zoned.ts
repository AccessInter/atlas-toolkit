/**
 * Signed zoned-decimal codec (overpunch) ↔ integer cents.
 *
 * CardDemo context: a COBOL `S9(n)V99` field in *zoned display* occupies `n+2`
 * bytes. The decimal point `V99` is IMPLICIT (never stored): the last 2 digits
 * are the cents. The SIGN is carried by the "overpunch" of the LAST byte, which
 * combines a digit AND the sign in a single character.
 *
 * Architectural decision: all amounts are handled as INTEGER cents. NEVER
 * binary floats (zero rounding error on financial data, invariant INV-9).
 * `decimals` sets the number of implicit decimals (V99 → 2).
 * decodeZoned/encodeZoned therefore work in the smallest unit = 10^decimals.
 *
 * Overpunch table (validated against the 20 characters actually present in the
 * data):
 *   '{' = digit 0, sign +         '}' = digit 0, sign −
 *   'A'..'I' = 1..9, sign +       'J'..'R' = 1..9, sign −
 *   digits '0'..'9' = positive (no overpunch sign on the last byte)
 */

/** Overpunch last byte → { digit, negative }. */
interface OverpunchDecoded {
  readonly digit: number;
  readonly negative: boolean;
}

const POSITIVE_OVERPUNCH = '{ABCDEFGHI'; // index = digit 0..9, sign +
const NEGATIVE_OVERPUNCH = '}JKLMNOPQR'; // index = digit 0..9, sign −

/**
 * Decodes the last byte (overpunch) into (digit, sign).
 * Also accepts a plain digit '0'..'9' (interpreted as positive), useful for
 * fields whose last byte did not receive an overpunch.
 */
function decodeOverpunch(ch: string): OverpunchDecoded {
  const posIdx = POSITIVE_OVERPUNCH.indexOf(ch);
  if (posIdx >= 0) return { digit: posIdx, negative: false };
  const negIdx = NEGATIVE_OVERPUNCH.indexOf(ch);
  if (negIdx >= 0) return { digit: negIdx, negative: true };
  if (ch >= '0' && ch <= '9') return { digit: ch.charCodeAt(0) - 48, negative: false };
  throw new Error(`decodeZoned: invalid overpunch last byte: ${JSON.stringify(ch)}`);
}

/**
 * Decodes a signed zoned decimal field into an INTEGER of the smallest unit.
 * For `decimals = 2` (S9(n)V99) the result is in CENTS.
 *
 * @param raw    the raw field, length = (integer digits + decimals) bytes
 * @param decimals number of implicit decimals (V99 → 2)
 * @returns signed integer (cents if decimals=2)
 *
 * Verification cases, expected cents:
 *   decodeZoned('00000001940{', 2) ===  19400  // account 1 ACCT-CURR-BAL = 194.00
 *   decodeZoned('00000020200{', 2) === 202000  // account 1 ACCT-CREDIT-LIMIT = 2020.00
 *   decodeZoned('00000010200{', 2) === 102000  // account 1 ACCT-CASH-CREDIT-LIMIT = 1020.00
 *   decodeZoned('0000009190}',  2) === -91900  // DALYTRAN amt = -919.00 (overpunch '}')
 *   decodeZoned('0000005047G',  2) ===  50477  // DALYTRAN amt =  504.77 (overpunch 'G'=7,+)
 */
export function decodeZoned(raw: string, decimals: number): number {
  if (raw.length === 0) throw new Error('decodeZoned: empty field');
  if (decimals < 0) throw new Error('decodeZoned: negative decimals');

  const lastChar = raw[raw.length - 1]!;
  const { digit, negative } = decodeOverpunch(lastChar);

  // (first n+1 bytes) must be decimal digits.
  const head = raw.slice(0, -1);
  if (!/^[0-9]*$/.test(head)) {
    throw new Error(`decodeZoned: invalid digits in ${JSON.stringify(raw)}`);
  }

  // Full digit string (head + overpunch digit).
  const digitsStr = head + String(digit);
  // The integer is already expressed in the smallest unit: the V99 decimal point is
  // implicit, so the last `decimals` digits are the sub-units.
  // We do NOT divide: we keep the integer (cents).
  const magnitude = Number.parseInt(digitsStr, 10);
  if (!Number.isSafeInteger(magnitude)) {
    throw new Error(`decodeZoned: safe-integer overflow for ${JSON.stringify(raw)}`);
  }
  // decimals only serves as a length-consistency guard.
  if (digitsStr.length < decimals) {
    throw new Error(`decodeZoned: field too short for ${decimals} decimals`);
  }
  return negative ? -magnitude : magnitude;
}

/**
 * Encodes an integer (cents if decimals=2) into a signed zoned decimal field.
 * Exact inverse of decodeZoned.
 *
 * @param cents       signed integer (cents)
 * @param totalDigits total number of stored digits = (integer digits + decimals).
 *                    E.g. S9(10)V99 → totalDigits = 12; S9(09)V99 → 11.
 * @param decimals    number of implicit decimals
 * @returns string of length `totalDigits`, last byte as signed overpunch
 *
 * Examples (inverses of the cases above):
 *   encodeZoned( 19400, 12, 2) === '00000001940{'
 *   encodeZoned(-91900, 11, 2) === '0000009190}'
 *   encodeZoned( 50477, 11, 2) === '0000005047G'
 */
export function encodeZoned(cents: number, totalDigits: number, decimals: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('encodeZoned: cents non entier');
  if (totalDigits <= 0) throw new Error('encodeZoned: totalDigits invalide');
  if (decimals < 0 || decimals >= totalDigits) throw new Error('encodeZoned: decimals invalide');

  const negative = cents < 0;
  const magnitude = Math.abs(cents);
  const digitsStr = String(magnitude).padStart(totalDigits, '0');
  if (digitsStr.length > totalDigits) {
    throw new Error(`encodeZoned: value ${cents} exceeds ${totalDigits} digits`);
  }

  const head = digitsStr.slice(0, -1);
  const lastDigit = Number.parseInt(digitsStr[digitsStr.length - 1]!, 10);
  const table = negative ? NEGATIVE_OVERPUNCH : POSITIVE_OVERPUNCH;
  return head + table[lastDigit]!;
}

/**
 * Formats an amount in cents for display: "1234.56" (always 2 decimals).
 * Keeps the sign. (Display only — business logic stays in cents.)
 *
 * Examples: formatMoney(19400) === '194.00' ; formatMoney(-57988) === '-579.88'
 */
export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('formatMoney: cents non entier');
  const negative = cents < 0;
  const magnitude = Math.abs(cents);
  const whole = Math.floor(magnitude / 100);
  const frac = magnitude % 100;
  return `${negative ? '-' : ''}${whole}.${String(frac).padStart(2, '0')}`;
}
