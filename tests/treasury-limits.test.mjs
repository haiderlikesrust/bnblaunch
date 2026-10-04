import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlanFunds, publicationLinksAllowed } from '../lib/runtime-policy.ts';
import { boundedPlanningContext, contextBytes } from '../lib/planning-context.ts';
import twitterText from 'twitter-text';

const BNB=10n**18n,plan=(kind,amountWei)=>({transaction:{kind,amountWei:String(amountWei),reason:'test'}});
test('treasury actions use verified funds without new hourly or percentage caps',()=>{
 assert.equal(validatePlanFunds(plan('rewards',BNB),BNB,0n).transaction.kind,'rewards');
 assert.equal(validatePlanFunds(plan('burn',BNB),0n,BNB).transaction.kind,'burn');
 assert.throws(()=>validatePlanFunds(plan('rewards',BNB+1n),BNB,0n),/available funds/);
 assert.throws(()=>validatePlanFunds(plan('burn',BNB+1n),0n,BNB),/token balance/);
});

test('X posts may link only to SHEN, X, BscScan and Flap',()=>{
 const ok=t=>publicationLinksAllowed(t,'https://shen.now',twitterText.extractUrls(t));
 assert.equal(ok('Our site is live: https://shen.now/sites/abc'),true);
 assert.equal(ok('Receipt: https://bscscan.com/tx/0xabc and https://x.com/shendotnow/status/1'),true);
 assert.equal(ok('No links at all.'),true);
 for(const bad of ['Claim here: https://shen-now.xyz/claim','Visit evil.xyz now','http://flap.sh.evil.com/x','evil.com/shen.now'])assert.equal(ok(bad),false,bad);
});
test('growing history never makes the planning context impossible to fit',()=>{
 const system='S'.repeat(13800),long=zh=>(zh?'中文任务说明':'Detailed task notes ').repeat(400);
 const snapshot={mission:long(true).slice(0,2000),story:long(true).slice(0,600),tasks:Array.from({length:6},(_,i)=>({id:'t'+i,goal:long(true).slice(0,180),nextStep:long(true).slice(0,240)})),recentTreasuryActions:Array.from({length:8},()=>({reason:long(false).slice(0,300)})),eventRadar:Array.from({length:12},()=>({message:long(true).slice(0,280)})),previousRejection:{code:'policy',reviewReason:long(false).slice(0,1000)},memory:{entries:[{summary:long(true).slice(0,2000),nextSteps:long(true).slice(0,800)}]},sources:[],browserResults:[],researchResults:[],recentResearch:[],community:{recent:[]},website:null,spending:{market:{lastCandles:[]}},treasuryWei:'123456789012345678901234567890'};
 assert.ok(contextBytes(system,snapshot)>31000,'the input really is oversized');
 const bounded=boundedPlanningContext(system,snapshot);
 assert.ok(contextBytes(system,bounded)<=31000);assert.equal(bounded.contextTruncated,true);assert.equal(bounded.treasuryWei,snapshot.treasuryWei,'financial values are kept intact');assert.ok(bounded.mission.length>0);
});
