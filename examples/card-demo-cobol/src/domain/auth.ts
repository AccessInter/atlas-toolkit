/**
 * AUTH domain module: port of COSGN00C (CardDemo login, transaction CC00).
 *
 * COBOL source: aws-mainframe-modernization-carddemo/app/cbl/COSGN00C.cbl (261 lines).
 * Business rules: AUTH-01..15; design decisions D-02, D-03, D-06, D-26.
 * Target architecture: Cloudflare Workers + D1.
 *
 * Scope of THIS module: the pure AUTHENTICATION LOGIC (USRSEC read, required-field
 * validation, UPPERCASE normalization, password comparison, admin/user routing).
 * The purely "screen" rules of COSGN00C are out of scope for a REST/dashboard
 * `login()` function and are traced below:
 *   - AUTH-01 (blank screen on cold start)             -> handled by the handler/route (index.ts)
 *   - AUTH-02 (dispatch on EIBAID key)                 -> handled by HTTP routing (key -> endpoint)
 *   - AUTH-03 (F3 exits the application)               -> handled by the handler (exit button/route)
 *   - AUTH-04 (invalid key)                            -> not applicable over HTTP (no 3270 AID)
 *   - AUTH-14 (screen header: titles/date/APPLID...)   -> presentation, handled by the view
 *   - AUTH-15 (password masking on screen)             -> presentation (<input type=password> field)
 * See D-26: COSGN00C never tested the RESP of the RECEIVE (MAPFAIL unhandled); on the target
 * side, missing input becomes empty fields -> handled by AUTH-05/06 (required fields).
 */

import type { Env, UserRow } from '../lib/db';
import { get } from '../lib/db';

/**
 * Result of a login attempt.
 * - ok=true  -> userType + dest are set (target menu program).
 * - ok=false -> error is set (message mirroring the spirit of the COBOL literals).
 */
export interface LoginResult {
  ok: boolean;
  userType?: 'A' | 'U';
  dest?: string;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Constants (COBOL magic values become named constants)               */
/* ------------------------------------------------------------------ */

/** AUTH-10: admin menu program (XCTL if SEC-USR-TYPE = 'A'). COSGN00C:230-235. */
const DEST_ADMIN = 'COADM01C';
/** AUTH-10: main menu program (XCTL otherwise). COSGN00C:236-239. */
const DEST_USER = 'COMEN01C';

/**
 * Length of the user key = LENGTH OF WS-USER-ID = 8 (COSGN00C:216).
 * In CICS, the entered ID (BMS X(8)) is used as a VSAM key padded to 8 bytes.
 */
const USER_ID_LENGTH = 8;

/**
 * Normalizes a user ID into a lookup key, mirroring the COSGN00C VSAM READ.
 *
 * The mainframe reads USRSEC on an 8-byte key (KEYLENGTH=8): the ID entered via BMS
 * X(8) is left-justified and right-padded with SPACES (EBCDIC X'40'), NOT zeros —
 * SEC-USR-ID / WS-USER-ID are PIC X (alphanumeric) fields, not numeric.
 * The seed (schema/seed.sql) stores IDs this way: 'ADMIN001' (8 alphanumeric chars).
 *
 * The "zero-padded keys" contract applies to NUMERIC keys (acct_id, card_num);
 * for the user ID, parity requires right-padding with spaces and then truncating
 * to 8 (an ID longer than 8 chars is truncated as the X(8) field would do).
 */
function toUserKey(userId: string): string {
  const upper = userId.toUpperCase(); // AUTH-07: the key is compared in UPPERCASE.
  // Right-pad with spaces up to 8, then truncate to 8 (matches the BMS X(8) field + KEYLENGTH=8).
  return upper.padEnd(USER_ID_LENGTH, ' ').slice(0, USER_ID_LENGTH);
}

/**
 * Tests whether a screen field is "blank" in the COBOL sense.
 *
 * On RECEIVE, BMS returns LOW-VALUES for a field that was not entered; COSGN00C tests
 * `= SPACES OR LOW-VALUES` (COSGN00C:118, 123). On the target side, the
 * equivalent covers: missing/null value, empty string, AND a string containing only spaces.
 */
function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/* ------------------------------------------------------------------ */
/* Main function                                                       */
/* ------------------------------------------------------------------ */

/**
 * Authenticates a user and computes the routing destination.
 *
 * Reproduces the sequence of PROCESS-ENTER-KEY (COSGN00C:108-140) then of
 * READ-USER-SEC-FILE (COSGN00C:209-256):
 *   1. AUTH-05: User ID required (first EVALUATE TRUE branch, COSGN00C:117-122).
 *   2. AUTH-06: Password required, evaluated only if User ID is set (COSGN00C:123-127).
 *   3. AUTH-07: UPPERCASE normalization of ID and password (FUNCTION UPPER-CASE, COSGN00C:132-136).
 *   4. AUTH-08: read of the USRSEC security file by key, only if no error (COSGN00C:138-140, 211-219).
 *   5. AUTH-12: unknown user (RESP=13 NOTFND) -> "User not found" (COSGN00C:247-251).
 *   6. AUTH-09: plain-text password comparison, uppercase vs uppercase (COSGN00C:221-223, 241-246).
 *   7. AUTH-10: routing: type 'A' -> COADM01C, otherwise -> COMEN01C (COSGN00C:230-240).
 *
 * Note AUTH-11 (COMMAREA init before XCTL, COSGN00C:224-228): the `LoginResult` carries
 * userType + dest, which is enough for the calling handler to populate the CommArea
 * (userId, userType, fromTranId='CC00', fromProgram='COSGN00C', pgmContext=0) in index.ts.
 */
export async function login(env: Env, userId: string, password: string): Promise<LoginResult> {
  // --- AUTH-05: User ID required ----------------------------------------------------
  // EVALUATE TRUE: the first true branch wins and stops validation (COSGN00C:117-122).
  // PARITY: the COBOL does not EXIT after the error (non-blocking validation)
  // but since WS-ERR-FLG becomes 'Y', the READ is not executed -> the net effect is a stop.
  // We reproduce the EFFECT (processing stops) without the source's double screen render.
  if (isBlank(userId)) {
    return { ok: false, error: 'Please enter User ID ...' };
  }

  // --- AUTH-06: Password required (only if User ID provided) -------------------------
  if (isBlank(password)) {
    return { ok: false, error: 'Please enter Password ...' };
  }

  // --- AUTH-07: UPPERCASE normalization before any comparison ------------------------
  // FUNCTION UPPER-CASE on the ID AND the password (COSGN00C:135-136).
  // D-02: applied -> option (a) "preserve parity": authentication stays
  //       CASE-INSENSITIVE, including for the password (known security regression,
  //       kept as-is absent a contrary business decision).
  // PARITY: case-insensitive password reproduced (see D-02).
  const userKey = toUserKey(userId); // AUTH-07 + X(8) key.
  const passwordUpper = password.toUpperCase(); // AUTH-07.

  // --- AUTH-08: read of the USRSEC security file by key ------------------------------
  // EXEC CICS READ DATASET(USRSEC) INTO(SEC-USER-DATA) RIDFLD(WS-USER-ID) (COSGN00C:211-219).
  // `get` returns null on NOTFND (RESP=13), a faithful equivalent of the VSAM READ (db.ts).
  // The logical name 'USRSEC  ' (2 padding spaces) becomes the `users` table without padding.
  const userRow = await get<UserRow>(
    env.DB,
    'SELECT user_id, first_name, last_name, password, user_type FROM users WHERE user_id = ?',
    userKey,
  );

  // --- AUTH-12: unknown user (RESP=13 NOTFND) ----------------------------------------
  // EVALUATE WS-RESP-CD WHEN DFHRESP(NOTFND) (COSGN00C:247-251).
  if (userRow === null) {
    return { ok: false, error: 'User not found. Try again ...' };
  }

  // --- AUTH-09: password comparison --------------------------------------------------
  // IF SEC-USR-PWD = WS-USER-PWD (COSGN00C:223). PLAIN-TEXT comparison, UPPER vs UPPER.
  // D-03: NOT applied here as an adaptation (no hashing) — the recommended target is
  //       adapting (hashing + throttling + audit) but that requires a change to the
  //       `users` schema (password stored in plain text in seed.sql). As long as storage
  //       stays in plain text, we reproduce the plain-text comparison to stay consistent
  //       with the data and the parity cases. The D-03 remediation (hashing) belongs to a
  //       dedicated decision/data migration, outside this login module.
  // PARITY: plain-text password comparison reproduced (see D-03); no attempt limit /
  //         lockout / audit — not silently added.
  // The stored password is assumed to be already uppercase; we compare the uppercased
  // input to the raw stored value, as the COBOL does (it does not re-uppercase
  // SEC-USR-PWD, only the input).
  if (userRow.password !== passwordUpper) {
    return { ok: false, error: 'Wrong Password. Try again ...' };
  }

  // --- AUTH-10: admin vs user routing ------------------------------------------------
  // IF CDEMO-USRTYP-ADMIN (SEC-USR-TYPE = 'A') XCTL COADM01C ELSE XCTL COMEN01C (COSGN00C:230-240).
  // D-06: applied -> option (a) "default = standard": only 'A' routes to admin;
  //       ANY other type (including an unknown value other than 'A'/'U') falls into the ELSE
  //       and gets the user menu. An unknown type is not rejected.
  // PARITY: "admin otherwise everything else" reproduced (see D-06).
  // NB: the user_type column is typed 'A' | 'U' at the TS level (db.ts) — any aberrant
  //     type from the mainframe source is therefore already normalized upstream by the D1 schema.
  const isAdmin = userRow.user_type === 'A';
  const userType: 'A' | 'U' = isAdmin ? 'A' : 'U';
  const dest = isAdmin ? DEST_ADMIN : DEST_USER;

  // AUTH-11: the handler will populate the CommArea (userId=userKey, userType, fromTranId='CC00',
  // fromProgram='COSGN00C', pgmContext=0) from this result before the redirect.
  return { ok: true, userType, dest };
}
