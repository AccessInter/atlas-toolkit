/**
 * Cloudflare Worker entry point — Hono wiring of the domain/batch modules.
 *
 * No global state: `env` (D1 bindings) is injected on every call.
 * This file holds NO business logic: it routes HTTP → domain/* and batch/*
 * functions, and renders a minimal demo dashboard. Parity with the COBOL source
 * (parity cases, D-xx/RG-xx rules) lives in the modules, not here.
 */

import { Hono } from 'hono';
import type { Env } from './lib/db';
import { login } from './domain/auth';
import { getAccount } from './domain/accountView';
import { updateAccount, type AccountUpdateInput } from './domain/accountUpdate';
import { addTransaction, type TxAddInput } from './domain/transactionAdd';
import { listTransactions } from './domain/transactionList';
import { formatMoney } from './lib/zoned';
import { postDailyBatch } from './batch/postTransactions';

const app = new Hono<{ Bindings: Env }>();

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

// COSGN00C — login (CC00).
app.post('/api/login', async (c) => {
  const { userId, password } = await c.req.json<{ userId?: string; password?: string }>();
  const r = await login(c.env, userId ?? '', password ?? '');
  return c.json(r, r.ok ? 200 : 401);
});

// COACTVWC — account view (CAVW). Amounts exposed both formatted (display) AND in cents.
app.get('/api/accounts/:id', async (c) => {
  const r = await getAccount(c.env, c.req.param('id'));
  if (!r.ok || !r.account) return c.json(r, 404);
  return c.json({
    ...r,
    display: {
      curr_bal: formatMoney(r.account.curr_bal),
      credit_limit: formatMoney(r.account.credit_limit),
      cash_credit_limit: formatMoney(r.account.cash_credit_limit),
      curr_cyc_credit: formatMoney(r.account.curr_cyc_credit),
      curr_cyc_debit: formatMoney(r.account.curr_cyc_debit),
    },
  });
});

// COACTUPC — account update (CAUP).
// Note: the optimistic lock (ACCT-UPD-45) compares the DISPLAYED snapshot with a re-read.
// In stateless REST the client sends back the snapshot it displayed; if absent, the
// current state is re-read as the baseline (the concurrent-change detection window is
// then narrower — an accepted limitation of a demo).
app.post('/api/accounts/:id', async (c) => {
  const body = await c.req.json<{ input: AccountUpdateInput; snapshot?: unknown }>();
  const view = await getAccount(c.env, c.req.param('id'));
  if (!view.ok || !view.account || !view.customer) {
    return c.json({ ok: false, error: 'account not found' }, 404);
  }
  const snapshot = (body.snapshot as { account: typeof view.account; customer: typeof view.customer }) ?? {
    account: view.account,
    customer: view.customer,
  };
  const r = await updateAccount(c.env, body.input, snapshot);
  return c.json(r, r.ok ? 200 : 409);
});

// COTRN02C — add transaction (CT02).
app.post('/api/transactions', async (c) => {
  const input = await c.req.json<TxAddInput>();
  const r = await addTransaction(c.env, input);
  return c.json(r, r.ok ? 201 : 400);
});

// COTRN00C — paginated list (CT00). ?startKey=&direction=forward|backward
app.get('/api/transactions', async (c) => {
  const startKey = c.req.query('startKey');
  const direction = c.req.query('direction') === 'backward' ? 'backward' : 'forward';
  // exactOptionalPropertyTypes: only set startKey when it is defined.
  const opts: { startKey?: string; direction: 'forward' | 'backward' } = { direction };
  if (startKey !== undefined) opts.startKey = startKey;
  const page = await listTransactions(c.env, opts);
  return c.json({
    ...page,
    rowsDisplay: page.rows.map((t) => ({
      tran_id: t.tran_id,
      date: t.orig_ts.slice(0, 10),
      amount: formatMoney(t.amount),
    })),
  });
});

// CBTRN02C — daily posting batch (reads the real DALYTRAN table, not ad-hoc JSON).
// Demo guard: posting writes transactions keyed by tran_id; replaying the batch on an
// already-posted dataset would violate the unique constraint. The "already posted"
// state is detected and reported instead of failing (the demo stays clickable).
// Reset and reseed the database to replay from scratch.
app.post('/api/batch/post', async (c) => {
  const already = await c.env.DB
    .prepare('SELECT COUNT(*) AS n FROM transactions')
    .first<{ n: number }>();
  if ((already?.n ?? 0) > 0) {
    return c.json({
      alreadyRun: true,
      note: 'The posting batch has already run on this dataset. Showing the resulting state.',
    });
  }
  const r = await postDailyBatch(c.env);
  return c.json(r);
});

/* ------------------------------------------------------------------ */
/* Demo dashboard (no front-end dependency)                            */
/* ------------------------------------------------------------------ */

const DASHBOARD = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5">
<meta name="theme-color" content="#1B2535">
<title>CardDemo: AWS CardDemo COBOL sample ported to TypeScript</title>
<meta name="description" content="AWS CardDemo, a COBOL/CICS/VSAM credit card sample, ported to TypeScript on Cloudflare Workers + D1: sign-on, account view, transactions and daily batch posting.">
<style>
:root{--navy:#1B2535;--navy2:#24314A;--accent:#4EC8E0;--accent2:#7AD8EA;--bg:#F8F9FA;--card:#fff;--text:#1B2535;--muted:#5A6378;--bd:rgba(27,37,53,.12);--ok:#1e9e6a;--ko:#d1495b}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:#1a7f94;text-decoration:none}a:hover{text-decoration:underline}
.hero{background:linear-gradient(135deg,var(--navy),var(--navy2));color:#fff;padding:46px 20px 54px}
.wrap{max-width:1000px;margin:0 auto}
.brand{font-weight:700;letter-spacing:.4px;margin-bottom:20px;font-size:13px;color:var(--accent2)}
h1{font-size:clamp(26px,4.5vw,40px);font-weight:800;letter-spacing:-.02em;margin:0 0 12px;line-height:1.15}h1 .accent{color:var(--accent)}
.lede{font-size:clamp(15px,2vw,17px);color:rgba(255,255,255,.85);max-width:720px;margin:0}
.stats{display:flex;flex-wrap:wrap;gap:6px 22px;margin-top:22px;font-size:13px;color:rgba(255,255,255,.72)}.stats strong{color:var(--accent);font-weight:700}
.section{max-width:1000px;margin:0 auto;padding:38px 20px 8px}h2{font-size:21px;font-weight:700;margin:0 0 6px}.sub{color:var(--muted);margin:0 0 20px;font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(228px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:18px;box-shadow:0 1px 3px rgba(27,37,53,.06)}
.card h3{margin:2px 0 4px;font-size:15px}.pgm{font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.card p{font-size:12.5px;color:var(--muted);margin:8px 0 0}
label{display:block;font-size:12px;color:var(--muted);margin:10px 0 2px}
input{width:100%;padding:8px 10px;border:1px solid var(--bd);border-radius:8px;font:inherit}
button{background:var(--navy);color:#fff;border:0;padding:9px 14px;border-radius:8px;cursor:pointer;font:inherit;font-weight:600;margin-top:12px}button:hover{background:var(--navy2)}
.out{max-width:1000px;margin:0 auto;padding:18px 20px 0}
.panel{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:20px;min-height:54px;font-size:14px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:5px 16px}.kv b{color:var(--muted);font-weight:600}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--bd)}
.mono{font-variant-numeric:tabular-nums;font-family:ui-monospace,Menlo,monospace}
.ok{color:var(--ok);font-weight:700}.ko{color:var(--ko);font-weight:700}
.badge{display:inline-block;background:#EDF1F6;color:var(--navy);font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;margin-right:6px}
.proof{background:var(--navy);color:#dfe7f5;border-radius:12px;padding:22px}.proof h3{color:var(--accent);margin:0 0 10px;font-size:16px}.proof ul{margin:0;padding-left:18px}.proof li{font-size:13.5px;margin:5px 0}
footer{max-width:1000px;margin:24px auto 0;padding:20px;color:var(--muted);font-size:12px;border-top:1px solid var(--bd)}
</style></head><body>
<div class="hero"><div class="wrap">
 <div class="brand">atlas-toolkit · examples/card-demo-cobol</div>
 <h1>CardDemo — a mainframe credit card system, <span class="accent">ported to the edge</span></h1>
 <p class="lede">The AWS Mainframe Modernization CardDemo sample (COBOL · CICS · VSAM · JCL batch), ported to TypeScript on Cloudflare Workers + D1. Amounts are stored as <strong>integer cents</strong> — never floats. Behaviour is checked by executable parity tests.</p>
 <div class="stats"><span><strong>6</strong> COBOL programs</span><span><strong>30</strong> parity tests</span></div>
</div></div>

<div class="section">
 <h2>Try it</h2>
 <p class="sub">Each button calls the ported version of the matching COBOL program, on the CardDemo sample data decoded from its VSAM files.</p>
 <div class="grid">
  <div class="card"><div class="pgm">COSGN00C · sign-on</div><h3>Authentication</h3>
   <label>User ID</label><input id="u" value="ADMIN001"><label>Password</label><input id="p" value="PASSWORD">
   <button onclick="doLogin()">Sign on</button></div>
  <div class="card"><div class="pgm">COACTVWC · account view</div><h3>View an account</h3>
   <p>Card xref → account → customer chain.</p><label>Account ID</label><input id="a" value="00000000007">
   <button onclick="doView()">Show</button></div>
  <div class="card"><div class="pgm">COTRN00C · list</div><h3>Transactions</h3>
   <p>Keyset pagination (equivalent of VSAM STARTBR/READNEXT).</p><button onclick="doList()">First page</button></div>
  <div class="card"><div class="pgm">CBTRN02C · batch</div><h3>Daily posting</h3>
   <p>Posts the 300 daily transactions. Parity case O-9, account 7: 900.21 / 1287.09 / −579.88.</p><button onclick="doBatch()">Run posting</button></div>
 </div>
</div>

<div class="out"><div class="panel" id="out">Results are shown here.</div></div>

<div class="section"><div class="proof"><h3>What the tests check</h3><ul>
 <li><strong>Financial precision</strong> — every amount is an integer number of cents (no floats). The final balance of account 7 matches the hand-computed expected value to the cent.</li>
 <li><strong>Parity</strong> — 30 executable tests: 11 parity cases plus invariants over the 300 daily transactions (sign = credit/debit direction, limit check with ≥, last reject reason wins).</li>
 <li><strong>Traceability</strong> — rules are linked to their COBOL source; known source bugs are reproduced on purpose and documented.</li>
</ul></div></div>

<footer>Based on AWS CardDemo (Apache-2.0), from aws-samples/aws-mainframe-modernization-carddemo. Part of <a href="https://github.com/AccessInter/atlas-toolkit">atlas-toolkit</a>.</footer>

<script>
function out(h){document.getElementById('out').innerHTML=h;}
function esc(s){return String(s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
function loading(){out('<span class="badge">…</span> calling');}
async function api(url,method,body){var o={method:method,headers:{'content-type':'application/json'}};if(body)o.body=JSON.stringify(body);var r=await fetch(url,o);var d=null;try{d=await r.json();}catch(e){}return {status:r.status,data:d||{}};}
async function doLogin(){loading();var u=document.getElementById('u').value,p=document.getElementById('p').value;var r=await api('/api/login','POST',{userId:u,password:p});var d=r.data;if(d.ok){out('<span class="ok">✓ Signed on</span> — type '+esc(d.userType)+' → '+(d.userType==='A'?'admin':'user')+' menu ('+esc(d.dest)+')');}else{out('<span class="ko">✗ Rejected</span> — '+esc(d.error||('HTTP '+r.status)));}}
async function doView(){loading();var a=document.getElementById('a').value;var r=await api('/api/accounts/'+encodeURIComponent(a),'GET');var d=r.data;if(!d.ok){out('<span class="ko">✗</span> '+esc(d.error||('HTTP '+r.status)));return;}var ac=d.account,di=d.display,cu=d.customer;var h='<div class="kv">';h+='<b>Account</b><span class="mono">'+esc(ac.acct_id)+'</span>';h+='<b>Status</b><span>'+esc(ac.active_status)+'</span>';h+='<b>Balance</b><span class="mono">'+esc(di.curr_bal)+'</span>';h+='<b>Credit limit</b><span class="mono">'+esc(di.credit_limit)+'</span>';h+='<b>Cycle credit</b><span class="mono">'+esc(di.curr_cyc_credit)+'</span>';h+='<b>Cycle debit</b><span class="mono">'+esc(di.curr_cyc_debit)+'</span>';h+='<b>Expiration</b><span>'+esc(ac.expiration_date)+'</span>';h+='<b>Customer</b><span>'+esc(cu.first_name)+' '+esc(cu.last_name)+' ('+esc(cu.cust_id)+')</span>';h+='</div>';out(h);}
async function doList(){loading();var r=await api('/api/transactions?direction=forward','GET');var rows=r.data.rowsDisplay||[];var h='<table><tr><th>Tran ID</th><th>Date</th><th>Amount</th></tr>';for(var i=0;i<rows.length;i++){h+='<tr><td class="mono">'+esc(rows[i].tran_id)+'</td><td>'+esc(rows[i].date)+'</td><td class="mono">'+esc(rows[i].amount)+'</td></tr>';}h+='</table>';out(h);}
function verdict(a,e){return a===e?'<span class="ok">✓ '+esc(a)+'</span>':'<span class="ko">✗ '+esc(a)+' (expected '+esc(e)+')</span>';}
async function doBatch(){loading();var r=await api('/api/batch/post','POST',{});var d=r.data;var head=d.alreadyRun?('<span class="badge">already posted</span> '+esc(d.note)):('<span class="ok">✓ Batch done</span> — '+d.processed+' read, '+d.posted+' posted, '+d.rejected+' rejected, RETURN-CODE '+d.returnCode);var a=await api('/api/accounts/00000000007','GET');var di=a.data.display||{};var h=head+'<div style="margin-top:14px"><b>Parity case O-9 — account 00000000007</b><div class="kv" style="margin-top:8px">';h+='<b>Balance</b><span class="mono">'+verdict(di.curr_bal,'900.21')+'</span>';h+='<b>Cycle credit</b><span class="mono">'+verdict(di.curr_cyc_credit,'1287.09')+'</span>';h+='<b>Cycle debit</b><span class="mono">'+verdict(di.curr_cyc_debit,'-579.88')+'</span>';h+='</div></div>';out(h);}
</script></body></html>`;

app.get('/', (c) => c.html(DASHBOARD));

export default app;
