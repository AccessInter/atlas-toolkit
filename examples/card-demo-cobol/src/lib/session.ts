/**
 * HTTP navigation state — equivalent of the CICS COMMAREA `COCOM01Y`
 * (CARDDEMO-COMMAREA). In CICS, the COMMAREA carries state between programs
 * (XCTL). Here it becomes a serialized session state (cookie or header),
 * carried between Hono requests.
 *
 * Mapping COCOM01Y → CommArea:
 *   CDEMO-FROM-TRANID/PROGRAM, CDEMO-TO-TRANID/PROGRAM → from/to (navigation)
 *   CDEMO-USER-ID    X(08)  → userId
 *   CDEMO-USER-TYPE  X(01)  → userType ('A' admin / 'U' user ; 88-levels)
 *   CDEMO-PGM-CONTEXT 9(01) → pgmContext (0=ENTER / 1=REENTER)
 *   CDEMO-CUST-ID/FNAME/MNAME/LNAME → cust*
 *   CDEMO-ACCT-ID/STATUS            → acctId / acctStatus
 *   CDEMO-CARD-NUM                  → cardNum
 *   CDEMO-LAST-MAP/MAPSET           → lastMap / lastMapset
 */

export type UserType = 'A' | 'U';

/** 0 = ENTER (first pass), 1 = REENTER (re-entry into the program). */
export type PgmContext = 0 | 1;

export interface CommArea {
  /** CDEMO-GENERAL-INFO */
  fromTranId: string; // X(04)
  fromProgram: string; // X(08)
  toTranId: string; // X(04)
  toProgram: string; // X(08)
  userId: string; // X(08)
  userType: UserType; // X(01): 'A'=admin, 'U'=user
  pgmContext: PgmContext; // 9(01)
  /** CDEMO-CUSTOMER-INFO */
  custId: string; // 9(09)
  custFName: string; // X(25)
  custMName: string; // X(25)
  custLName: string; // X(25)
  /** CDEMO-ACCOUNT-INFO */
  acctId: string; // 9(11)
  acctStatus: string; // X(01)
  /** CDEMO-CARD-INFO */
  cardNum: string; // 9(16)
  /** CDEMO-MORE-INFO */
  lastMap: string; // X(7)
  lastMapset: string; // X(7)
}

/** 88-level CDEMO-USRTYP-ADMIN. */
export function isAdmin(comm: CommArea): boolean {
  return comm.userType === 'A';
}

/** 88-level CDEMO-USRTYP-USER. */
export function isUser(comm: CommArea): boolean {
  return comm.userType === 'U';
}

/** Initial COMMAREA (all fields empty) — pre-login state. */
export function emptyCommArea(): CommArea {
  return {
    fromTranId: '',
    fromProgram: '',
    toTranId: '',
    toProgram: '',
    userId: '',
    userType: 'U',
    pgmContext: 0,
    custId: '',
    custFName: '',
    custMName: '',
    custLName: '',
    acctId: '',
    acctStatus: '',
    cardNum: '',
    lastMap: '',
    lastMapset: '',
  };
}

/* ------------------------------------------------------------------ */
/* Serialization (cookie / header) — base64url of a JSON               */
/* ------------------------------------------------------------------ */

const COOKIE_NAME = 'CARDDEMO_COMMAREA';

/** Encodes a CommArea as a base64url string suitable for a cookie/header. */
export function encodeCommArea(comm: CommArea): string {
  const json = JSON.stringify(comm);
  // btoa is available in the Workers runtime.
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodes a base64url string into a CommArea. Returns an empty COMMAREA if the
 * value is missing or corrupted (equivalent to an uninitialized state → login).
 */
export function decodeCommArea(encoded: string | null | undefined): CommArea {
  if (!encoded) return emptyCommArea();
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64);
    const parsed = JSON.parse(json) as Partial<CommArea>;
    return { ...emptyCommArea(), ...parsed };
  } catch {
    return emptyCommArea();
  }
}

/** Builds the Set-Cookie header carrying the COMMAREA (HttpOnly, SameSite). */
export function commAreaSetCookie(comm: CommArea): string {
  const value = encodeCommArea(comm);
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict`;
}

/** Extracts the COMMAREA from a request's Cookie header. */
export function commAreaFromCookieHeader(cookieHeader: string | null | undefined): CommArea {
  if (!cookieHeader) return emptyCommArea();
  const match = cookieHeader.split(/;\s*/).find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return emptyCommArea();
  return decodeCommArea(match.slice(COOKIE_NAME.length + 1));
}

export { COOKIE_NAME };
