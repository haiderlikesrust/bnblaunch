import { z } from "zod";
import { isAddress, parseEther, formatEther, formatUnits, encodeFunctionData, zeroAddress, keccak256, toHex, verifyMessage, type Address, type Hex } from "viem";
import { PORTAL, launchCalldata, launchParams, predictedAddress, portalAbi } from "@/lib/flap";
import { chainClient } from "@/lib/providers";
import { agentWallet, launchReadiness, requireLaunchReady, signerRequest } from "@/lib/signer";
import { AppError, body, db, failure, identity, ownedCoin, response } from "@/lib/server";
import { requestOrigin } from "@/lib/auth";
import { initialBuyBnb, parseQuoteBuy, launchError, LaunchPendingError, launchTransactionState } from "@/lib/launch-validation";
import { coinTweetUrl } from "@/lib/coin-tweet";
import { metadataCid } from "@/lib/metadata-cid";

import {quoteTokenInfo,findConversionRoute,erc20QuoteAbi,sameAddress} from '@/shared/quote-pairs.mjs';
const address=z.string().refine(v=>isAddress(v)&&v.toLowerCase()!==zeroAddress,"Invalid address");
const hash=z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const input=z.discriminatedUnion("action",[
  z.object({action:z.literal("authorize"),creator:address,initialBuyBnb,tweetUrl:coinTweetUrl}).strict(),
  z.object({action:z.literal("prepare"),authorizationId:z.string().uuid(),signature:z.string().regex(/^0x[a-fA-F0-9]{130}$/),cid:metadataCid,salt:hash}).strict(),
  z.object({action:z.literal("submitted"),planId:z.string().uuid(),hash}).strict(),
  z.object({action:z.literal("confirm"),planId:z.string().uuid(),hash}).strict(),
]);
type Submitted={id:string;submitted_hash:string;submitted_at:number;predicted_address:string};
const REPLACED="The token is live, but your wallet replaced this transaction (sped up or re-sent). Paste the final transaction hash from your wallet or BscScan to finish verification.";
async function latestSubmission(coinId:string){return db().prepare("SELECT id,submitted_hash,submitted_at,predicted_address FROM prepared_launches WHERE coin_id=? AND submitted_hash IS NOT NULL AND tx_hash IS NULL ORDER BY submitted_at DESC LIMIT 1").bind(coinId).first<Submitted>();}
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  try{const owner=await identity();const {coin}=await ownedCoin((await params).id,owner);const readiness=await launchReadiness(coin);
    const submission=coin.tokenAddress?null:await latestSubmission(coin.id);
    // A reverted or long-dropped submission no longer blocks a fresh launch.
    let state:Awaited<ReturnType<typeof launchTransactionState>>|'unknown'='unknown';
    if(submission)try{state=await launchTransactionState(chainClient(),submission.submitted_hash as Hex,submission.predicted_address as Address)}catch{}
    const pending=submission&&state!=='reverted'&&!(state==='missing'&&Date.now()-submission.submitted_at>900000)?{planId:submission.id,hash:submission.submitted_hash,submittedAt:submission.submitted_at,state}:null;
    return response({chainId:56,portal:PORTAL,method:"newTokenV6",tokenVersion:6,token:coin.symbol,developerBuyEnabled:true,defaultInitialBuyBnb:"0",taxPercent:coin.taxRate,taxDurationDays:365,antiFarmerMinutes:60,allocations:{treasury:coin.treasury,holders:coin.holders,burn:coin.burn,liquidity:coin.liquidity},agentWalletReady:readiness.ready,readiness,treasuryMode:"agent-wallet",launched:!!coin.tokenAddress,pending});
  }catch(e){return failure(e)}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  let stage="authorization";
  try{
    const owner=await identity(request);const {coin,row}=await ownedCoin((await params).id,owner);const parsed=input.safeParse(await body(request));if(!parsed.success)throw new AppError(400,"Invalid launch input: "+parsed.error.issues.map(i=>i.path.join(".")+" — "+i.message).join("; "));const v=parsed.data;
    const client=chainClient();
    // Recorded as soon as the wallet returns a hash, before any confirmation.
    if(v.action==="submitted"){
      if(coin.tokenAddress)return response({ok:true});
      const saved=await db().prepare("UPDATE prepared_launches SET submitted_hash=?,submitted_at=? WHERE id=? AND coin_id=? AND tx_hash IS NULL").bind(v.hash.toLowerCase(),Date.now(),v.planId,coin.id).run();
      if(!saved.meta.changes)throw new AppError(409,"Prepare the launch before recording its transaction.");
      return response({ok:true});
    }
    if(v.action==="confirm"){
      stage="confirmation";
      const hash=v.hash.toLowerCase() as Hex;
      const plan=await db().prepare("SELECT * FROM prepared_launches WHERE coin_id=? AND id=?").bind(coin.id,v.planId).first<{creator:string;treasury:string;calldata:string;predicted_address:string;tx_hash:string|null;initial_buy_wei:string;tweet_url:string;quote_token:string}>();
      if(!plan)throw new AppError(409,"Prepare the launch before confirmation.");
      if(coin.tokenAddress){if(coin.tokenAddress.toLowerCase()===plan.predicted_address.toLowerCase()&&plan.tx_hash===hash)return response({coin,hash});throw new AppError(409,"This coin has a different confirmed launch.");}
      const wallet=await db().prepare("SELECT address FROM agent_wallets WHERE coin_id=?").bind(coin.id).first<{address:string}>();
      if(!wallet||wallet.address!==plan.treasury.toLowerCase())throw new AppError(409,"This launch plan does not use the agent's wallet. Prepare a new launch.");
      if(await client.getChainId()!==56)throw new AppError(503,"RPC does not point to BNB Chain.");
      const state=await launchTransactionState(client,hash,plan.predicted_address as Address);
      if(state==='replaced')return response({error:REPLACED,code:'transaction_replaced'},409);
      if(state==='missing'||state==='pending')throw new LaunchPendingError(202,"Confirming launch on BNB Chain… Waiting for the transaction to be mined.");
      const [tx,receipt,block]=await Promise.all([client.getTransaction({hash}),client.getTransactionReceipt({hash}),client.getBlockNumber()]);
      if(receipt.status!=="success")throw new AppError(409,"Transaction reverted; no launch recorded.");
      if(block-receipt.blockNumber<3n)throw new LaunchPendingError(202,"Confirming launch on BNB Chain… Waiting for 3 confirmations.");
      if(tx.to?.toLowerCase()!==PORTAL.toLowerCase()||tx.from.toLowerCase()!==plan.creator.toLowerCase()||tx.input.toLowerCase()!==plan.calldata.toLowerCase()||tx.value!==(sameAddress(plan.quote_token,zeroAddress)?BigInt(plan.initial_buy_wei):0n))throw new AppError(400,"Transaction does not match the saved launch plan.");
      // The signer independently checks canonical receipt, token implementation,
      // beneficiary and tax routing before binding this wallet permanently.
      const binding=await signerRequest<{address:string;tokenAddress:string;hash:string}>(`/v1/wallets/${coin.id}/launch`,{hash});
      if(binding.address.toLowerCase()!==wallet.address||binding.tokenAddress.toLowerCase()!==plan.predicted_address.toLowerCase()||binding.hash!==hash)throw new AppError(503,"Agent wallet launch verification failed.");
      const quote=await quoteTokenInfo(client,plan.quote_token,false);
      const next={...coin,quoteToken:quote.address,quoteSymbol:quote.symbol,quoteDecimals:quote.decimals,tweetUrl:plan.tweet_url,tokenAddress:plan.predicted_address,treasuryAddress:plan.treasury,state:"dormant"};
      const nextJson=JSON.stringify(next),now=new Date().toISOString();
      const batch=await db().batch([
        db().prepare("UPDATE coins SET config=?,token_address=?,treasury_address=?,updated_at=? WHERE id=? AND owner=? AND config=? AND token_address IS NULL").bind(nextJson,plan.predicted_address.toLowerCase(),plan.treasury.toLowerCase(),now,coin.id,owner,row.config),
        db().prepare("UPDATE prepared_launches SET tx_hash=?,submitted_hash=? WHERE id=? AND EXISTS(SELECT 1 FROM coins WHERE id=? AND owner=? AND config=?)").bind(hash,hash,v.planId,coin.id,owner,nextJson),
        db().prepare("UPDATE influencers SET status='awaiting_x',updated_at=? WHERE coin_id=? AND status='pending_launch' AND EXISTS(SELECT 1 FROM coins WHERE id=? AND owner=? AND config=?)").bind(Date.now(),coin.id,coin.id,owner,nextJson),
        db().prepare("INSERT INTO events(id,coin_id,owner,name,message,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM coins WHERE id=? AND owner=? AND config=?) ON CONFLICT(id) DO NOTHING").bind("launch:"+hash,coin.id,owner,coin.name,"Flap launch confirmed. Fees route to the agent wallet. "+hash,now,coin.id,owner,nextJson),
      ]);
      if(!batch[0].meta.changes){const current=await ownedCoin(coin.id,owner);if(current.coin.tokenAddress?.toLowerCase()!==plan.predicted_address.toLowerCase())throw new AppError(409,"Plan changed during confirmation. Reload and retry.");return response({coin:current.coin,hash});}
      return response({coin:next,hash});
    }
    if(coin.tokenAddress||row.token_address)throw new AppError(409,"Token already launched.");
    await requireLaunchReady(coin);
    if(await client.getChainId()!==56)throw new AppError(503,"RPC does not point to BNB Chain.");
    if(v.action==="authorize"){
      if(v.creator.toLowerCase()!==owner.toLowerCase())throw new AppError(403,"Connect the wallet that owns this launch plan.");
      // Never prepare a second launch while a submitted one may still land.
      const pending=await latestSubmission(coin.id);
      if(pending){
        const state=await launchTransactionState(client,pending.submitted_hash as Hex,pending.predicted_address as Address);
        if(state==='success'||state==='replaced')throw new AppError(409,"Your launch transaction is already on-chain. Reopen this coin to finish verification.");
        if(state==='pending'||(state==='missing'&&Date.now()-pending.submitted_at<900000))throw new AppError(409,"Your previous launch transaction is still pending. Wait for it to confirm or drop from your wallet, then retry.");
      }
      const code=await client.getCode({address:v.creator as Address});
      if(code&&code!=="0x")throw new AppError(400,"Use a standard externally owned wallet for this launch.");
      const treasury=await agentWallet(coin.id),id=crypto.randomUUID(),expiresAt=Date.now()+600000;
      const quote=await quoteTokenInfo(client,coin.quoteToken??zeroAddress);
      if(!sameAddress(quote.address,zeroAddress))await findConversionRoute(client,quote.address,10n**BigInt(quote.decimals));
      const configHash=keccak256(toHex(row.config)),buyWei=parseQuoteBuy(v.initialBuyBnb,quote.decimals);
      const message=["QI launch authorization",`Origin: ${requestOrigin(request)}`,"Chain ID: 56",`Coin: ${coin.id}`,`Creator: ${v.creator.toLowerCase()}`,`Agent wallet: ${treasury.toLowerCase()}`,`Configuration: ${configHash}`,`Pair token: ${quote.symbol} (${quote.address})`,`Developer buy: ${formatUnits(buyWei,quote.decimals)} ${quote.symbol}`,`Coin tweet: ${v.tweetUrl||"None"}`,`Nonce: ${id}`,`Expires: ${new Date(expiresAt).toISOString()}`,"The agent signs its own permitted transactions. After launch, the developer cannot pause or resume it. This message authorizes launch preparation only."].join("\n");
      await db().prepare("INSERT INTO launch_authorizations(id,coin_id,creator,treasury,message,config_hash,expires_at,initial_buy_wei,tweet_url,quote_token,quote_decimals) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(id,coin.id,v.creator.toLowerCase(),treasury.toLowerCase(),message,configHash,expiresAt,buyWei.toString(),v.tweetUrl,quote.address,quote.decimals).run();
      const approvals:Record<string,string>[]=[];
      if(!sameAddress(quote.address,zeroAddress)&&buyWei>0n){
       const allowance=await client.readContract({address:quote.address as Address,abi:erc20QuoteAbi,functionName:'allowance',args:[v.creator as Address,PORTAL]});
       if(allowance<buyWei){if(allowance>0n)approvals.push({from:v.creator,to:quote.address,value:'0x0',chainId:'0x38',data:encodeFunctionData({abi:erc20QuoteAbi,functionName:'approve',args:[PORTAL,0n]})});approvals.push({from:v.creator,to:quote.address,value:'0x0',chainId:'0x38',data:encodeFunctionData({abi:erc20QuoteAbi,functionName:'approve',args:[PORTAL,buyWei]})});}
      }
      return response({authorizationId:id,message,treasury,expiresAt,quote,approvals});
    }
    const auth=await db().prepare("SELECT * FROM launch_authorizations WHERE id=? AND coin_id=?").bind(v.authorizationId,coin.id).first<{creator:string;treasury:string;message:string;config_hash:string;expires_at:number;used_at:number|null;initial_buy_wei:string;tweet_url:string;quote_token:string;quote_decimals:number;metadata_cid:string|null}>();
    if(!auth||auth.expires_at<Date.now()||auth.config_hash!==keccak256(toHex(row.config)))throw new AppError(409,"Launch authorization expired or the plan changed. Prepare again.");
    // Only metadata QI pinned for this authorization may be launched.
    if(!auth.metadata_cid||auth.metadata_cid!==v.cid)throw new AppError(409,"Launch metadata does not match this authorization. Validate the launch again.");
    if(!await verifyMessage({address:auth.creator as Address,message:auth.message,signature:v.signature as Hex}))throw new AppError(403,"Wallet authorization could not be verified.");
    const treasury=await agentWallet(coin.id);
    if(treasury.toLowerCase()!==auth.treasury)throw new AppError(503,"Agent wallet binding changed.");
    // RPCs return lowercase calldata; a mixed-case salt would never match it.
    const salt=v.salt.toLowerCase() as Hex,predicted=predictedAddress(salt);
    if(!predicted.toLowerCase().endsWith("7777"))throw new AppError(400,"Invalid Flap vanity salt.");
    const existingCode=await client.getCode({address:predicted});
    if(existingCode&&existingCode!=="0x")throw new AppError(409,"Predicted token address already exists.");
    stage="contract validation";
    const quote=await quoteTokenInfo(client,auth.quote_token);
    if(quote.decimals!==auth.quote_decimals||!sameAddress(auth.quote_token,coin.quoteToken??zeroAddress))throw new AppError(409,'Pair configuration changed. Prepare again.');
    if(!sameAddress(quote.address,zeroAddress))await findConversionRoute(client,quote.address,10n**BigInt(quote.decimals));
    const buyWei=BigInt(auth.initial_buy_wei),nativeValue=sameAddress(quote.address,zeroAddress)?buyWei:0n;
    const calldata=launchCalldata(coin,v.cid,treasury,salt,buyWei);
    await client.simulateContract({account:auth.creator as Address,address:PORTAL,abi:portalAbi,functionName:"newTokenV6",args:[launchParams(coin,v.cid,treasury,salt,buyWei)],value:nativeValue});
    const gas=await client.estimateGas({account:auth.creator as Address,to:PORTAL,data:calldata,value:nativeValue});
    const gasLimit=gas*120n/100n;
    const [balance,gasPrice]=await Promise.all([client.getBalance({address:auth.creator as Address,blockTag:"pending"}),client.getGasPrice()]);
    if(balance<nativeValue+gasLimit*gasPrice)throw new AppError(422,"Your launch wallet needs enough BNB for the developer buy and network gas. Estimated total: "+formatEther(nativeValue+gasLimit*gasPrice)+" BNB.");
    stage="plan storage";
    await db().batch([
      db().prepare("INSERT INTO prepared_launches(id,coin_id,creator,treasury,calldata,predicted_address,cid,created_at,initial_buy_wei,tweet_url,quote_token) SELECT ?,?,?,?,?,?,?,?,?,?,? FROM launch_authorizations WHERE id=? AND used_at IS NULL ON CONFLICT(id) DO NOTHING").bind(v.authorizationId,coin.id,auth.creator,auth.treasury,calldata,predicted,v.cid,new Date().toISOString(),buyWei.toString(),auth.tweet_url,quote.address,v.authorizationId),
      db().prepare("UPDATE launch_authorizations SET used_at=? WHERE id=? AND used_at IS NULL AND EXISTS(SELECT 1 FROM prepared_launches WHERE id=?)").bind(Date.now(),v.authorizationId,v.authorizationId),
    ]);
    const saved=await db().prepare("SELECT calldata FROM prepared_launches WHERE id=?").bind(v.authorizationId).first<{calldata:string}>();
    if(saved?.calldata!==calldata)throw new AppError(409,"This authorization was already used for a different plan.");
    return response({planId:v.authorizationId,transaction:{from:auth.creator,to:PORTAL,data:calldata,value:toHex(nativeValue),chainId:"0x38",gas:toHex(gasLimit)},initialBuyBnb:formatUnits(buyWei,quote.decimals),quoteSymbol:quote.symbol,quoteToken:quote.address,estimatedGasBnb:formatEther(gasLimit*gasPrice),predictedAddress:predicted,treasury,preflight:"passed",agentWalletReady:true});
  }catch(e){const error=launchError(e,stage);if(stage==="confirmation"&&error instanceof LaunchPendingError)return response({status:"pending",message:error.message},202);return failure(error)}
}
