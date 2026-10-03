import { z } from 'zod';

// Contract: https://porkbun.com/api/json/v3/spec
// Purchases spend prepaid registrar credit. This adapter never signs payments,
// follows provider redirects, or fetches a URL supplied by a model.
const API = 'https://api.porkbun.com/api/json/v3';
const DAY = 86_400_000;
const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveCents = cents.refine(n => n > 0);
const text = z.string().min(1).max(1000);
const yesNo = z.enum(['yes', 'no']);
const bit = z.union([z.literal(0), z.literal(1)]).transform(v => v === 1);
const recordId = z.string().regex(/^[0-9]{1,30}$/);
const domainPattern = /^(?!xn--)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:com|fun|xyz|ai)$/;

export type DomainOperationKind = 'register' | 'renew';
export type DomainWrite = { domain: string; kind: DomainOperationKind; costCents: number; idempotencyKey: string; startedAt: number; previouslyAttempted?: boolean };
export type DomainDetail = { domain: string; status: string; createdAt: number; expiresAt: number; createdDate: string; expiryDate: string; apiAccess: boolean; autoRenew: boolean };
export type DomainQuote = { domain: string; kind: DomainOperationKind; costCents: number; durationYears: number; balanceCents: number; sufficientFunds: boolean; wouldSucceed: boolean; withinMonthlySpendLimit: boolean | null; shortfallCents: number; usdcAmountToCoverCents: number | null; quotedAt: number };
export type DomainPurchase = { domain: string; kind: DomainOperationKind; costCents: number; orderId: number; balanceCents: number; requestId: string; expiresAt: number | null; replayed: boolean };
export type DomainCryptoCheckout = { checkoutId: string; amountCents: number; estimatedFeeCents: number; estimatedCreditCents: number; currency: 'USDC'; network: 'base'; x402Url: string | null; payUrl: string; expiresAt: number | null; requestId: string; replayed: boolean };

export class DomainProviderError extends Error {
  readonly code: string;
  readonly ambiguous: boolean;
  readonly uncertain: boolean;
  readonly retryable: boolean;
  constructor(code: string, ambiguous = false, retryable = false) {
    super(ambiguous ? 'Registrar outcome requires reconciliation; keep the reservation.' : 'Registrar operation did not complete.');
    this.name = 'DomainProviderError';
    this.code = code;
    this.ambiguous = ambiguous;
    this.uncertain = ambiguous;
    this.retryable = retryable;
  }
}

function requireValue(ok: unknown, code = 'INVALID_PROVIDER_RESPONSE', ambiguous = false): asserts ok {
  if (!ok) throw new DomainProviderError(code, ambiguous);
}
export function validDomain(domain: string) {
  return typeof domain === 'string' && domainPattern.test(domain);
}
function domainName(domain: string) {
  requireValue(validDomain(domain), 'INVALID_DOMAIN');
  return domain;
}
function operationKind(kind: DomainOperationKind) {
  requireValue(kind === 'register' || kind === 'renew', 'INVALID_OPERATION');
  return kind === 'register' ? 'create' : 'renew';
}
function key(value: string) {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9:_-]{16,180}$/.test(value), 'INVALID_IDEMPOTENCY_KEY');
  return value;
}
function parse<T extends z.ZodTypeAny>(schema: T, value: unknown, ambiguous = false): z.infer<T> {
  const result = schema.safeParse(value);
  requireValue(result.success, 'INVALID_PROVIDER_RESPONSE', ambiguous);
  return result.data;
}
export function usdToCents(value: unknown) {
  requireValue(typeof value === 'string' && /^(0|[1-9][0-9]{0,12})(?:\.[0-9]{1,2})?$/.test(value), 'INVALID_PRICE');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  requireValue(amount <= BigInt(Number.MAX_SAFE_INTEGER), 'INVALID_PRICE');
  return Number(amount);
}
function calendarDate(value: string, ambiguous = false) {
  // The registrar examples include both dates and timezone-free datetimes.
  // Use the start of the stated calendar day, so renewal never waits too long.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  requireValue(match, 'INVALID_PROVIDER_RESPONSE', ambiguous);
  const day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  requireValue(new Date(day).toISOString().slice(0, 10) === value.slice(0, 10), 'INVALID_PROVIDER_RESPONSE', ambiguous);
  return day;
}
function timestamp(value: string, ambiguous = false) {
  requireValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value), 'INVALID_PROVIDER_RESPONSE', ambiguous);
  const ms = Date.parse(value);
  requireValue(Number.isFinite(ms), 'INVALID_PROVIDER_RESPONSE', ambiguous);
  return ms;
}
function publicIpv4(value: string) {
  requireValue(typeof value === 'string' && /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value), 'INVALID_SERVER_IP');
  const [a, b, c, d] = value.split('.').map(Number);
  requireValue([a, b, c, d].every(n => n <= 255) && a > 0 && a < 224 && a !== 10 && a !== 127 && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) && !(a === 198 && (b === 18 || b === 19)), 'INVALID_SERVER_IP');
  return value;
}

const detailSchema = z.object({ domain: z.object({ domain: text, status: z.string().regex(/^[A-Z_]+$/), createDate: text, expireDate: text, autoRenew: bit, apiAccess: bit }) });
const dnsSchema = z.object({ records: z.array(z.object({ id: recordId, name: z.string().min(1).max(255), type: z.string().regex(/^[A-Z0-9]+$/), content: z.string().max(10000), ttl: z.string().regex(/^\d+$/), notes: z.string().nullable().optional() })).max(2500) });
// These documented preflight rejections cannot have committed a paid order.
// Unknown errors, 5xx, mismatched keys, and in-flight writes stay ambiguous.
const safePaidRejections = new Set(['INVALID_DOMAIN', 'INVALID_TLD', 'DOMAIN_NOT_AVAILABLE', 'PREMIUM_DOMAIN', 'PREMIUM_DOMAIN_NOT_SUPPORTED', 'TLD_NOT_SUPPORTED', 'API_REGISTRATION_NOT_SUPPORTED', 'INSUFFICIENT_FUNDS', 'COST_MISMATCH', 'ORDER_TOO_LARGE', 'VERIFICATION_REQUIRED', 'MONTHLY_SPEND_LIMIT_EXCEEDED', 'TOPUP_LIMIT_EXCEEDED', 'API_ACCESS_DISABLED', 'DOMAIN_NOT_ALLOWED', 'IP_NOT_ALLOWED', 'INVALID_API_KEY', 'INVALID_SECRET_API_KEY', 'API_KEY_REQUIRED', 'CRYPTO_NOT_AVAILABLE', 'CRYPTO_TOPUP_LIMIT', 'RATE_LIMIT_EXCEEDED']);

export function createDomainProvider(options: { apiKey: string; secretKey: string; fetch?: typeof fetch; allowSandbox?: boolean; now?: () => number }) {
  requireValue(typeof options.apiKey === 'string' && !!options.apiKey.trim() && !/[\r\n]/.test(options.apiKey) && typeof options.secretKey === 'string' && !!options.secretKey.trim() && !/[\r\n]/.test(options.secretKey), 'REGISTRAR_NOT_CONFIGURED');
  requireValue(options.allowSandbox || (!options.apiKey.startsWith('pk1_sb_') && !options.secretKey.startsWith('sk1_sb_')), 'SANDBOX_NOT_ALLOWED');
  const transport = options.fetch ?? fetch, now = options.now ?? Date.now;
  function financialWrite(input: { idempotencyKey: string; startedAt: number }) {
    key(input.idempotencyKey);
    requireValue(Number.isSafeInteger(input.startedAt) && input.startedAt > 0 && input.startedAt <= now() + 30_000, 'INVALID_OPERATION_TIME');
    // Runtime must persist startedAt before the first dispatch and reuse it.
    requireValue(now() - input.startedAt < DAY - 60_000, 'IDEMPOTENCY_WINDOW_EXPIRED', true);
  }
  async function request(path: string, body?: unknown, idempotencyKey?: string, paid = false, previouslyAttempted = false) {
    let response: Response;
    try {
      response = await transport(API + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-API-Key': options.apiKey, 'X-Secret-API-Key': options.secretKey, 'Accept': 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(idempotencyKey ? { 'Idempotency-Key': key(idempotencyKey) } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(30_000) });
    } catch { throw new DomainProviderError('REGISTRAR_TRANSPORT', paid, !paid); }
    let json: unknown;
    try { json = await response.json(); } catch { throw new DomainProviderError('INVALID_PROVIDER_RESPONSE', paid); }
    const value = parse(z.object({ status: z.string(), sandbox: z.boolean().optional() }).passthrough(), json, paid);
    requireValue(options.allowSandbox || (!value.sandbox && response.headers.get('X-Porkbun-Sandbox')?.toLowerCase() !== 'true' && response.headers.get('X-Porkbun-Mock')?.toLowerCase() !== 'true'), 'SANDBOX_NOT_ALLOWED', paid);
    if (!response.ok || value.status !== 'SUCCESS') {
      const code = typeof value.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(value.code) ? value.code : 'REGISTRAR_REJECTED';
      const definitelyRejected = !previouslyAttempted && value.status === 'ERROR' && safePaidRejections.has(code) && response.status < 500;
      throw new DomainProviderError(code, paid && !definitelyRejected, !paid && (response.status === 429 || response.status >= 500));
    }
    return { value, requestId: response.headers.get('X-Request-Id') ?? value.requestId, replayed: response.headers.get('Idempotent-Replayed') === 'true' };
  }
  async function detail(domain: string): Promise<DomainDetail> {
    const { value } = await request('/domain/get/' + domainName(domain));
    const item = parse(detailSchema, value).domain;
    requireValue(item.domain === domain, 'DOMAIN_IDENTITY_MISMATCH');
    const createdAt = calendarDate(item.createDate), expiresAt = calendarDate(item.expireDate);
    requireValue(expiresAt > createdAt && createdAt <= now() + DAY);
    return { domain, status: item.status, createdAt, expiresAt, createdDate: item.createDate, expiryDate: item.expireDate, autoRenew: item.autoRenew, apiAccess: item.apiAccess };
  }
  async function requirements(tld: string) {
    requireValue(['com', 'fun', 'xyz', 'ai'].includes(tld), 'INVALID_TLD');
    const { value } = await request('/domain/getRegistrationRequirements/' + tld);
    const result = parse(z.object({ tld: text, apiRegisterable: z.boolean(), registrationDurationYears: z.number().int().min(1).max(10), whoisPrivacySupported: z.boolean(), requiresValidatedAddress: z.boolean().optional(), registryRequirements: z.record(z.unknown()).nullable().optional() }), value);
    requireValue(result.tld === tld, 'DOMAIN_IDENTITY_MISMATCH');
    return { tld, apiRegisterable: result.apiRegisterable, durationYears: result.registrationDurationYears, whoisPrivacySupported: result.whoisPrivacySupported, requiresValidatedAddress: result.requiresValidatedAddress ?? false, registryRequirements: result.registryRequirements ?? null };
  }
  async function check(domain: string) {
    const { value } = await request('/domain/checkDomain/' + domainName(domain), {});
    const result = parse(z.object({ response: z.object({ avail: yesNo, premium: yesNo, price: text, minDuration: z.number().int().min(1).max(10), additional: z.object({ renewal: z.object({ price: text }) }) }) }), value).response;
    return { domain, available: result.avail === 'yes', premium: result.premium === 'yes', annualRegistrationCents: usdToCents(result.price), annualRenewalCents: usdToCents(result.additional.renewal.price), durationYears: result.minDuration };
  }
  async function quote(domain: string, kind: DomainOperationKind): Promise<DomainQuote> {
    const endpoint = operationKind(kind);
    const checked = await check(domain);
    requireValue(!checked.premium, 'PREMIUM_NOT_SUPPORTED');
    if (kind === 'register') {
      requireValue(checked.available, 'DOMAIN_NOT_AVAILABLE');
      const policy = await requirements(domain.split('.')[1]);
      requireValue(policy.apiRegisterable && !policy.registryRequirements, 'TLD_NOT_API_REGISTERABLE');
      requireValue(policy.durationYears === checked.durationYears, 'REGISTRATION_DURATION_MISMATCH');
    } else {
      const owned = await detail(domain);
      requireValue(owned.status === 'ACTIVE' && owned.apiAccess, 'DOMAIN_NOT_READY');
    }
    const { value } = await request(`/domain/${endpoint}/${domain}`, { cost: 0, dryRun: true, ...(kind === 'register' ? { agreeToTerms: 'yes', whoisPrivacy: true } : {}) });
    const result = parse(z.object({ dryRun: z.literal(true), wouldSucceed: z.boolean(), operation: z.enum(['registration', 'renewal']), domain: text, premium: z.boolean(), duration: z.number().int().min(1).max(10), cost: positiveCents, balance: cents, sufficientFunds: z.boolean(), withinMonthlySpendLimit: z.boolean().optional(), shortfall: cents.optional(), usdcAmountToCover: positiveCents.optional() }), value);
    requireValue(result.domain === domain && result.operation === (kind === 'register' ? 'registration' : 'renewal'), 'DOMAIN_IDENTITY_MISMATCH');
    requireValue(!result.premium, 'PREMIUM_NOT_SUPPORTED');
    requireValue(result.cost <= 10000, 'ORDER_TOO_LARGE');
    requireValue(result.sufficientFunds === (result.balance >= result.cost) && (!result.wouldSucceed || (result.sufficientFunds && result.withinMonthlySpendLimit !== false)));
    return { domain, kind, costCents: result.cost, durationYears: result.duration, balanceCents: result.balance, sufficientFunds: result.sufficientFunds, wouldSucceed: result.wouldSucceed, withinMonthlySpendLimit: result.withinMonthlySpendLimit ?? null, shortfallCents: Math.max(0, result.cost - result.balance), usdcAmountToCoverCents: result.usdcAmountToCover ?? null, quotedAt: now() };
  }
  async function nameservers(domain: string) {
    const { value } = await request('/domain/getNs/' + domainName(domain));
    const { ns } = parse(z.object({ ns: z.array(z.string().max(254).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\.?$/i)).min(2).max(13) }), value);
    const unique = [...new Set(ns.map(n => n.toLowerCase().replace(/\.$/, '')))].sort();
    requireValue(unique.length >= 2);
    return unique;
  }
  async function records(domain: string) {
    const { value } = await request('/dns/retrieve/' + domainName(domain));
    const result = parse(dnsSchema, value).records;
    requireValue(result.every(r => r.name === domain || r.name.endsWith('.' + domain)));
    return result;
  }
  async function dnsWrite(path: string, body: unknown, idempotencyKey: string) {
    const { value } = await request(path, body, idempotencyKey);
    requireValue(value.warnings === undefined || value.warnings === null || value.warnings === '' || (Array.isArray(value.warnings) && value.warnings.length === 0), 'DNS_NOT_AUTHORITATIVE');
  }
  return {
    check, requirements, quote, detail, nameservers,
    async balance() { return { balanceCents: parse(z.object({ balance: cents }), (await request('/account/balance')).value).balance }; },
    async purchase(input: DomainWrite): Promise<DomainPurchase> {
      const domain = domainName(input.domain), endpoint = operationKind(input.kind);
      requireValue(Number.isSafeInteger(input.costCents) && input.costCents > 0 && input.costCents <= 10000, 'INVALID_PURCHASE_COST');
      financialWrite(input);
      // Do not re-quote here: a previous dispatch may already have registered the
      // domain. Reuse the persisted body/key to reach the provider's replay.
      const response = await request(`/domain/${endpoint}/${domain}`, { cost: input.costCents, ...(input.kind === 'register' ? { agreeToTerms: 'yes', whoisPrivacy: true } : {}) }, input.idempotencyKey, true, input.previouslyAttempted);
      const result = parse(z.object({ domain: text, cost: positiveCents, orderId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), balance: cents, dryRun: z.literal(false).optional(), expirationDate: text.optional() }), response.value, true);
      requireValue(result.domain === domain && result.cost === input.costCents, 'PURCHASE_CONFIRMATION_MISMATCH', true);
      const requestId = parse(text, response.requestId, true);
      requireValue(input.kind !== 'renew' || result.expirationDate, 'INVALID_PROVIDER_RESPONSE', true);
      return { domain, kind: input.kind, costCents: result.cost, orderId: result.orderId, balanceCents: result.balance, requestId, expiresAt: result.expirationDate ? calendarDate(result.expirationDate, true) : null, replayed: response.replayed };
    },
    async setAutoRenewOff(domain: string, idempotencyKey: string) {
      const owned = await detail(domain);
      requireValue(owned.status === 'ACTIVE' && owned.apiAccess, 'DOMAIN_NOT_READY');
      if (!owned.autoRenew) return owned;
      const { value } = await request('/domain/updateAutoRenew/' + domainName(domain), { status: 'off' }, idempotencyKey);
      const result = parse(z.object({ results: z.record(z.object({ status: z.string() })) }), value);
      requireValue(result.results[domain]?.status === 'SUCCESS', 'AUTORENEW_NOT_DISABLED');
      const confirmed = await detail(domain);
      requireValue(!confirmed.autoRenew, 'AUTORENEW_NOT_DISABLED');
      return confirmed;
    },
    async ensureDns(domain: string, ipv4: string, keyPrefix: string, registrationStartedAt: number) {
      domainName(domain); publicIpv4(ipv4); key(keyPrefix);
      requireValue(keyPrefix.length <= 120, 'INVALID_IDEMPOTENCY_KEY');
      requireValue(Number.isSafeInteger(registrationStartedAt) && registrationStartedAt > 0 && registrationStartedAt <= now(), 'INVALID_OPERATION_TIME');
      const owned = await detail(domain);
      requireValue(owned.status === 'ACTIVE' && owned.apiAccess, 'DOMAIN_NOT_READY');
      requireValue(Math.abs(owned.createdAt - registrationStartedAt) <= 2 * DAY, 'DOMAIN_NOT_NEW_REGISTRATION');
      requireValue((await nameservers(domain)).every(ns => ns.endsWith('.porkbun.com')), 'NAMESERVERS_NOT_PORKBUN');
      const existing = await records(domain), routingTypes = new Set(['A', 'AAAA', 'CNAME', 'ALIAS']);
      const matching = existing.filter(r => r.name === domain && routingTypes.has(r.type));
      const keep = matching.find(r => r.type === 'A' && r.content === ipv4) ?? matching.find(r => r.type === 'A');
      // Only apex routing records on this newly registered domain change;
      // TXT, MX, CAA and all subdomains, including www, are preserved.
      for (const r of matching) if (r !== keep) await dnsWrite(`/dns/delete/${domain}/${r.id}`, {}, `${keyPrefix}:delete:${r.id}`);
      if (keep && keep.content !== ipv4) await dnsWrite(`/dns/edit/${domain}/${keep.id}`, { type: 'A', content: ipv4, ttl: 600 }, `${keyPrefix}:edit:${keep.id}`);
      if (!keep) await dnsWrite(`/dns/create/${domain}`, { name: '', type: 'A', content: ipv4, ttl: 600 }, `${keyPrefix}:create:apex`);
      const confirmed = await records(domain);
      const routing = confirmed.filter(r => r.name === domain && routingTypes.has(r.type));
      requireValue(routing.length === 1 && routing[0].type === 'A' && routing[0].content === ipv4, 'DNS_NOT_CONFIRMED');
      return { domain, ipv4, configured: true as const };
    },
    async createCryptoTopup(input: { amountCents: number; idempotencyKey: string; startedAt: number; previouslyAttempted?: boolean }): Promise<DomainCryptoCheckout> {
      requireValue(Number.isSafeInteger(input.amountCents) && input.amountCents >= 100 && input.amountCents <= 50000, 'INVALID_TOPUP_AMOUNT');
      financialWrite(input);
      // Creating checkout is not a charge, but preserve its identity on an
      // ambiguous response: pending checkouts consume monthly top-up allowance.
      const response = await request('/account/topupCrypto', { amount: input.amountCents }, input.idempotencyKey, true, input.previouslyAttempted);
      const result = parse(z.object({ checkoutId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/), amount_cents: cents, estimatedFee_cents: cents, estimatedCredit_cents: cents, currency: z.literal('USDC'), network: z.literal('base'), payUrl: text, x402Url: text.nullable(), expiresAt: text.nullable() }), response.value, true);
      requireValue(result.amount_cents === input.amountCents && result.estimatedCredit_cents > 0 && result.estimatedCredit_cents + result.estimatedFee_cents === result.amount_cents, 'CHECKOUT_AMOUNT_MISMATCH', true);
      requireValue(/^https:\/\/payments\.coinbase\.com\/payment-sessions\/paymentSession_[A-Za-z0-9_-]+$/.test(result.payUrl), 'INVALID_CHECKOUT_URL', true);
      if (result.x402Url !== null) {
        requireValue(/^https:\/\/api\.cdp\.coinbase\.com\/platform\/v2\/payment-sessions\/paymentSession_[A-Za-z0-9_-]+\/authorizations\/x402$/.test(result.x402Url), 'INVALID_CHECKOUT_URL', true);
        requireValue(result.payUrl.split('/').at(-1) === result.x402Url.split('/').at(-3), 'CHECKOUT_IDENTITY_MISMATCH', true);
      }
      return { checkoutId: result.checkoutId, amountCents: result.amount_cents, estimatedFeeCents: result.estimatedFee_cents, estimatedCreditCents: result.estimatedCredit_cents, currency: result.currency, network: result.network, payUrl: result.payUrl, x402Url: result.x402Url, expiresAt: result.expiresAt === null ? null : timestamp(result.expiresAt, true), requestId: parse(text, response.requestId, true), replayed: response.replayed };
    },
    async cryptoTopupStatus(checkoutId: string) {
      requireValue(typeof checkoutId === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(checkoutId), 'INVALID_CHECKOUT_ID');
      const { value } = await request('/account/topupCryptoStatus/' + checkoutId);
      const result = parse(z.object({ checkoutId: text, state: z.enum(['ACTIVE', 'PROCESSING', 'COMPLETED', 'EXPIRED', 'FAILED', 'DEACTIVATED']), credited: z.boolean(), balance_cents: cents }), value);
      requireValue(result.checkoutId === checkoutId, 'CHECKOUT_IDENTITY_MISMATCH');
      requireValue(result.credited === (result.state === 'COMPLETED'), 'CHECKOUT_STATUS_INCONSISTENT');
      return { checkoutId, state: result.state, credited: result.credited, balanceCents: result.balance_cents };
    },
  };
}

export type DomainProvider = ReturnType<typeof createDomainProvider>;
