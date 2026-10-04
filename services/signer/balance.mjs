export function feeAccountingIssue(error){
 const parts=[];let current=error;
 for(let i=0;i<8&&current;i++,current=current.cause)parts.push(String(current.message??''),String(current.details??''));
 const text=parts.join(' ').toLowerCase();
 if(/missing trie node|historical state|state is not available|pruned|archive node/.test(text))return 'historical_rpc_required';
 if(/limit exceeded|exceeds defined limit|blocks? range|\d+ blocks|too many results/.test(text))return 'rpc_log_limit';
 if(text.includes('audit is catching up'))return 'fee_audit_pending';
 return 'fee_verification_failed';
}

export async function walletBalanceSnapshot(wallet,engine,client,protocolFees){
 const head=await engine.chainReady(),blockNumber=head.number-3n;
 const balance=await client.getBalance({address:wallet.address,blockNumber});
 const snapshot={coinId:wallet.coin_id,address:wallet.address,tokenAddress:wallet.token_address,balanceWei:balance.toString(),block:blockNumber.toString(),observedAt:Date.now()};
 try{
  const fees=await protocolFees.quote(wallet);
  return {...snapshot,protocolReserveWei:fees.reserveWei,feeAccountingReady:true};
 }catch(error){
  // A balance is observable even when spendable fee reserves cannot be verified.
  // Never substitute zero for an unknown protocol reserve.
  return {...snapshot,protocolReserveWei:null,feeAccountingReady:false,feeAccountingIssue:feeAccountingIssue(error)};
 }
}
