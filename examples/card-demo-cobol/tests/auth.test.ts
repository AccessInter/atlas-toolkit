/**
 * Login parity cases (O-1, O-2, O-3) — COSGN00C.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeEnv } from './helpers/d1';
import { login } from '../src/domain/auth';

type Env = Parameters<typeof login>[0];

describe('auth.login — parity cases O-1/O-2/O-3 (COSGN00C)', () => {
  let env: Env;
  beforeEach(() => {
    env = makeEnv().env as unknown as Env;
  });

  it('O-1: ADMIN001 / PASSWORD → OK, type A, admin menu (COADM01C)', async () => {
    const r = await login(env, 'ADMIN001', 'PASSWORD');
    expect(r.ok).toBe(true);
    expect(r.userType).toBe('A');
    expect(r.dest).toBe('COADM01C');
  });

  it('O-2: USER0001 / PASSWORD → OK, type U, user menu (COMEN01C)', async () => {
    const r = await login(env, 'USER0001', 'PASSWORD');
    expect(r.ok).toBe(true);
    expect(r.userType).toBe('U');
    expect(r.dest).toBe('COMEN01C');
  });

  it('O-3: ADMIN001 / WRONG123 → rejected (wrong password)', async () => {
    const r = await login(env, 'ADMIN001', 'WRONG123');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Wrong Password/i);
  });

  it('AUTH-05: empty User ID → "Please enter User ID"', async () => {
    const r = await login(env, '', 'PASSWORD');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/User ID/i);
  });

  it('AUTH-12: unknown user → "User not found"', async () => {
    const r = await login(env, 'NOBODY99', 'PASSWORD');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  it('D-02: password is case-insensitive (faithful to the source UPPER-CASE bug)', async () => {
    // The COBOL uppercases the input; "password" becomes "PASSWORD" → OK.
    const r = await login(env, 'admin001', 'password');
    expect(r.ok).toBe(true);
    expect(r.userType).toBe('A');
  });
});
