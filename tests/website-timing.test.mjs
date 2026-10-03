import test from 'node:test';
import assert from 'node:assert/strict';
import {websiteTiming} from '../lib/website-timing.ts';
test('website guidance becomes a priority around $500–600 in distributed fees, without a startup trigger',()=>{
 const price=60000000000n;
 assert.equal(websiteTiming('100000000000000000',price).priority,'growing');
 assert.equal(websiteTiming('900000000000000000',price).estimatedCollectedFeesUsd,540);
 assert.equal(websiteTiming('900000000000000000',price).priority,'ready');
 assert.equal(websiteTiming('1000000000000000000',price).priority,'overdue');
 assert.equal(websiteTiming(undefined,price).priority,'unknown');
 assert.equal(websiteTiming('1000000000000000000',undefined).estimatedCollectedFeesUsd,null);
 assert.equal(websiteTiming('1000000000000000000',price).automaticOnActivation,false);
});
