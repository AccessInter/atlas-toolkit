/**
 * Account view parity cases (O-4, O-5) — COACTVWC.
 * Amounts checked in CENTS (integers) — never floats (INV-9 / D-01).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeEnv } from './helpers/d1';
import { getAccount } from '../src/domain/accountView';

type Env = Parameters<typeof getAccount>[0];

describe('accountView.getAccount — parity cases O-4/O-5 (COACTVWC)', () => {
  let env: Env;
  beforeEach(() => {
    env = makeEnv().env as unknown as Env;
  });

  it('O-4: account 00000000001 → full xref→account→customer chain', async () => {
    const r = await getAccount(env, '00000000001');
    expect(r.ok).toBe(true);
    expect(r.account?.active_status).toBe('Y');
    expect(r.account?.curr_bal).toBe(19400); // 194.00
    expect(r.account?.credit_limit).toBe(202000); // 2020.00
    expect(r.account?.cash_credit_limit).toBe(102000); // 1020.00
    expect(r.account?.curr_cyc_credit).toBe(0);
    expect(r.account?.curr_cyc_debit).toBe(0);
    expect(r.account?.expiration_date).toBe('2025-05-20');
    expect(r.customer?.cust_id).toBe('000000001');
    expect(r.customer?.first_name.trim()).toBe('Immanuel');
  });

  it('O-5: account 00000000007 (state BEFORE batch)', async () => {
    const r = await getAccount(env, '00000000007');
    expect(r.ok).toBe(true);
    expect(r.account?.active_status).toBe('Y');
    expect(r.account?.curr_bal).toBe(19300); // 193.00
    expect(r.account?.credit_limit).toBe(206500); // 2065.00
    expect(r.account?.curr_cyc_credit).toBe(0);
    expect(r.account?.curr_cyc_debit).toBe(0);
    expect(r.account?.expiration_date).toBe('2024-12-13');
    expect(r.customer?.cust_id).toBe('000000007');
  });

  it('ACCT-VIEW-02: account number not provided → error', async () => {
    const r = await getAccount(env, '');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not provided/i);
  });

  it('ACCT-VIEW-09: account missing from xref → xref error', async () => {
    const r = await getAccount(env, '99999999999');
    expect(r.ok).toBe(false);
    expect(r.notFound).toBe('xref');
  });
});
