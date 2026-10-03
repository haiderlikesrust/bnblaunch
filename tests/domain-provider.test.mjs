import test from 'node:test';
import assert from 'node:assert/strict';
import { createDomainProvider, DomainProviderError, usdToCents, validDomain } from '../lib/domain-provider.ts';

const NOW = Date.parse('2026-10-03T12:00:00Z');
const domain = 'examplecoin.fun';
const idempotencyKey = 'domain-operation-00000001';
const write = { domain, kind: 'register', costCents: 253, idempotencyKey, startedAt: NOW - 1000 };
const checkResponse = { response: { avail: 'yes', premium: 'no', price: '1.26', minDuration: 2, additional: { renewal: { price: '12.99' } } } };
const requirements = { tld: 'fun', apiRegisterable: true, registrationDurationYears: 2, whoisPrivacySupported: true, registryRequirements: null };
const preview = { dryRun: true, wouldSucceed: true, operation: 'registration', domain, premium: false, duration: 2, cost: 253, balance: 2000, sufficientFunds: true, withinMonthlySpendLimit: true };
const purchaseResponse = { domain, cost: 253, orderId: 12345678, balance: 1747 };
const details = (overrides = {}) => ({ domain: { domain, status: 'ACTIVE', createDate: '2026-10-03 11:59:58', expireDate: '2028-10-03 11:59:58', autoRenew: 0, apiAccess: 1, ...overrides } });
const dnsRecord = (id, name, type, content) => ({ id, name, type, content, ttl: '600' });
const checkout = { checkoutId: 'checkout_12345678', amount_cents: 1500, estimatedFee_cents: 15, estimatedCredit_cents: 1485, currency: 'USDC', network: 'base', payUrl: 'https://payments.coinbase.com/payment-sessions/paymentSession_abc123', x402Url: 'https://api.cdp.coinbase.com/platform/v2/payment-sessions/paymentSession_abc123/authorizations/x402', expiresAt: '2026-10-04T12:00:00Z' };
function reply(data, status = 200, headers = {}) { return new Response(JSON.stringify({ status: 'SUCCESS', requestId: 'request-00000001', ...data }), { status, headers: { 'Content-Type': 'application/json', ...headers } }); }
function client(steps, options = {}) {
  const calls = [];
  const provider = createDomainProvider({ apiKey: 'pk1_unit_test', secretKey: 'sk1_unit_test', now: () => NOW, fetch: async (url, init) => {
    calls.push({ url, ...init, body: init?.body ? JSON.parse(init.body) : undefined });
    assert.equal(new URL(url).origin, 'https://api.porkbun.com');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers['X-API-Key'], 'pk1_unit_test');
    assert.equal(init.headers['X-Secret-API-Key'], 'sk1_unit_test');
    const step = steps.shift();
    assert.ok(step, 'Unexpected provider request');
    if (typeof step === 'function') return step(calls.at(-1));
    return step;
  }, ...options });
  return { provider, calls };
}
const failure = (code, ambiguous) => error => error instanceof DomainProviderError && error.code === code && error.ambiguous === ambiguous;

test('domain inputs are constrained; decimal USD converts exactly without coercing null or rounding', () => {
  assert.equal(validDomain('coin.fun'), true);
  for (const value of ['https://coin.fun', 'coin.fun/path', 'coin.fun?x', 'coin.fun.evil', 'xn--coin.fun', '-coin.fun', 'COIN.fun', 'coin.org', '*.coin.fun']) assert.equal(validDomain(value), false);
  assert.equal(usdToCents('19.99'), 1999);
  assert.equal(usdToCents('0.1'), 10);
  for (const value of [null, '', ' ', '1e2', '1.999', '-1', 1.99, 'Infinity']) assert.throws(() => usdToCents(value), DomainProviderError);
});

test('quote uses registrar dry-run TOTAL cents, preserving separate annual renewal pricing', async () => {
  const { provider, calls } = client([reply(checkResponse), reply(requirements), reply(preview)]);
  const q = await provider.quote(domain, 'register');
  assert.equal(q.costCents, 253); // Deliberately differs from annual 126 * 2.
  assert.equal(q.durationYears, 2);
  assert.equal(q.wouldSucceed, true);
  assert.equal(calls[2].url, `https://api.porkbun.com/api/json/v3/domain/create/${domain}`);
  assert.deepEqual(calls[2].body, { cost: 0, dryRun: true, agreeToTerms: 'yes', whoisPrivacy: true });
  const read = client([reply(checkResponse)]);
  assert.equal((await read.provider.check(domain)).annualRenewalCents, 1299);
});

test('insufficient prepaid credit remains a usable quote with explicit funding shortfall', async () => {
  const { provider } = client([reply(checkResponse), reply(requirements), reply({ ...preview, balance: 0, sufficientFunds: false, wouldSucceed: false, shortfall: 253, usdcAmountToCover: 256 })]);
  const q = await provider.quote(domain, 'register');
  assert.equal(q.shortfallCents, 253);
  assert.equal(q.usdcAmountToCoverCents, 256);
  assert.equal(q.wouldSucceed, false);
});

test('premium and unavailable names never reach a registration dry run', async () => {
  for (const [field, value, code] of [['premium', 'yes', 'PREMIUM_NOT_SUPPORTED'], ['avail', 'no', 'DOMAIN_NOT_AVAILABLE']]) {
    const { provider, calls } = client([reply({ response: { ...checkResponse.response, [field]: value } })]);
    await assert.rejects(provider.quote(domain, 'register'), failure(code, false));
    assert.equal(calls.length, 1);
  }
});

test('API-ineligible TLD and inconsistent duration fail before attempting registration', async () => {
  for (const [overrides, code] of [[{ apiRegisterable: false }, 'TLD_NOT_API_REGISTERABLE'], [{ registrationDurationYears: 1 }, 'REGISTRATION_DURATION_MISMATCH']]) {
    const { provider, calls } = client([reply(checkResponse), reply({ ...requirements, ...overrides })]);
    await assert.rejects(provider.quote(domain, 'register'), failure(code, false));
    assert.equal(calls.length, 2);
  }
});

test('malformed or contradictory dry-run responses cannot become purchase quotes', async () => {
  for (const overrides of [{ dryRun: false }, { premium: true }, { domain: 'other.fun' }, { cost: '253' }, { cost: 10001 }, { balance: 0, sufficientFunds: true }, { withinMonthlySpendLimit: false }]) {
    const { provider } = client([reply(checkResponse), reply(requirements), reply({ ...preview, ...overrides })]);
    await assert.rejects(provider.quote(domain, 'register'), DomainProviderError);
  }
});

test('renewal quotation verifies ownership and API access, and uses renewal dry run', async () => {
  const { provider, calls } = client([reply({ response: { ...checkResponse.response, avail: 'no' } }), reply(details()), reply({ ...preview, operation: 'renewal', duration: 1, cost: 1299 })]);
  assert.equal((await provider.quote(domain, 'renew')).costCents, 1299);
  assert.deepEqual(calls[2].body, { cost: 0, dryRun: true });
  assert.ok(calls[2].url.endsWith('/domain/renew/' + domain));
});

test('paid writes reuse the exact body and key without preflight that would break successful replay', async () => {
  const { provider, calls } = client([reply(purchaseResponse), reply(purchaseResponse, 200, { 'Idempotent-Replayed': 'true' })]);
  const initial = await provider.purchase(write), replay = await provider.purchase(write);
  assert.equal(initial.orderId, replay.orderId);
  assert.equal(replay.replayed, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.equal(calls[0].headers['Idempotency-Key'], idempotencyKey);
  assert.deepEqual(calls[0].body, { cost: 253, agreeToTerms: 'yes', whoisPrivacy: true });
});

test('changed quote fails closed as a known non-charge; no automatic retry or cost increase', async () => {
  const { provider, calls } = client([reply({ status: 'ERROR', code: 'COST_MISMATCH', cost: 999 }, 400)]);
  await assert.rejects(provider.purchase(write), failure('COST_MISMATCH', false));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.cost, 253);
});

test('replay rejection cannot release a reservation after a previous ambiguous dispatch', async () => {
  const { provider, calls } = client([reply({ status: 'ERROR', code: 'COST_MISMATCH' }, 400)]);
  await assert.rejects(provider.purchase({ ...write, previouslyAttempted: true }), failure('COST_MISMATCH', true));
  assert.equal(calls.length, 1);
  const topup = client([reply({ status: 'ERROR', code: 'TOPUP_LIMIT_EXCEEDED' }, 400)]);
  await assert.rejects(topup.provider.createCryptoTopup({ amountCents: 1500, idempotencyKey, startedAt: NOW - 1000, previouslyAttempted: true }), failure('TOPUP_LIMIT_EXCEEDED', true));
});

test('paid network, server and unknown failures keep reservations with no automatic resend', async () => {
  for (const response of [() => { throw Error('socket reset'); }, reply({ status: 'ERROR', code: 'COST_MISMATCH' }, 503), reply({ status: 'ERROR', code: 'ORDER_FAILED' }, 400), reply({ status: 'ERROR', code: 'IDEMPOTENCY_KEY_IN_USE' }, 409), new Response('not JSON', { status: 502 })]) {
    const { provider, calls } = client([response]);
    await assert.rejects(provider.purchase(write), error => error instanceof DomainProviderError && error.ambiguous && error.uncertain);
    assert.equal(calls.length, 1);
  }
});

test('malformed, wrong-domain, wrong-cost and dry-run paid confirmations stay ambiguous', async () => {
  for (const overrides of [{ domain: 'other.fun' }, { cost: 999 }, { cost: null }, { orderId: null }, { orderId: '123' }, { dryRun: true }, { requestId: null }]) {
    const { provider } = client([reply({ ...purchaseResponse, ...overrides })]);
    await assert.rejects(provider.purchase(write), error => error instanceof DomainProviderError && error.ambiguous);
  }
});

test('financial retries beyond the retained idempotency window never hit the network', async () => {
  const { provider, calls } = client([]);
  await assert.rejects(provider.purchase({ ...write, startedAt: NOW - 86_400_000 }), failure('IDEMPOTENCY_WINDOW_EXPIRED', true));
  assert.equal(calls.length, 0);
});

test('confirmed renewal carries actual new expiry and rejects an absent expiry', async () => {
  const { provider } = client([reply({ ...purchaseResponse, expirationDate: '2029-10-03' })]);
  assert.equal((await provider.purchase({ ...write, kind: 'renew' })).expiresAt, Date.parse('2029-10-03T00:00:00Z'));
  const missing = client([reply(purchaseResponse)]);
  await assert.rejects(missing.provider.purchase({ ...write, kind: 'renew' }), error => error.ambiguous);
});

test('production adapter rejects sandbox keys, sandbox bodies and mock response headers', async () => {
  assert.throws(() => createDomainProvider({ apiKey: 'pk1_sb_test', secretKey: 'sk1_sb_test' }), failure('SANDBOX_NOT_ALLOWED', false));
  for (const response of [reply({ balance: 999, sandbox: true }), reply({ balance: 999 }, 200, { 'X-Porkbun-Sandbox': 'true' }), reply({ balance: 999 }, 200, { 'X-Porkbun-Mock': 'true' })]) {
    const { provider } = client([response]);
    await assert.rejects(provider.balance(), failure('SANDBOX_NOT_ALLOWED', false));
  }
  const allowed = client([reply({ balance: 999, sandbox: true })], { allowSandbox: true });
  assert.equal((await allowed.provider.balance()).balanceCents, 999);
});

test('balance, ownership and registrar dates do not coerce null or accept invalid identities', async () => {
  const balance = client([reply({ balance: null })]);
  await assert.rejects(balance.provider.balance(), DomainProviderError);
  for (const overrides of [{ domain: 'other.fun' }, { expireDate: '2027-02-30' }, { apiAccess: '1' }, { expireDate: '2025-01-01' }]) {
    const { provider } = client([reply(details(overrides))]);
    await assert.rejects(provider.detail(domain), DomainProviderError);
  }
});

test('auto-renew OFF is verified, including per-domain failures and unchanged state', async () => {
  const { provider, calls } = client([reply(details({ autoRenew: 1 })), reply({ results: { [domain]: { status: 'SUCCESS' } } }), reply(details())]);
  assert.equal((await provider.setAutoRenewOff(domain, idempotencyKey)).autoRenew, false);
  assert.deepEqual(calls[1].body, { status: 'off' });
  const mismatch = client([reply(details({ autoRenew: 1 })), reply({ results: { [domain]: { status: 'SUCCESS' } } }), reply(details({ autoRenew: 1 }))]);
  await assert.rejects(mismatch.provider.setAutoRenewOff(domain, idempotencyKey), failure('AUTORENEW_NOT_DISABLED', false));
  const already = client([reply(details())]);
  await already.provider.setAutoRenewOff(domain, idempotencyKey);
  assert.equal(already.calls.length, 1);
});

test('DNS adopts the apex A record, replaces apex parking and preserves www, mail and other names', async () => {
  const ip = '8.8.8.8';
  const original = [dnsRecord('1', domain, 'ALIAS', 'pixie.porkbun.com'), dnsRecord('2', 'www.' + domain, 'CNAME', 'pixie.porkbun.com'), dnsRecord('3', domain, 'MX', 'mail.example.com'), dnsRecord('4', '_verify.' + domain, 'TXT', 'keep'), dnsRecord('5', 'app.' + domain, 'A', '1.1.1.1')];
  const finished = [dnsRecord('6', domain, 'A', ip), ...original.slice(1)];
  const { provider, calls } = client([reply(details()), reply({ ns: ['maceio.ns.porkbun.com', 'curitiba.ns.porkbun.com'] }), reply({ records: original }), reply({}), reply({ id: '6' }), reply({ records: finished })]);
  assert.equal((await provider.ensureDns(domain, ip, idempotencyKey, NOW - 1000)).configured, true);
  const changes = calls.filter(c => c.method === 'POST');
  assert.equal(changes.length, 2);
  assert.ok(changes[0].url.endsWith('/dns/delete/' + domain + '/1'));
  assert.deepEqual(changes[1].body, { name: '', type: 'A', content: ip, ttl: 600 });
  const repeated = client([reply(details()), reply({ ns: ['curitiba.ns.porkbun.com', 'maceio.ns.porkbun.com'] }), reply({ records: finished }), reply({ records: finished })]);
  await repeated.provider.ensureDns(domain, ip, idempotencyKey, NOW - 1000);
  assert.equal(repeated.calls.filter(c => c.method === 'POST').length, 0);
});

test('DNS cannot alter old domains, disabled domains or externally delegated domains', async () => {
  for (const [steps, code] of [[ [reply(details({ createDate: '2020-01-01' }))], 'DOMAIN_NOT_NEW_REGISTRATION'], [[reply(details({ apiAccess: 0 }))], 'DOMAIN_NOT_READY'], [[reply(details()), reply({ ns: ['ns1.example.com', 'ns2.example.com'] })], 'NAMESERVERS_NOT_PORKBUN']]) {
    const { provider, calls } = client(steps);
    await assert.rejects(provider.ensureDns(domain, '8.8.8.8', idempotencyKey, NOW - 1000), failure(code, false));
    assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  }
});

test('DNS provider warnings and failed readback cannot report configured', async () => {
  const leading = () => [reply(details()), reply({ ns: ['maceio.ns.porkbun.com', 'curitiba.ns.porkbun.com'] }), reply({ records: [] })];
  const warning = client([...leading(), reply({ id: '1', warnings: 'Domain delegated elsewhere' })]);
  await assert.rejects(warning.provider.ensureDns(domain, '8.8.8.8', idempotencyKey, NOW - 1000), failure('DNS_NOT_AUTHORITATIVE', false));
  const unconfirmed = client([...leading(), reply({ id: '1' }), reply({ records: [] })]);
  await assert.rejects(unconfirmed.provider.ensureDns(domain, '8.8.8.8', idempotencyKey, NOW - 1000), failure('DNS_NOT_CONFIRMED', false));
});

test('crypto checkout is tied to exact amount and one official Coinbase payment session', async () => {
  const { provider, calls } = client([reply(checkout)]);
  const result = await provider.createCryptoTopup({ amountCents: 1500, idempotencyKey, startedAt: NOW });
  assert.equal(result.currency, 'USDC');
  assert.equal(result.network, 'base');
  assert.equal(result.estimatedCreditCents, 1485);
  assert.equal(result.x402Url, checkout.x402Url);
  assert.equal(result.expiresAt, NOW + 86_400_000);
  assert.equal(calls.length, 1); // Never contacts Coinbase or pays the checkout.
});

test('crypto amount/network/fee/URL mismatches remain unresolved and never follow URLs', async () => {
  for (const overrides of [{ amount_cents: 1501 }, { network: 'bsc' }, { currency: 'BNB' }, { estimatedFee_cents: 0 }, { x402Url: 'https://evil.example/pay' }, { x402Url: checkout.x402Url.replace('abc123', 'other') }, { payUrl: 'https://payments.coinbase.com@evil.example/pay' }]) {
    const { provider, calls } = client([reply({ ...checkout, ...overrides })]);
    await assert.rejects(provider.createCryptoTopup({ amountCents: 1500, idempotencyKey, startedAt: NOW }), error => error instanceof DomainProviderError && error.ambiguous);
    assert.equal(calls.length, 1);
  }
});

test('checkout is funded only with matching COMPLETED and credited:true, never PROCESSING', async () => {
  const { provider } = client([reply({ checkoutId: checkout.checkoutId, state: 'PROCESSING', credited: false, balance_cents: 500 }), reply({ checkoutId: checkout.checkoutId, state: 'COMPLETED', credited: true, balance_cents: 1985 })]);
  assert.equal((await provider.cryptoTopupStatus(checkout.checkoutId)).credited, false);
  assert.equal((await provider.cryptoTopupStatus(checkout.checkoutId)).credited, true);
  for (const overrides of [{ checkoutId: 'different_checkout' }, { credited: false }, { balance_cents: null }]) {
    const bad = client([reply({ checkoutId: checkout.checkoutId, state: 'COMPLETED', credited: true, balance_cents: 1985, ...overrides })]);
    await assert.rejects(bad.provider.cryptoTopupStatus(checkout.checkoutId), DomainProviderError);
  }
});
