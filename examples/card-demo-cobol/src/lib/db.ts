/**
 * Typed helpers around Cloudflare D1 (SQLite).
 *
 * Goal: centralize D1 access so that the `domain/*` and `batch/*` modules
 * never touch the raw D1 API. The Row types mirror the schema
 * (schema.sql): amounts as INTEGER (cents), keys as zero-padded TEXT.
 */

/// <reference types="@cloudflare/workers-types" />

/** Bindings Worker. */
export interface Env {
  DB: D1Database;
}

/* ------------------------------------------------------------------ */
/* Row types (1:1 with schema.sql; INTEGER = cents for amounts)        */
/* ------------------------------------------------------------------ */

export interface UserRow {
  user_id: string;
  first_name: string;
  last_name: string;
  password: string;
  user_type: 'A' | 'U';
}

export interface AccountRow {
  acct_id: string;
  active_status: string;
  curr_bal: number;
  credit_limit: number;
  cash_credit_limit: number;
  open_date: string;
  expiration_date: string;
  reissue_date: string;
  curr_cyc_credit: number;
  curr_cyc_debit: number;
  addr_zip: string;
  group_id: string;
}

export interface CustomerRow {
  cust_id: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  addr_line_1: string;
  addr_line_2: string;
  addr_line_3: string;
  addr_state_cd: string;
  addr_country_cd: string;
  addr_zip: string;
  phone_num_1: string;
  phone_num_2: string;
  ssn: string;
  govt_issued_id: string;
  dob: string;
  eft_account_id: string;
  pri_card_holder: string;
  fico_score: number;
}

export interface CardRow {
  card_num: string;
  acct_id: string;
  cvv_cd: string;
  embossed_name: string;
  expiration_date: string;
  active_status: string;
}

export interface CardXrefRow {
  card_num: string;
  cust_id: string;
  acct_id: string;
}

export interface TransactionRow {
  tran_id: string;
  type_cd: string;
  cat_cd: string;
  source: string;
  description: string;
  amount: number;
  merchant_id: string;
  merchant_name: string;
  merchant_city: string;
  merchant_zip: string;
  card_num: string;
  orig_ts: string;
  proc_ts: string;
}

export interface DailyTransactionRow {
  rowid_pk: number;
  tran_id: string;
  type_cd: string;
  cat_cd: string;
  source: string;
  description: string;
  amount: number;
  merchant_id: string;
  merchant_name: string;
  merchant_city: string;
  merchant_zip: string;
  card_num: string;
  orig_ts: string;
  proc_ts: string;
}

export interface TranCatBalanceRow {
  acct_id: string;
  type_cd: string;
  cat_cd: string;
  balance: number;
}

export interface TransactionRejectRow {
  rowid_pk: number;
  tran_id: string;
  reject_code: number;
  reject_label: string;
}

export interface DisclosureGroupRow {
  group_id: string;
  type_cd: string;
  cat_cd: string;
  interest_rate: number;
}

export interface TranCategoryRow {
  type_cd: string;
  cat_cd: string;
  label: string;
}

export interface TranTypeRow {
  type_cd: string;
  label: string;
}

/* ------------------------------------------------------------------ */
/* Generic helpers                                                     */
/* ------------------------------------------------------------------ */

type BindValue = string | number | null;

/**
 * First row of a query, or null if there is none.
 * Faithful equivalent of a VSAM READ by key (NOTFND → null).
 */
export async function get<T>(
  db: D1Database,
  sql: string,
  ...params: BindValue[]
): Promise<T | null> {
  const result = await db
    .prepare(sql)
    .bind(...params)
    .first<T>();
  return result ?? null;
}

/**
 * All rows of a query (array, never null).
 * Supports browse/pagination (STARTBR/READNEXT → ORDER BY … LIMIT).
 */
export async function all<T>(
  db: D1Database,
  sql: string,
  ...params: BindValue[]
): Promise<T[]> {
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<T>();
  return result.results ?? [];
}

/**
 * Runs a write query (INSERT/UPDATE/DELETE) and returns the metadata.
 */
export async function run(
  db: D1Database,
  sql: string,
  ...params: BindValue[]
): Promise<D1Result> {
  return db
    .prepare(sql)
    .bind(...params)
    .run();
}

/**
 * Runs several statements as an atomic batch (D1 batch = implicit transaction).
 * Used by batch posting (CBTRN02C), where several writes must stay consistent.
 */
export async function batch(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<D1Result[]> {
  return db.batch(statements);
}
