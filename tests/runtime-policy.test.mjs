import test from 'node:test';
import assert from 'node:assert/strict';
import { agentPlan, validatePlanFunds } from '../lib/runtime-policy.ts';
const plan={summary:'Review confirmed activity.',nextCheckMinutes:60,closeChatMinutes:0,transaction:{kind:'none',amountWei:'0',reason:'No action needed.'},website:null};
test('planner cannot set recipients, call data, arbitrary tools or a new mission',()=>{
  for(const field of ['recipient','calldata','tools','purpose'])assert.equal(agentPlan.safeParse({...plan,[field]:'untrusted'}).success,false);
  assert.equal(agentPlan.safeParse({...plan,transaction:{...plan.transaction,recipient:'0x123'}}).success,false);
});
test('spend validation uses exact integer units and separate token balances',()=>{
  assert.equal(validatePlanFunds(agentPlan.parse(plan),10n,20n).transaction.kind,'none');
  assert.throws(()=>validatePlanFunds({...plan,transaction:{...plan.transaction,kind:'buyback',amountWei:'11'}},10n,20n));
  assert.throws(()=>validatePlanFunds({...plan,transaction:{...plan.transaction,kind:'burn',amountWei:'21'}},10n,20n));
  assert.throws(()=>validatePlanFunds({...plan,transaction:{...plan.transaction,kind:'none',amountWei:'1'}},10n,20n));
});
test('reward and combined buy/burn plans are BNB budgets and cannot inject recipients',()=>{
 for(const kind of ['rewards','buyback_burn']){
  const p=agentPlan.parse({...plan,transaction:{kind,amountWei:'10',reason:'Use available funds transparently.'}});
  assert.equal(validatePlanFunds(p,10n,0n).transaction.kind,kind);
  assert.throws(()=>validatePlanFunds(p,9n,1000n));
  assert.equal(agentPlan.safeParse({...p,transaction:{...p.transaction,recipient:'0x123'}}).success,false);
 }
});
