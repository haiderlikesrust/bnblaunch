import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./runtime-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={};
const {agentConsole}=await import('../lib/agent-console.ts');

test('console reports recorded failures and actual worker check time instead of stale zero balance',async()=>{
 const now=Date.now();let reason='rpc_log_limit',capabilities=['autonomous-planning'];
 env.DB={prepare(sql){return {bind(){return this},async first(){
  if(sql.includes('runtime_leases'))return {lease_until:0,next_run_at:now+30000,last_checked_at:now-12000,last_reason:reason};
  if(sql.includes('runtime_health'))return {checked_at:now,capabilities:JSON.stringify(capabilities)};
  if(sql.includes('agent_memories'))return {entries:0,updated:null};return null;
 },async all(){return {results:[]}}}}};
 const coin={id:'coin',tokenAddress:'0x123',balance:0,threshold:.01};
 const failed=await agentConsole(coin);assert.equal(failed.state,'rpc_log_limit');assert.equal(failed.lastCheckAt,now-12000);assert.notEqual(failed.lastCheckAt,failed.observedAt);
 reason='awaiting_treasury_funding';assert.equal((await agentConsole(coin)).state,'awaiting_funds');
 for(const stage of ['research_configuration_required','model_pricing_unavailable','funding_price_unavailable','service_capacity_unavailable','planner_request_failed']){reason=stage;assert.equal((await agentConsole(coin)).state,stage);}
 reason=null;assert.equal((await agentConsole(coin)).state,'check_unconfirmed');
 capabilities=[];assert.equal((await agentConsole(coin)).state,'services_unavailable');
});
