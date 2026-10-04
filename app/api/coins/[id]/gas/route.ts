import {z} from 'zod';
import {formatEther,toHex,zeroAddress,type Address,type Hex} from 'viem';
import {AppError,body,db,failure,identity,ownedCoin,response} from '@/lib/server';
import {agentWallet,signerRequest} from '@/lib/signer';
import {chainClient} from '@/lib/providers';
import {gasDepositTarget,sameAddress} from '@/shared/quote-pairs.mjs';
import {verifyGasDeposit} from '@/lib/gas-deposit';
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('peek')}).strict(),
 z.object({action:z.literal('prepare')}).strict(),
 z.object({action:z.literal('submitted'),hash:z.string().regex(/^0x[0-9a-fA-F]{64}$/)}).strict(),
 z.object({action:z.literal('confirm')}).strict(),
]);
type Deposit={coin_id:string;creator:string;wallet:string;amount_wei:string;nonce:number;tx_hash:string|null;status:string};
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const owner=await identity(request),{coin}=await ownedCoin((await params).id,owner),v=input.parse(await body(request));
  if(!coin.quoteToken||sameAddress(coin.quoteToken,zeroAddress))return response({ready:true,required:false});
  if(!coin.tokenAddress)throw new AppError(409,'The launch must be confirmed before funding agent gas.');
  const wallet=await agentWallet(coin.id),client=chainClient(),now=Date.now();
  if(await client.getChainId()!==56)throw new AppError(503,'BNB Chain RPC unavailable.');
  let saved=await db().prepare('SELECT * FROM agent_gas_deposits WHERE coin_id=?').bind(coin.id).first<Deposit>();
  if(v.action==='submitted'){
   if(!saved)throw new AppError(409,'Prepare a gas deposit first.');
   const sent=await client.getTransaction({hash:v.hash as Hex});
   if(sent.nonce!==saved.nonce||sent.from.toLowerCase()!==saved.creator||sent.to?.toLowerCase()!==saved.wallet||sent.value!==BigInt(saved.amount_wei)||sent.input!=='0x')throw new AppError(400,'That transaction does not match the saved gas deposit. Retry preparation or provide its matching hash.');
   if(saved.tx_hash&&saved.tx_hash!==v.hash.toLowerCase()){
    const verified=await verifyGasDeposit(client,{...saved,tx_hash:v.hash});
    if(!verified)throw new AppError(409,'Wait for the replacement gas transaction to confirm.');
    await db().prepare('UPDATE agent_gas_deposits SET tx_hash=? WHERE coin_id=? AND tx_hash=?').bind(v.hash.toLowerCase(),coin.id,saved.tx_hash).run();
   }
   await db().prepare("UPDATE agent_gas_deposits SET tx_hash=?,status='submitted',updated_at=? WHERE coin_id=? AND tx_hash IS NULL").bind(v.hash.toLowerCase(),now,coin.id).run();
   return response({ok:true});
  }
  if(saved?.tx_hash){
   try{
    const verified=await verifyGasDeposit(client,{...saved,tx_hash:saved.tx_hash});
    if(!verified)return response({ready:false,pending:true,hash:saved.tx_hash});
    await db().prepare("UPDATE agent_gas_deposits SET status='confirmed',block_number=?,block_hash=?,updated_at=? WHERE coin_id=? AND tx_hash=?").bind(verified.blockNumber,verified.blockHash,now,coin.id,saved.tx_hash).run();
    return response({ready:true,required:true,hash:saved.tx_hash,amountBnb:formatEther(BigInt(saved.amount_wei))});
   }catch(e){
    if(!(e instanceof AppError)||e.message!=='The gas deposit reverted.')throw e;
    if(v.action!=='prepare')return response({ready:false,reverted:true,error:'The gas deposit reverted. Retry funding from the coin page.'});
    const nonce=await client.getTransactionCount({address:owner as Address,blockTag:'latest'});
    if(nonce!==await client.getTransactionCount({address:owner as Address,blockTag:'pending'}))throw new AppError(409,'Wait for the pending wallet transaction.');
    await db().prepare("UPDATE agent_gas_deposits SET tx_hash=NULL,status='prepared',nonce=?,updated_at=? WHERE coin_id=? AND tx_hash=?").bind(nonce,now,coin.id,saved.tx_hash).run();
    saved={...saved,tx_hash:null,status:'prepared',nonce};
   }
  }
  if(v.action==='confirm')throw new AppError(409,'The deposit transaction has not been recorded.');
  const status=await signerRequest<{gasReserveWei:string;maxGasPriceWei:string}>('/v1/status');
  const target=gasDepositTarget(BigInt(status.gasReserveWei),BigInt(status.maxGasPriceWei));
  const at=await client.getBlockNumber(),balance=await client.getBalance({address:wallet,blockNumber:at-3n});
  if(balance>=target)return response({ready:true,required:true,source:'confirmed-wallet-balance'});
  if(v.action==='peek')return response({ready:false,required:true,amountBnb:formatEther(saved?BigInt(saved.amount_wei):target-balance)});
  if(!saved){
   const [nonce,confirmedNonce]=await Promise.all([client.getTransactionCount({address:owner as Address,blockTag:'pending'}),client.getTransactionCount({address:owner as Address,blockTag:'latest'})]);
   if(nonce!==confirmedNonce)throw new AppError(409,'Wait for your pending wallet transaction before funding agent gas.');
   await db().prepare("INSERT INTO agent_gas_deposits(coin_id,creator,wallet,amount_wei,nonce,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(coin_id) DO NOTHING").bind(coin.id,owner.toLowerCase(),wallet.toLowerCase(),(target-balance).toString(),nonce,now,now).run();
   saved=await db().prepare('SELECT * FROM agent_gas_deposits WHERE coin_id=?').bind(coin.id).first<Deposit>();
  }
  if(!saved||saved.creator!==owner.toLowerCase()||saved.wallet!==wallet.toLowerCase())throw new AppError(409,'Gas deposit wallet mismatch.');
  if(await client.getTransactionCount({address:owner as Address,blockTag:'latest'})>saved.nonce)throw new AppError(409,'Your wallet used the saved gas-deposit nonce. Paste the gas transaction hash below to verify it; do not send another deposit.');
  return response({ready:false,required:true,amountBnb:formatEther(BigInt(saved.amount_wei)),transaction:{from:saved.creator,to:wallet,value:toHex(BigInt(saved.amount_wei)),nonce:toHex(saved.nonce),data:'0x',chainId:'0x38'},note:'BNB goes directly to this agent for gas. It is separate from trading fees and the developer buy.'});
 }catch(e){return failure(e instanceof AppError?e:new AppError(503,'Gas deposit verification is pending. Retry the same transaction; do not send another.'))}
}
