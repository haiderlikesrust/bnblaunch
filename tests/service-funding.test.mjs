import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceFundingAmount,serviceFundingBounds,SOLCARD_BNB_ADDRESS} from '../shared/service-funding.mjs';
test('SolCard service payment rounds up to 0.01 BNB only with funds and real provider collateral',()=>{
 const args={targetMicrousd:5000000,price:60000000000n,availableWei:10n**18n,capacityMicrousd:20000000,address:SOLCARD_BNB_ADDRESS};
 assert.deepEqual(serviceFundingAmount(args),{amountWei:10000000000000000n,reserveMicrousd:7200000});
 assert.equal(serviceFundingAmount({...args,availableWei:9999999999999999n}),null);
 assert.equal(serviceFundingAmount({...args,capacityMicrousd:7199999}),null);
 assert.equal(serviceFundingAmount({...args,targetMicrousd:40000000000,availableWei:100n*10n**18n,capacityMicrousd:50000000000}),null);
 assert.equal(serviceFundingBounds(SOLCARD_BNB_ADDRESS).maximumWei,65770000000000000000n);
});
