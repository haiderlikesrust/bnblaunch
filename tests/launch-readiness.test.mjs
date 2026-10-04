import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./runtime-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={};
const {launchReadiness,requireLaunchReady,agentReadiness}=await import('../lib/signer.ts');
const originalFetch=globalThis.fetch;
const coin={id:'coin',social:true,images:true,research:true,website:true};
function setup(status={chainId:56,signingReady:true}){
 for(const key of Object.keys(env))delete env[key];
 Object.assign(env,{SHEN_RUNTIME:'node',SIGNER_URL:'http://signer:8080',SIGNER_WEB_TOKEN:'a'.repeat(48)});
 env.DB={prepare(){throw Error('Launch must not depend on worker health or X account storage')}};
 globalThis.fetch=async(url,init)=>{
  assert.equal(String(url),'http://signer:8080/v1/status');
  assert.equal(init.method,'GET');
  assert.equal(init.headers.Authorization,'Bearer '+env.SIGNER_WEB_TOKEN);
  return Response.json(status);
 };
}
test.afterEach(()=>{globalThis.fetch=originalFetch});
test('launch proceeds with every optional feature selected but no providers, X account or worker',async()=>{
 setup();assert.equal((await launchReadiness(coin)).ready,true);
 await requireLaunchReady(coin);
 assert.equal((await agentReadiness(coin)).ready,false,'launch availability must not claim the agent can run');
});
test('launch still requires a configured, authenticated BNB signing service',async()=>{
 setup();delete env.SIGNER_URL;
 assert.equal((await launchReadiness(coin)).ready,false);
 setup({chainId:1,signingReady:true});await assert.rejects(requireLaunchReady(coin));
 setup({chainId:56,signingReady:false});await assert.rejects(requireLaunchReady(coin));
 setup();globalThis.fetch=async()=>new Response(null,{status:401});await assert.rejects(requireLaunchReady(coin));
 setup();env.SIGNER_WEB_TOKEN='short';await assert.rejects(requireLaunchReady(coin));
});
test('agent readiness still requires a current, valid heartbeat and core execution capabilities',async()=>{
 setup();env.OPENROUTER_API_KEY='test';
 let health=null;
 env.DB={prepare(){return {async first(){return health}}}};
 assert.equal((await agentReadiness(coin)).ready,false);
 health={checked_at:Date.now()-180000,capabilities:'[]'};
 assert.equal((await agentReadiness(coin)).ready,false);
 health={checked_at:Date.now(),capabilities:'invalid'};
 assert.equal((await agentReadiness(coin)).ready,false);
 health.capabilities='[]';assert.equal((await agentReadiness(coin)).ready,false);
 health.capabilities=JSON.stringify(['funding-reconciliation','cost-reservations','autonomous-planning','transaction-execution']);
 assert.equal((await agentReadiness(coin)).ready,true,'optional capabilities must not disable the entire agent');
});
