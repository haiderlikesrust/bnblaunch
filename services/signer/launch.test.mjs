import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {encodeFunctionData,zeroAddress} from 'viem';
import {PORTAL,TAX_V3_IMPL,portalAbi} from '../../shared/flap-contract.mjs';
import {WalletStore} from './store.mjs';
import {SigningEngine} from './engine.mjs';

for(const rate of [200,300])for(const buy of [0n,25000000000000000n])test(`signer binds a ${rate} bps ${buy} wei launch only with matching value and permanent economics`,async()=>{
 const store=new WalletStore(':memory:',randomBytes(32).toString('hex')),coin=randomUUID(),wallet=store.provision(coin);
 const hash='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64);
 const params={name:'Test',symbol:'TEST',meta:'QmTest',dexThresh:1,salt:'0x0f735e321665009d7a32b353ccb4f2f5b7771e33c94c160e20c8be40e1e9f56e',migratorType:1,quoteToken:zeroAddress,quoteAmt:buy,beneficiary:wallet.address,permitData:'0x',extensionID:'0x'+'0'.repeat(64),extensionData:'0x',dexId:0,lpFeeProfile:0,buyTaxRate:rate,sellTaxRate:rate,taxDuration:31536000n,antiFarmerDuration:3600n,mktBps:10000,deflationBps:0,dividendBps:0,lpBps:0,minimumShareBalance:0n,dividendToken:zeroAddress,commissionReceiver:zeroAddress,tokenVersion:6};
 let value=buy+1n,overrides={};
 const client={getChainId:async()=>56,getBlock:async()=>({number:104n,hash:blockHash,timestamp:BigInt(Math.floor(Date.now()/1000))}),getTransaction:async()=>({to:PORTAL,value,input:encodeFunctionData({abi:portalAbi,functionName:'newTokenV6',args:[{...params,...overrides}]})}),getTransactionReceipt:async()=>({status:'success',blockNumber:100n,blockHash}),getCode:async()=>'0x363d3d373d3d3d363d73'+TAX_V3_IMPL.slice(2).toLowerCase()+'5af43d82803e903d91602b57fd5bf3'};
 const engine=new SigningEngine(store,client,{});
 try{
  await assert.rejects(engine.bindLaunch(coin,hash),/platform economics/);
  value=buy;
  for(const changed of [{beneficiary:zeroAddress},{mktBps:8500},{buyTaxRate:0},{commissionReceiver:'0x'+'1'.repeat(40)},{taxDuration:0n},{extensionData:'0xab'}]){
   overrides=changed;await assert.rejects(engine.bindLaunch(coin,hash),/platform economics/);
  }
  overrides={};const result=await engine.bindLaunch(coin,hash);
  assert.equal(result.tokenAddress,'0xF1636B3a44350AA4f6A7Ba9A5191D761a4A97777');
  assert.equal(store.wallet(coin).launch_hash,hash);
 }finally{store.close()}
});
