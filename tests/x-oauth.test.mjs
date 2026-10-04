import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { openServiceSecret, sealServiceSecret } from '../shared/service-secrets.mjs';
register('./x-oauth-loader.mjs', import.meta.url);
const env = globalThis.__shenTestEnv = { APP_ORIGIN: 'https://shen.now', X_CLIENT_ID: 'client', X_CLIENT_SECRET: 'secret', X_API_BEARER_TOKEN: 'billing', SERVICE_CREDENTIALS_KEY: randomBytes(32).toString('hex') };
const { beginXConnection, finishXConnection, socialStatus } = await import('../lib/social-onboarding.ts');
const { xAccount, xSession, xCosts } = await import('../lib/social-config.ts');
const { X_SCOPES } = await import('../lib/x-official.ts');
const {GET:callback}=await import('../app/api/social/x/callback/route.ts');
const {xConnectionCode}=await import('../lib/x-connection-result.ts');
const originalFetch = globalThis.fetch;
const json = v => Response.json(v);
function fixture() {
 const sql = new DatabaseSync(':memory:');
 for (const name of readdirSync('drizzle').filter(n => n.endsWith('.sql')).sort()) sql.exec(readFileSync('drizzle/' + name, 'utf8'));
 function prepare(query, args = []) { return { bind(...values) { return prepare(query, values); }, async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } }; }, async first() { return sql.prepare(query).get(...args) ?? null; } }; }
 env.DB = { prepare };
 sql.exec("INSERT INTO coins(id,owner,config,created_at,updated_at) VALUES('coin','owner','{}','now','now'),('other','owner','{}','now','now')");
 let userId = '123', requests = [], scope = X_SCOPES.join(' '), failRefresh = false;
 globalThis.fetch = async (url, init = {}) => {
  requests.push({ url, init });
  if (url.endsWith('/usage/credits')) return json({ data: { total_balance: 10 } });
  if (url.endsWith('/oauth2/token')) {
   if (failRefresh && init.body.get('grant_type') === 'refresh_token') throw Error('ambiguous refresh');
   return json({ token_type: 'bearer', access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 7200, scope });
  }
  if (url.endsWith('/users/me')) return json({ data: { id: userId, username: 'shen' } });
  throw Error('Unexpected external request');
 };
 return { sql, requests, user(id) { userId = id; }, scopes(value) { scope = value; }, failRefresh() { failRefresh = true; }, close() { sql.close(); globalThis.fetch = originalFetch;delete globalThis.__xTestCookies; } };
}

async function callbackSession(f,state){
 const session='a'.repeat(64),hash=createHash('sha256').update(session).digest('hex');
 f.sql.prepare('INSERT INTO wallet_sessions(id,wallet,expires_at) VALUES(?,?,?)').run(hash,'owner',Date.now()+60000);
 globalThis.__xTestCookies={shen_session:session,shen_x_oauth:state};
}
const callbackRequest=state=>new Request('https://shen.now/api/social/x/callback?state='+state+'&code=private-authorization-code');

for(const [status,message] of [[401,/application Bearer Token/],[403,/billing permissions/],[402,/insufficient API credit/],[429,/rate-limited/],[500,/Could not verify/]])test(`connection start explains X credit HTTP ${status} without leaking provider output`,async()=>{
 const f=fixture();try{
  globalThis.fetch=async()=>Response.json({error:'private-provider-detail'},{status});
  await assert.rejects(beginXConnection('coin','owner'),e=>e.status===503&&message.test(e.message)&&!e.message.includes('private-provider-detail'));
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM x_oauth_attempts').get().count,0);
 }finally{f.close()}
});
test('connection start distinguishes storage failure from unavailable credit',async()=>{
 const f=fixture();try{
  env.DB={prepare(){throw Error('private-database-value')}};
  await assert.rejects(beginXConnection('coin','owner'),e=>e.status===503&&e.message.includes('database migrations')&&!e.message.includes('private-database-value'));
 }finally{f.close()}
});
test('unreachable or malformed X balance cannot start OAuth; zero balance has a funding message',async()=>{
 const f=fixture();try{
  for(const fetchBalance of [async()=>{throw Error('private-network-detail')},async()=>Response.json({data:{total_balance:'unknown'}})]){
   globalThis.fetch=fetchBalance;
   await assert.rejects(beginXConnection('coin','owner'),e=>e.status===503&&e.message.startsWith('Could not verify')&&!e.message.includes('private-'));
  }
  globalThis.fetch=async()=>Response.json({data:{total_balance:0}});
  await assert.rejects(beginXConnection('coin','owner'),/credit needs replenishing/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM x_oauth_attempts').get().count,0);
 }finally{f.close()}
});

for(const [stage,status,providerError,expected] of [
 ['token',401,'invalid_client','oauth_client'],['token',400,'invalid_grant','expired'],
 ['profile',403,'Forbidden','profile_access'],['profile',402,'CreditsDepleted','credits'],['profile',429,'TooManyRequests','rate_limited'],
])test(`OAuth callback reports ${expected} on the owned coin without exposing secrets`,async()=>{
 const f=fixture();try{
  const start=await beginXConnection('coin','owner');await callbackSession(f,start.state);
  const previous=globalThis.fetch;
  globalThis.fetch=async(url,init)=>url.endsWith(stage==='token'?'/oauth2/token':'/users/me')?Response.json({error:providerError,error_description:'private-provider-secret'},{status}):previous(url,init);
  const result=await callback(callbackRequest(start.state));
  assert.equal(result.status,303);
  assert.equal(result.headers.get('location'),'https://shen.now/token/coin?x=failed&x_error='+expected);
  assert.equal(result.headers.get('referrer-policy'),'no-referrer');
  assert.match(result.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await xAccount('coin')),null);
  assert.equal(f.sql.prepare('SELECT status FROM x_oauth_attempts').get().status,'failed');
  assert.equal(JSON.stringify([...result.headers]).includes('private-'),false);
 }finally{f.close()}
});

test('successful callback returns to coin; absent session and forged state reveal no coin',async()=>{
 const f=fixture();try{
  const start=await beginXConnection('coin','owner');
  assert.equal((await callback(callbackRequest(start.state))).headers.get('location'),'https://shen.now/agents?x=failed&x_error=session_required');
  await callbackSession(f,start.state);
  assert.equal((await callback(callbackRequest('b'.repeat(64)))).headers.get('location'),'https://shen.now/agents?x=failed&x_error=browser_mismatch');
  assert.equal((await callback(callbackRequest(start.state))).headers.get('location'),'https://shen.now/token/coin?x=connected');
  assert.equal((await socialStatus('coin')).connected,true);
  for(const raw of ['__proto__','constructor','<script>','private-provider-secret',null])assert.equal(xConnectionCode(raw),'connection_failed');
 }finally{f.close()}
});
test('OAuth binds browser, owner, PKCE and one-time state; stores encrypted tokens without a public post', async () => {
 const f = fixture(); try {
  const start = await beginXConnection('coin', 'owner'), url = new URL(start.url);
  assert.equal(url.origin, 'https://x.com'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://shen.now/api/social/x/callback');
  await assert.rejects(finishXConnection(start.state, 'wrong', 'owner', 'code'));
  await assert.rejects(finishXConnection(start.state, start.state, 'stranger', 'code'));
  assert.equal(await finishXConnection(start.state, start.state, 'owner', 'code'), 'coin');
  const exchange = f.requests.find(r => r.url.endsWith('/oauth2/token'));
  assert.equal(createHash('sha256').update(exchange.init.body.get('code_verifier')).digest('base64url'), url.searchParams.get('code_challenge'));
  const account = await xAccount('coin'); assert.equal(account.auth_type, 'oauth2'); assert.equal(account.encrypted_session.includes('access-secret'), false);
  assert.equal((await xSession(account)).accessToken, 'access-secret');
  assert.equal(f.sql.prepare('SELECT encrypted_verifier FROM x_oauth_attempts').get().encrypted_verifier, '');
  assert.equal(f.requests.some(r => r.url.endsWith('/tweets')), false);
  await assert.rejects(finishXConnection(start.state, start.state, 'owner', 'code'));
  assert.equal((await socialStatus('coin')).connected, true);
 } finally { f.close(); }
});
test('OAuth rejects identity swaps, reuse across coins and insufficient scopes', async () => {
 const f = fixture(); try {
  let start = await beginXConnection('coin', 'owner'); await finishXConnection(start.state, start.state, 'owner', 'code');
  start = await beginXConnection('other', 'owner'); await assert.rejects(finishXConnection(start.state, start.state, 'owner', 'code'));
  f.user('456'); start = await beginXConnection('coin', 'owner'); await assert.rejects(finishXConnection(start.state, start.state, 'owner', 'code'));
  assert.equal((await xAccount('coin')).user_id, '123');
  f.sql.exec('DELETE FROM x_oauth_attempts'); f.scopes('tweet.read users.read');
  start = await beginXConnection('other', 'owner'); await assert.rejects(finishXConnection(start.state, start.state, 'owner', 'code'));
  assert.equal(await xAccount('other'), null);
 } finally { f.close(); }
});
test('expired/denied OAuth never exchanges a code; legacy accounts require reconnect', async () => {
 const f = fixture(); try {
  let start = await beginXConnection('coin', 'owner'); f.sql.exec('UPDATE x_oauth_attempts SET expires_at=1');
  await assert.rejects(finishXConnection(start.state, start.state, 'owner', 'code'));
  start = await beginXConnection('coin', 'owner'); await assert.rejects(finishXConnection(start.state, start.state, 'owner', null, true));
  assert.equal(f.requests.some(r => r.url.endsWith('/oauth2/token')), false);
  f.sql.exec("INSERT INTO x_accounts(coin_id,user_id,username,encrypted_session,version,updated_at) VALUES('coin','123','shen','old-cookie','v1',1)");
  assert.equal((await socialStatus('coin')).reconnectRequired, true);
  await assert.rejects(xSession(await xAccount('coin')));
 } finally { f.close(); }
});
test('refresh is serialized and an ambiguous refresh requires reconnect instead of reuse', async () => {
 const f = fixture(); try {
  const start = await beginXConnection('coin', 'owner'); await finishXConnection(start.state, start.state, 'owner', 'code');
  async function expire() {
   const account = await xAccount('coin'), context = 'coin:123:' + account.version;
   const tokens = await openServiceSecret(env.SERVICE_CREDENTIALS_KEY, context, account.encrypted_session);
   tokens.expiresAt = 1;
   f.sql.prepare('UPDATE x_accounts SET encrypted_session=?').run(await sealServiceSecret(env.SERVICE_CREDENTIALS_KEY, context, tokens));
  }
  await expire(); const account = await xAccount('coin');
  const values = await Promise.allSettled([xSession({ ...account }), xSession({ ...account })]);
  assert.equal(values.filter(v => v.status === 'fulfilled').length, 1);
  assert.equal(f.requests.filter(r => r.init.body?.get?.('grant_type') === 'refresh_token').length, 1);
  await expire(); f.failRefresh(); await assert.rejects(xSession(await xAccount('coin')));
  assert.equal((await socialStatus('coin')).reconnectRequired, true);
  await assert.rejects(xSession(await xAccount('coin')));
  assert.equal(xCosts('Visit shen.now').post, 200000); assert.equal(xCosts('Community update').post, 15000);
 } finally { f.close(); }
});
