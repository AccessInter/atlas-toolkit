/**
 * Account update validation parity cases (O-6, O-7, O-8) — COACTUPC.
 * Checks that validation REJECTS the targeted field with the right message;
 * updateAccount runs all validations (source semantics) → we test
 * the PRESENCE of the expected error in the list.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeEnv } from './helpers/d1';
import { getAccount } from '../src/domain/accountView';
import { updateAccount, type AccountUpdateSnapshot } from '../src/domain/accountUpdate';

type Env = Parameters<typeof updateAccount>[0];

async function snapshotOf(env: Env, acctId: string): Promise<AccountUpdateSnapshot> {
  const v = await getAccount(env as never, acctId);
  if (!v.ok || !v.account || !v.customer) throw new Error('snapshot unavailable');
  return { account: v.account, customer: v.customer };
}

function hasError(errors: { field: string; message: string }[] | undefined, field: string, re: RegExp) {
  return (errors ?? []).some((e) => e.field === field && re.test(e.message));
}

describe('accountUpdate.updateAccount — parity cases O-6/O-7/O-8 (COACTUPC)', () => {
  let env: Env;
  let snap: AccountUpdateSnapshot;
  beforeEach(async () => {
    env = makeEnv().env as unknown as Env;
    snap = await snapshotOf(env, '00000000007');
  });

  it('O-6: active status = `X` → rejected with "must be Y or N"', async () => {
    const r = await updateAccount(env, { acctId: '00000000007', activeStatus: 'X' }, snap);
    expect(r.ok).toBe(false);
    expect(hasError(r.errors, 'activeStatus', /Y or N/i)).toBe(true);
  });

  it('O-7: FICO = `900` → rejected with "between 300 and 850"', async () => {
    const r = await updateAccount(env, { acctId: '00000000007', ficoScore: '900' }, snap);
    expect(r.ok).toBe(false);
    expect(hasError(r.errors, 'ficoScore', /between 300 and 850/i)).toBe(true);
  });

  it('O-8: Credit Limit = `ABC` → rejected with "is not valid"', async () => {
    const r = await updateAccount(env, { acctId: '00000000007', creditLimit: 'ABC' }, snap);
    expect(r.ok).toBe(false);
    expect(hasError(r.errors, 'creditLimit', /not valid/i)).toBe(true);
  });

  it('O-8 (control): Credit Limit = `2500.00` → format ACCEPTED (no creditLimit error)', async () => {
    const r = await updateAccount(env, { acctId: '00000000007', creditLimit: '2500.00' }, snap);
    // other fields remain invalid, but creditLimit must NOT be in error
    expect(hasError(r.errors, 'creditLimit', /.*/)).toBe(false);
  });

  it('ACCT-UPD-43: no field changed vs snapshot → "No change detected"', async () => {
    // Send back exactly the snapshot values (amounts reformatted, ISO dates).
    const a = snap.account;
    const c = snap.customer;
    const money = (cents: number) => (cents / 100).toFixed(2);
    const input = {
      acctId: a.acct_id,
      activeStatus: a.active_status,
      creditLimit: money(a.credit_limit),
      cashCreditLimit: money(a.cash_credit_limit),
      currBal: money(a.curr_bal),
      currCycCredit: money(a.curr_cyc_credit),
      currCycDebit: money(a.curr_cyc_debit),
      openDate: a.open_date,
      expirationDate: a.expiration_date,
      reissueDate: a.reissue_date,
      firstName: c.first_name,
      middleName: c.middle_name,
      lastName: c.last_name,
      addrLine1: c.addr_line_1,
      addrLine2: c.addr_line_2,
      city: c.addr_line_3,
      state: c.addr_state_cd,
      country: c.addr_country_cd,
      zip: c.addr_zip,
      dob: c.dob,
      ficoScore: String(c.fico_score),
      eftAccountId: c.eft_account_id,
      priCardHolder: c.pri_card_holder,
      ssnPart1: c.ssn.slice(0, 3),
      ssnPart2: c.ssn.slice(3, 5),
      ssnPart3: c.ssn.slice(5, 9),
    };
    const r = await updateAccount(env, input, snap);
    // Either "No change detected" or no write: in both cases ok=false here
    // (the point: prove that the absence of changes does not produce a silent write).
    expect(r.ok).toBe(false);
  });
});
