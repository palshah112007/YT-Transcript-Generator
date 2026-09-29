// End-to-end Supabase auth test — run with: node scripts/test-auth.mjs
// Verifies, in order:
//   1. Project reachability (DNS + HTTPS health)
//   2. Auth service responds (invalid login returns a proper error)
//   3. Signup + login flow (creates a throwaway test user)
// Email confirmation is checked: if enabled, login-before-confirm is expected
// to fail with "Email not confirmed" which still proves the flow works.
import { readEnvValue } from '../lib/env.js';

const url = readEnvValue('VITE_SUPABASE_URL');
const key = readEnvValue('VITE_SUPABASE_ANON_KEY');

if (!url || !key) {
  console.error('✗ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing in .env');
  process.exit(1);
}

let failures = 0;

async function check(label, fn) {
  try {
    const ok = await fn();
    console.log(`${ok ? '✓' : '✗'} ${label}`);
    if (!ok) failures += 1;
    return ok;
  } catch (error) {
    console.log(`✗ ${label} — ${error.message}`);
    failures += 1;
    return false;
  }
}

// 1) Reachability
const reachable = await check('Project reachable (health endpoint)', async () => {
  const res = await fetch(`${url}/auth/v1/health`, {
    headers: { apikey: key },
    signal: AbortSignal.timeout(15000),
  });
  return res.ok;
});

if (!reachable) {
  console.log('\nProject is unreachable — likely paused or deleted.');
  console.log('→ Restore it at https://supabase.com/dashboard, then re-run this test.');
  process.exit(1);
}

// 2) Auth service sanity: random creds must get a proper auth error (not a network error)
await check('Auth service responds (invalid login rejected properly)', async () => {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nobody-probe@example.com', password: 'wrong-password-123' }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json();
  // 400 with "Invalid login credentials" = auth server healthy
  return res.status === 400 && /invalid login credentials/i.test(body.error_description ?? body.msg ?? '');
});

// 3) Real signup + login round-trip with a throwaway account
const testEmail = `test-${Date.now()}@example.com`;
const testPassword = 'TestPass!2345';
let signupDone = false;
await check(`Signup works (${testEmail})`, async () => {
  const res = await fetch(`${url}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json();
  signupDone = res.status === 200;
  if (!signupDone) console.log(`   ↳ signup response: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return signupDone;
});

await check('Login flow works (password grant)', async () => {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json();
  if (res.ok && body.access_token) return true;
  // Email confirmation enabled by default → this error still proves the flow is wired up
  if (/email not confirmed/i.test(body.error_description ?? body.msg ?? '')) {
    console.log('   ↳ email confirmation is ON (default) — real users must verify before login. Flow is working.');
    return true;
  }
  console.log(`   ↳ login response: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return false;
});

console.log(failures === 0 ? '\nAll auth checks passed ✅' : `\n${failures} check(s) failed ❌`);
process.exit(failures === 0 ? 0 : 1);
