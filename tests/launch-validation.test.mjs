import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {BaseError,ContractFunctionRevertedError,encodeErrorResult} from 'viem';
import {portalAbi} from '../shared/flap-contract.mjs';
register('./runtime-loader.mjs',import.meta.url);
globalThis.__shenTestEnv={};
const {initialBuyBnb,launchError}=await import('../lib/launch-validation.ts');
test('developer buy uses exact decimal amounts without rounding or implicit purchases',()=>{
 assert.equal(initialBuyBnb.parse(undefined),'0');
 for(const value of ['0','0.025','1','0.000000000000000001'])assert.equal(initialBuyBnb.parse(value),value);
 for(const value of [-1,0.01,'-1','1e3','0.0000000000000000001','','.5','NaN','Infinity','9'.repeat(80),' 1 '])assert.equal(initialBuyBnb.safeParse(value).success,false);
});
test('launch errors identify known contract reverts without exposing RPC data',()=>{
 const error=new BaseError('https://private-rpc.invalid/API-SECRET',{cause:new ContractFunctionRevertedError({abi:portalAbi,functionName:'newTokenV6',data:encodeErrorResult({abi:portalAbi,errorName:'InvalidDexThresholdType',args:[0]})})});
 const result=launchError(error,'contract validation');assert.equal(result.status,422);assert.match(result.message,/threshold/);assert.equal(result.message.includes('API-SECRET'),false);
});
