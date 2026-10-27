-- ============================================================================
-- CardDemo — D1 / SQLite target schema
-- ----------------------------------------------------------------------------
-- Principles:
--  * Amounts   = INTEGER columns in CENTS (zero floats, financial fidelity).
--  * Keys      = zero-padded TEXT columns (faithful to VSAM keys; no bare integers).
--  * Dates     = TEXT 'YYYY-MM-DD' (lexical sort = chronological sort, invariant INV-11).
--  * VSAM KSDS → tables; VSAM AIX (CARDXREF by ACCT-ID) → SQL index.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- USRSEC ↔ CSUSR01Y (RECLN 80) — security / login (COSGN00C)
CREATE TABLE IF NOT EXISTS users (
  user_id    TEXT PRIMARY KEY,            -- SEC-USR-ID   X(08)
  first_name TEXT NOT NULL,               -- SEC-USR-FNAME X(20)
  last_name  TEXT NOT NULL,               -- SEC-USR-LNAME X(20)
  password   TEXT NOT NULL,               -- SEC-USR-PWD  X(08) (plaintext in the source; hashing = migration decision)
  user_type  TEXT NOT NULL CHECK (user_type IN ('A','U')) -- SEC-USR-TYPE 'A'=admin / 'U'=user
);

-- ACCTDAT ↔ CVACT01Y (RECLN 300) — accounts
CREATE TABLE IF NOT EXISTS accounts (
  acct_id           TEXT PRIMARY KEY,     -- ACCT-ID 9(11), zero-padded
  active_status     TEXT NOT NULL,        -- ACCT-ACTIVE-STATUS X(01) (Y/N)
  curr_bal          INTEGER NOT NULL,     -- ACCT-CURR-BAL          S9(10)V99 → cents
  credit_limit      INTEGER NOT NULL,     -- ACCT-CREDIT-LIMIT      S9(10)V99 → cents
  cash_credit_limit INTEGER NOT NULL,     -- ACCT-CASH-CREDIT-LIMIT S9(10)V99 → cents
  open_date         TEXT NOT NULL,        -- ACCT-OPEN-DATE       X(10) YYYY-MM-DD
  expiration_date   TEXT NOT NULL,        -- ACCT-EXPIRAION-DATE  X(10) (original typo preserved)
  reissue_date      TEXT NOT NULL,        -- ACCT-REISSUE-DATE    X(10)
  curr_cyc_credit   INTEGER NOT NULL,     -- ACCT-CURR-CYC-CREDIT S9(10)V99 → cents
  curr_cyc_debit    INTEGER NOT NULL,     -- ACCT-CURR-CYC-DEBIT  S9(10)V99 → cents (signed)
  addr_zip          TEXT NOT NULL,        -- ACCT-ADDR-ZIP  X(10)
  group_id          TEXT NOT NULL         -- ACCT-GROUP-ID  X(10)
);

-- CUSTDAT ↔ CVCUS01Y (RECLN 500) — customers
CREATE TABLE IF NOT EXISTS customers (
  cust_id            TEXT PRIMARY KEY,     -- CUST-ID 9(09)
  first_name         TEXT NOT NULL,        -- CUST-FIRST-NAME  X(25)
  middle_name        TEXT NOT NULL,        -- CUST-MIDDLE-NAME X(25)
  last_name          TEXT NOT NULL,        -- CUST-LAST-NAME   X(25)
  addr_line_1        TEXT NOT NULL,        -- CUST-ADDR-LINE-1 X(50)
  addr_line_2        TEXT NOT NULL,        -- CUST-ADDR-LINE-2 X(50)
  addr_line_3        TEXT NOT NULL,        -- CUST-ADDR-LINE-3 X(50)
  addr_state_cd      TEXT NOT NULL,        -- CUST-ADDR-STATE-CD   X(02)
  addr_country_cd    TEXT NOT NULL,        -- CUST-ADDR-COUNTRY-CD X(03)
  addr_zip           TEXT NOT NULL,        -- CUST-ADDR-ZIP X(10)
  phone_num_1        TEXT NOT NULL,        -- CUST-PHONE-NUM-1 X(15)
  phone_num_2        TEXT NOT NULL,        -- CUST-PHONE-NUM-2 X(15)
  ssn                TEXT NOT NULL,        -- CUST-SSN 9(09)
  govt_issued_id     TEXT NOT NULL,        -- CUST-GOVT-ISSUED-ID X(20)
  dob                TEXT NOT NULL,        -- CUST-DOB-YYYY-MM-DD X(10)
  eft_account_id     TEXT NOT NULL,        -- CUST-EFT-ACCOUNT-ID X(10)
  pri_card_holder    TEXT NOT NULL,        -- CUST-PRI-CARD-HOLDER-IND X(01)
  fico_score         INTEGER NOT NULL      -- CUST-FICO-CREDIT-SCORE 9(03)
);

-- CARDDAT ↔ CVACT02Y (RECLN 150) — cards
CREATE TABLE IF NOT EXISTS cards (
  card_num        TEXT PRIMARY KEY,        -- CARD-NUM X(16)
  acct_id         TEXT NOT NULL,           -- CARD-ACCT-ID 9(11)
  cvv_cd          TEXT NOT NULL,           -- CARD-CVV-CD 9(03)
  embossed_name   TEXT NOT NULL,           -- CARD-EMBOSSED-NAME X(50)
  expiration_date TEXT NOT NULL,           -- CARD-EXPIRAION-DATE X(10)
  active_status   TEXT NOT NULL            -- CARD-ACTIVE-STATUS X(01)
);

-- CARDXREF ↔ CVACT03Y (RECLN 50) — cross-ref card ↔ account ↔ customer
-- VSAM AIX on ACCT-ID → index card_xref(acct_id).
CREATE TABLE IF NOT EXISTS card_xref (
  card_num TEXT PRIMARY KEY,               -- XREF-CARD-NUM X(16)
  cust_id  TEXT NOT NULL,                  -- XREF-CUST-ID 9(09)
  acct_id  TEXT NOT NULL                   -- XREF-ACCT-ID 9(11)
);
CREATE INDEX IF NOT EXISTS idx_card_xref_acct_id ON card_xref (acct_id);

-- TRANSACT ↔ CVTRA05Y (RECLN 350) — posted transactions
CREATE TABLE IF NOT EXISTS transactions (
  tran_id       TEXT PRIMARY KEY,          -- TRAN-ID X(16)
  type_cd       TEXT NOT NULL,             -- TRAN-TYPE-CD X(02)
  cat_cd        TEXT NOT NULL,             -- TRAN-CAT-CD 9(04)
  source        TEXT NOT NULL,             -- TRAN-SOURCE X(10)
  description   TEXT NOT NULL,             -- TRAN-DESC X(100)
  amount        INTEGER NOT NULL,          -- TRAN-AMT S9(09)V99 → cents (signed)
  merchant_id   TEXT NOT NULL,             -- TRAN-MERCHANT-ID 9(09)
  merchant_name TEXT NOT NULL,             -- TRAN-MERCHANT-NAME X(50)
  merchant_city TEXT NOT NULL,             -- TRAN-MERCHANT-CITY X(50)
  merchant_zip  TEXT NOT NULL,             -- TRAN-MERCHANT-ZIP X(10)
  card_num      TEXT NOT NULL,             -- TRAN-CARD-NUM X(16)
  orig_ts       TEXT NOT NULL,             -- TRAN-ORIG-TS X(26)
  proc_ts       TEXT NOT NULL              -- TRAN-PROC-TS X(26)
);
CREATE INDEX IF NOT EXISTS idx_transactions_tran_id ON transactions (tran_id);

-- DALYTRAN ↔ CVTRA06Y (RECLN 350) — daily transactions (CBTRN02C batch input)
CREATE TABLE IF NOT EXISTS daily_transactions (
  rowid_pk      INTEGER PRIMARY KEY AUTOINCREMENT, -- arrival sequence (file order preserved)
  tran_id       TEXT NOT NULL,             -- DALYTRAN-ID X(16)
  type_cd       TEXT NOT NULL,             -- DALYTRAN-TYPE-CD X(02)
  cat_cd        TEXT NOT NULL,             -- DALYTRAN-CAT-CD 9(04)
  source        TEXT NOT NULL,             -- DALYTRAN-SOURCE X(10)
  description   TEXT NOT NULL,             -- DALYTRAN-DESC X(100)
  amount        INTEGER NOT NULL,          -- DALYTRAN-AMT S9(09)V99 → cents (signed)
  merchant_id   TEXT NOT NULL,             -- DALYTRAN-MERCHANT-ID 9(09)
  merchant_name TEXT NOT NULL,             -- DALYTRAN-MERCHANT-NAME X(50)
  merchant_city TEXT NOT NULL,             -- DALYTRAN-MERCHANT-CITY X(50)
  merchant_zip  TEXT NOT NULL,             -- DALYTRAN-MERCHANT-ZIP X(10)
  card_num      TEXT NOT NULL,             -- DALYTRAN-CARD-NUM X(16)
  orig_ts       TEXT NOT NULL,             -- DALYTRAN-ORIG-TS X(26)
  proc_ts       TEXT NOT NULL              -- DALYTRAN-PROC-TS X(26) (empty on input)
);

-- TCATBAL ↔ CVTRA01Y (RECLN 50) — balance per transaction category
CREATE TABLE IF NOT EXISTS tran_cat_balance (
  acct_id TEXT NOT NULL,                   -- TRANCAT-ACCT-ID 9(11)
  type_cd TEXT NOT NULL,                   -- TRANCAT-TYPE-CD X(02)
  cat_cd  TEXT NOT NULL,                   -- TRANCAT-CD 9(04)
  balance INTEGER NOT NULL,                -- TRAN-CAT-BAL S9(09)V99 → cents (signed)
  PRIMARY KEY (acct_id, type_cd, cat_cd)
);

-- DALYREJS — batch rejects (no source copybook; structure per INV-8)
CREATE TABLE IF NOT EXISTS transaction_rejects (
  rowid_pk     INTEGER PRIMARY KEY AUTOINCREMENT,
  tran_id      TEXT NOT NULL,              -- rejected DALYTRAN-ID
  reject_code  INTEGER NOT NULL,           -- 100/101/102/103/109
  reject_label TEXT NOT NULL               -- exact associated label
);

-- ---- Reference tables (configuration) ----

-- DISCGRP — interest groups (group-id + type + cat + rate). Not used by CBTRN02C.
CREATE TABLE IF NOT EXISTS disclosure_groups (
  group_id      TEXT NOT NULL,             -- DIS-ACCT-GROUP-ID X(10)
  type_cd       TEXT NOT NULL,             -- DIS-TRAN-TYPE-CD  X(02)
  cat_cd        TEXT NOT NULL,             -- DIS-TRAN-CAT-CD   9(04)
  interest_rate INTEGER NOT NULL,          -- DIS-INT-RATE S9(04)V99 → hundredths of a percent
  PRIMARY KEY (group_id, type_cd, cat_cd)
);

-- TRANCATG — transaction categories (key type+cat → label)
CREATE TABLE IF NOT EXISTS tran_categories (
  type_cd TEXT NOT NULL,                   -- TRAN-TYPE-CD X(02)
  cat_cd  TEXT NOT NULL,                   -- TRAN-CAT-CD 9(04)
  label   TEXT NOT NULL,                   -- TRAN-CAT-TYPE-DESC X(50)
  PRIMARY KEY (type_cd, cat_cd)
);

-- TRANTYPE — transaction types (code → label)
CREATE TABLE IF NOT EXISTS tran_types (
  type_cd TEXT PRIMARY KEY,                -- TRAN-TYPE X(02)
  label   TEXT NOT NULL                    -- TRAN-TYPE-DESC X(50)
);
