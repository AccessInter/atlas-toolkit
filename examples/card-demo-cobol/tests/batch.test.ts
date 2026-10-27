/**
 * CRITICAL parity case O-9 + O-10 + synthetic O-11 + financial invariants.
 * CBTRN02C batch posting. Everything in CENTS (integers) — no floating-point tolerance.
 */
import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { makeEnv, queryOne, queryAll } from './helpers/d1';
import { postDailyBatch } from '../src/batch/postTransactions';

type Env = Parameters<typeof postDailyBatch>[0];

interface AcctRow {
  acct_id: string;
  curr_bal: number;
  curr_cyc_credit: number;
  curr_cyc_debit: number;
}

describe('postDailyBatch — parity case O-9 (account 00000000007)', () => {
  it('exact final state of account 7: bal 900.21, cyc-cred 1287.09, cyc-deb -579.88', async () => {
    const { env, raw } = makeEnv();
    const res = await postDailyBatch(env as unknown as Env);

    expect(res.processed).toBe(300); // 300 daily transactions read
    expect(res.returnCode).toBe(4); // INV-10: at least one reject (overlimit)

    const a = queryOne<AcctRow>(raw, 'SELECT * FROM accounts WHERE acct_id = ?', '00000000007')!;
    expect(a.curr_bal).toBe(90021); // 900.21
    expect(a.curr_cyc_credit).toBe(128709); // 1287.09 (504.77+428.33+319.00+34.99)
    expect(a.curr_cyc_debit).toBe(-57988); // -579.88 (the only negative one posted)
  });

  it('O-9 TCATBAL : (7,01,0001)=1287.09 and (7,03,0001)=-579.88', async () => {
    const { env, raw } = makeEnv();
    await postDailyBatch(env as unknown as Env);

    const c01 = queryOne<{ balance: number }>(
      raw,
      'SELECT balance FROM tran_cat_balance WHERE acct_id=? AND type_cd=? AND cat_cd=?',
      '00000000007', '01', '0001',
    )!;
    const c03 = queryOne<{ balance: number }>(
      raw,
      'SELECT balance FROM tran_cat_balance WHERE acct_id=? AND type_cd=? AND cat_cd=?',
      '00000000007', '03', '0001',
    )!;
    expect(c01.balance).toBe(128709);
    expect(c03.balance).toBe(-57988);
  });

  it('O-9 reject: id 0000000502617711 → code 102 OVERLIMIT (only reject expected on account 7)', async () => {
    const { env, raw } = makeEnv();
    await postDailyBatch(env as unknown as Env);

    const rej = queryOne<{ reject_code: number; reject_label: string }>(
      raw,
      'SELECT reject_code, reject_label FROM transaction_rejects WHERE tran_id = ?',
      '0000000502617711',
    )!;
    expect(rej.reject_code).toBe(102);
    expect(rej.reject_label).toBe('OVERLIMIT TRANSACTION');

    // 5 of the 6 transactions of account 7 are posted (#4 is rejected).
    const posted7 = queryAll(
      raw,
      `SELECT t.tran_id FROM transactions t
        JOIN card_xref x ON t.card_num = x.card_num
       WHERE x.acct_id = ?`,
      '00000000007',
    );
    expect(posted7.length).toBe(5);
  });

  it('O-9 point (c): reject #4 does not change the totals → #5 and #6 go through', async () => {
    // Already proven by the final state (cyc-credit includes 319.00 and 34.99). We reconfirm
    // that these two transactions are indeed posted despite the preceding reject.
    const { env, raw } = makeEnv();
    await postDailyBatch(env as unknown as Env);
    for (const id of ['0000000781512834', '0000000821287727']) {
      const t = queryOne(raw, 'SELECT tran_id FROM transactions WHERE tran_id = ?', id);
      expect(t).not.toBeNull();
    }
  });
});

describe('postDailyBatch — global financial invariants (INV-3/6/9/10) + O-10', () => {
  it('INV-3: for EACH account, Δbal = Σ(posted amounts) — covers O-10 (account 1)', async () => {
    const { env, raw } = makeEnv();

    const balBefore = sumByAcctBal(raw);
    const postedBefore = sumPostedByAcct(raw);

    await postDailyBatch(env as unknown as Env);

    const balAfter = sumByAcctBal(raw);
    const postedAfter = sumPostedByAcct(raw);

    const accts = queryAll<{ acct_id: string }>(raw, 'SELECT acct_id FROM accounts');
    for (const { acct_id } of accts) {
      const dBal = (balAfter.get(acct_id) ?? 0) - (balBefore.get(acct_id) ?? 0);
      const dPosted = (postedAfter.get(acct_id) ?? 0) - (postedBefore.get(acct_id) ?? 0);
      expect(dBal).toBe(dPosted); // EXACT equality in cents (INV-3)
    }
  });

  it('INV-6: count(daily) = count(posted in this batch) + count(rejects in this batch)', async () => {
    const { env, raw } = makeEnv();
    const txBefore = countTx(raw);
    const rjBefore = countRej(raw);
    const daily = countDaily(raw);

    const res = await postDailyBatch(env as unknown as Env);

    const posted = countTx(raw) - txBefore;
    const rejected = countRej(raw) - rjBefore;
    expect(posted + rejected).toBe(daily);
    expect(posted).toBe(res.posted);
    expect(rejected).toBe(res.rejected);
  });

  it('INV-8/INV-10: every reject ∈ {100,101,102,103} and returnCode=4 ⇔ rejects>0', async () => {
    const { env, raw } = makeEnv();
    const res = await postDailyBatch(env as unknown as Env);
    const codes = queryAll<{ reject_code: number }>(raw, 'SELECT reject_code FROM transaction_rejects');
    for (const { reject_code } of codes) {
      expect([100, 101, 102, 103]).toContain(reject_code);
    }
    expect(res.returnCode).toBe(res.rejected > 0 ? 4 : 0);
  });

  it('INV-9: all posted amounts are integers (cents) — no floats', async () => {
    const { env, raw } = makeEnv();
    await postDailyBatch(env as unknown as Env);
    const amts = queryAll<{ amount: number }>(raw, 'SELECT amount FROM transactions');
    for (const { amount } of amts) {
      expect(Number.isInteger(amount)).toBe(true);
    }
  });
});

describe('postDailyBatch — synthetic O-11 (reject 103 expiration + RG-08 last reason)', () => {
  it('forced expiration < orig date → 103, and overlimit #4 becomes 103 (102 overwritten)', async () => {
    const { env, raw } = makeEnv();
    // Force account 7's expiration BEFORE the transactions' orig date (2022-06-10).
    raw.exec("UPDATE accounts SET expiration_date='2020-01-01' WHERE acct_id='00000000007'");

    await postDailyBatch(env as unknown as Env);

    // RG-08: #4 is BOTH overlimit (102) AND expired (103) → 103 wins (last reason).
    const rej4 = queryOne<{ reject_code: number }>(
      raw,
      'SELECT reject_code FROM transaction_rejects WHERE tran_id = ?',
      '0000000502617711',
    )!;
    expect(rej4.reject_code).toBe(103);

    // At least one 103 reject emitted with the right label.
    const r103 = queryOne<{ reject_label: string }>(
      raw,
      "SELECT reject_label FROM transaction_rejects WHERE reject_code=103 LIMIT 1",
    )!;
    expect(r103.reject_label).toBe('TRANSACTION RECEIVED AFTER ACCT EXPIRATION');
  });
});

/* ---------- verification helpers (on the raw database) ---------- */

function sumByAcctBal(raw: DatabaseSync): Map<string, number> {
  const rows = queryAll<{ acct_id: string; curr_bal: number }>(
    raw,
    'SELECT acct_id, curr_bal FROM accounts',
  );
  return new Map(rows.map((r) => [r.acct_id, r.curr_bal]));
}

function sumPostedByAcct(raw: DatabaseSync): Map<string, number> {
  const rows = queryAll<{ acct_id: string; s: number }>(
    raw,
    `SELECT x.acct_id AS acct_id, COALESCE(SUM(t.amount),0) AS s
       FROM transactions t JOIN card_xref x ON t.card_num = x.card_num
      GROUP BY x.acct_id`,
  );
  return new Map(rows.map((r) => [r.acct_id, r.s]));
}

const countTx = (raw: DatabaseSync) =>
  queryOne<{ n: number }>(raw, 'SELECT COUNT(*) AS n FROM transactions')!.n;
const countRej = (raw: DatabaseSync) =>
  queryOne<{ n: number }>(raw, 'SELECT COUNT(*) AS n FROM transaction_rejects')!.n;
const countDaily = (raw: DatabaseSync) =>
  queryOne<{ n: number }>(raw, 'SELECT COUNT(*) AS n FROM daily_transactions')!.n;
