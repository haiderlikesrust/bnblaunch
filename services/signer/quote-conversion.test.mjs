import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {decodeFunctionData,encodeEventTopics,encodeAbiParameters,keccak256,parseAbi,parseTransaction,zeroAddress} from 'viem';
import {WalletStore} from './store.mjs';
import {SigningEngine} from './engine.mjs';
import {QuoteConversions} from './quote-conversion.mjs';
import {WBNB,V2_ROUTER,erc20QuoteAbi,v2ConversionAbi} from '../../shared/quote-pairs.mjs';
const asset='0x1111111111111111111111111111111111111111',token='0x2222222222222222222222222222222222222222',blockHash='0x'+'a'.repeat(64);
const transfers=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const transfer=(address,from,to,value)=>({address,topics:encodeEventTopics({abi:transfers,eventName:'Transfer',args:{from,to}}),data:encodeAbiParameters([{type:'uint256'}],[value])});
function fixture(){
 const store=new WalletStore(':memory:',randomBytes(32).toString('hex')),coinId=randomUUID(),wallet=store.provision(coinId);store.bindLaunch(coinId,token,'0x'+'b'.repeat(64));store.bindQuote(coinId,asset);
 const state={allowance:0n,quoteBalance:2000n,wrapped:0n,native:1000000000000000000n,nonce:0,lost:true,broadcasts:[],badReceipt:false},receipts=new Map();
 const output=amount=>amount*20000000000000n;
 const client={getChainId:async()=>56,getBlock:async()=>({number:104n,hash:blockHash,timestamp:BigInt(Math.floor(Date.now()/1000))}),getTransactionCount:async()=>state.nonce,getBalance:async()=>state.native,getGasPrice:async()=>1000000n,estimateGas:async()=>100000n,
  readContract:async({address,functionName,args=[]})=>{
   if(functionName==='balanceOf')return address.toLowerCase()===WBNB.toLowerCase()?state.wrapped:state.quoteBalance;
   if(functionName==='allowance')return state.allowance;
   if(functionName==='getAmountsOut')return args[1].map((_,i)=>i===0?args[0]:output(args[0]));
   throw Error('Unexpected read '+functionName);
  },simulateContract:async()=>{throw Error('No V3 pool')},
  getTransactionReceipt:async({hash})=>{if(receipts.has(hash))return receipts.get(hash);const e=Error('Not mined');e.name='TransactionReceiptNotFoundError';throw e;},
  sendRawTransaction:async({serializedTransaction})=>{
   const hash=keccak256(serializedTransaction);if(receipts.has(hash))return hash;
   const tx=parseTransaction(serializedTransaction);state.broadcasts.push(hash);state.nonce++;
   const row=store.db.prepare('SELECT * FROM intents WHERE tx_hash=?').get(hash);let logs=[];
   if(row.kind==='convert_approve'||row.kind==='convert_reset')state.allowance=decodeFunctionData({abi:erc20QuoteAbi,data:tx.data}).args[1];
   if(row.kind==='convert_swap'){
    const [amount]=decodeFunctionData({abi:v2ConversionAbi,data:tx.data}).args;state.quoteBalance-=amount;state.wrapped+=output(amount);state.allowance-=amount;
    logs=[transfer(asset,wallet.address,V2_ROUTER,amount),transfer(WBNB,V2_ROUTER,state.badReceipt?zeroAddress:wallet.address,output(amount))];
   }
   if(row.kind==='convert_unwrap'){
    const amount=decodeFunctionData({abi:erc20QuoteAbi,data:tx.data}).args[0];state.wrapped-=amount;state.native+=amount;
    logs=[{address:WBNB,topics:encodeEventTopics({abi:erc20QuoteAbi,eventName:'Withdrawal',args:{src:wallet.address}}),data:encodeAbiParameters([{type:'uint256'}],[amount])}];
   }
   receipts.set(hash,{status:'success',blockNumber:100n,blockHash,logs});if(state.lost){state.lost=false;throw Error('Accepted but reply lost');}return hash;
  }
 };
 const engine=new SigningEngine(store,client,{gasReserveWei:1000000000000000n,maxGasPriceWei:3000000000n,slippageBps:100});engine.bindLaunch=async()=>({});
 const conversions=new QuoteConversions(store,engine);engine.conversions=conversions;
 engine.protocolFees={quote:async()=>({quoteToken:asset,distributedQuoteUnits:'1000',distributedFeesWei:(await conversions.realized(coinId)).toString(),reserveWei:((await conversions.realized(coinId))*15n/100n).toString()})};
 return {store,coinId,wallet,client,state,engine,conversions,close:()=>store.close()};
}
test('quote fees convert through exact approval, swap and unwrap once despite lost replies; deposits are excluded',async()=>{
 const f=fixture();try{
  for(let i=0;i<10;i++)await f.conversions.tick();
  assert.equal(f.state.broadcasts.length,3);assert.equal(new Set(f.state.broadcasts).size,3);
  assert.equal(f.state.quoteBalance,1000n,'unearned token deposits were not sold');assert.equal(f.state.wrapped,0n);
  assert.equal(await f.conversions.realized(f.coinId),20000000000000000n,'only verified unwrap proceeds enter fees');
  assert.equal(f.conversions.consumed(f.coinId),1000n);assert.equal(f.store.db.prepare('SELECT phase FROM quote_conversions').get().phase,'complete');
  for(const row of f.store.db.prepare('SELECT id FROM intents').all())await f.engine.reconcile(row.id);
  assert.equal(f.state.broadcasts.length,3);assert.equal(await f.conversions.realized(f.coinId),20000000000000000n);
 }finally{f.close()}
});
test('forged conversion intents and unrelated output receipts cannot authorize or credit a swap',async()=>{
 const f=fixture();try{
  await assert.rejects(f.engine.execute({id:randomUUID(),coinId:f.coinId,kind:'convert_swap',amountWei:'1000',expiresAt:Date.now()+60000}),/not authorized/);
  f.state.badReceipt=true;await f.conversions.tick();await f.conversions.tick();await f.conversions.tick();
  await assert.rejects(f.conversions.tick(),/receipt/);assert.equal(await f.conversions.realized(f.coinId),0n);
 }finally{f.close()}
});
test('insufficient initial BNB prevents signing without discarding quote fees',async()=>{
 const f=fixture();try{f.state.native=0n;await assert.rejects(f.conversions.tick(),/Insufficient confirmed/);assert.equal(f.state.broadcasts.length,0);assert.equal(f.state.quoteBalance,2000n);assert.equal(await f.conversions.realized(f.coinId),0n);}finally{f.close()}
});
