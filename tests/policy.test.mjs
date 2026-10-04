import test from 'node:test';
import assert from 'node:assert/strict';
import { readiness, creatorInput } from '../lib/policy.ts';
import { PLATFORM_POLICY, operatingFunds } from '../lib/platform-policy.ts';
const blankCoin={...PLATFORM_POLICY,id:'test',name:'Test',symbol:'TEST',description:'Testing a community agent',language:'en',research:true,social:true,website:true,images:true,balance:0,state:'draft'};
import { launchCalldata, launchParams, portalAbi, predictedAddress } from '../lib/flap.ts';
import { decodeFunctionData, zeroAddress } from 'viem';
const policy={balanceWei:1000n,thresholdWei:800n,reserveWei:100n,pendingWei:0n,paused:false,confirmed:true,creditMicrousd:100000,providerReady:true};
test('pause takes precedence over funding and provider readiness',()=>assert.equal(readiness({...policy,paused:true}).reason,'paused'));
test('unconfirmed funds never activate an agent',()=>assert.equal(readiness({...policy,confirmed:false}).ready,false));
test('pending spend is excluded from available treasury balance',()=>assert.equal(readiness({...policy,pendingWei:300n}).ready,false));
test('shared platform API key does not bypass a coin compute ledger',()=>assert.equal(readiness({...policy,creditMicrousd:0}).reason,'coin_compute_credit_required'));
test('exact threshold is sufficient when reserve is covered',()=>assert.equal(readiness({...policy,balanceWei:800n}).ready,true));
test('Flap V6 encoding preserves treasury allocation and no initial buy',()=>{const coin={...blankCoin,id:'test',name:'Test',symbol:'TEST',description:'Testing a community agent'};const treasury='0x1111111111111111111111111111111111111111';const salt='0x'+'1'.repeat(64);const decoded=decodeFunctionData({abi:portalAbi,data:launchCalldata(coin,'QmTest',treasury,salt)});assert.equal(decoded.functionName,'newTokenV6');const p=decoded.args[0];assert.equal(p.tokenVersion,6);assert.equal(p.quoteAmt,0n);assert.equal(p.beneficiary.toLowerCase(),treasury);assert.equal(p.mktBps+p.deflationBps+p.dividendBps+p.lpBps,10000);assert.equal(p.dividendToken,zeroAddress);assert.equal(p.buyTaxRate,200);assert.equal(p.mktBps,10000);assert.equal(p.dividendBps,0);assert.equal(predictedAddress(salt),predictedAddress(salt))});

test('creator cannot set tax, reserve, allocation or a spending budget',()=>{const c={name:'Test',symbol:'TEST',description:'Testing a community agent',language:'en',research:true,social:true,website:true,images:true};assert.equal(creatorInput.safeParse(c).success,true);for(const key of ['taxRate','reserve','dailyBudget','treasury','threshold','aiCreditMicrousd'])assert.equal(creatorInput.safeParse({...c,[key]:999}).success,false)});
test('adaptive spending covers all known costs before discretionary action',()=>{const r=operatingFunds({confirmedWei:1000n,serviceCostsWei:200n,pendingWei:100n,gasWei:50n,proposedDailyWei:900n});assert.equal(r.availableWei,650n);assert.equal(r.plannedDailyWei,650n)});
test('adaptive spending has no arbitrary low daily cap',()=>{const r=operatingFunds({confirmedWei:1000n,serviceCostsWei:0n,pendingWei:0n,gasWei:0n,proposedDailyWei:950n});assert.equal(r.plannedDailyWei,950n)});
test('unfunded expenses prohibit discretionary spending',()=>assert.equal(operatingFunds({confirmedWei:100n,serviceCostsWei:200n,pendingWei:0n,gasWei:0n,proposedDailyWei:50n}).plannedDailyWei,0n));