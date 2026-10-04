import { z } from "zod";
import { isAddress, parseEther, formatEther, zeroAddress, keccak256, toHex, verifyMessage, type Address, type Hex } from "viem";
import { PORTAL, launchCalldata, launchParams, predictedAddress, portalAbi } from "@/lib/flap";
import { chainClient } from "@/lib/providers";
import { agentWallet, launchReadiness, requireLaunchReady, signerRequest } from "@/lib/signer";
import { AppError, body, db, failure, identity, ownedCoin, response } from "@/lib/server";
import { requestOrigin } from "@/lib/auth";
import { initialBuyBnb, launchError } from "@/lib/launch-validation";
import { coinTweetUrl } from "@/lib/coin-tweet";
import { metadataCid } from "@/lib/metadata-cid";

const address=z.string().refine(v=>isAddress(v)&&v.toLowerCase()!==zeroAddress,"Invalid address");
const input=z.discriminatedUnion("action",[
  z.object({action:z.literal("authorize"),creator:address,initialBuyBnb,tweetUrl:coinTweetUrl}).strict(),
  z.object({action:z.literal("prepare"),authorizationId:z.string().uuid(),signature:z.string().regex(/^0x[a-fA-F0-9]{130}$/),cid:metadataCid,salt:z.string().regex(/^0x[a-fA-F0-9]{64}$/)}).strict(),
  z.object({action:z.literal("confirm"),planId:z.string().uuid(),hash:z.string().regex(/^0x[a-fA-F0-9]{64}$/)}).strict(),
]);
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  try{const owner=await identity();const {coin}=await ownedCoin((await params).id,owner);const readiness=await launchReadiness(coin);
    return response({chainId:56,portal:PORTAL,method:"newTokenV6",tokenVersion:6,token:coin.symbol,developerBuyEnabled:true,defaultInitialBuyBnb:"0",taxPercent:coin.taxRate,taxDurationDays:365,antiFarmerMinutes:60,allocations:{treasury:coin.treasury,holders:coin.holders,burn:coin.burn,liquidity:coin.liquidity},agentWalletReady:readiness.ready,readiness,treasuryMode:"agent-wallet"});
  }catch(e){return failure(e)}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  let stage="authorization";
  try{
    const owner=await identity(request);const {coin,row}=await ownedCoin((await params).id,owner);const parsed=input.safeParse(await body(request));if(!parsed.success)throw new AppError(400,"Invalid launch input: "+parsed.error.issues.map(i=>i.path.join(".")+" — "+i.message).join("; "));const v=parsed.data;
    const client=chainClient();
    if(v.action==="confirm"){
      stage="confirmation";
      const hash=v.hash.toLowerCase() as Hex;
      const plan=await db().prepare("SELECT * FROM prepared_launches WHERE coin_id=? AND id=?").bind(coin.id,v.planId).first<{creator:string;treasury:string;calldata:string;predicted_address:string;tx_hash:string|null;initial_buy_wei:string;tweet_url:string}>();
      if(!plan)throw new AppError(409,"Prepare the launch before confirmation.");
      if(coin.tokenAddress){if(coin.tokenAddress.toLowerCase()===plan.predicted_address.toLowerCase()&&plan.tx_hash===hash)return response({coin,hash});throw new AppError(409,"This coin has a different confirmed launch.");}
      const wallet=await db().prepare("SELECT address FROM agent_wallets WHERE coin_id=?").bind(coin.id).first<{address:string}>();
      if(!wallet||wallet.address!==plan.treasury.toLowerCase())throw new AppError(409,"This launch plan does not use the agent's wallet. Prepare a new launch.");
      if(await client.getChainId()!==56)throw new AppError(503,"RPC does not point to BNB Chain.");
      const [tx,receipt,block]=await Promise.all([client.getTransaction({hash}),client.getTransactionReceipt({hash}),client.getBlockNumber()]);
      if(receipt.status!=="success")throw new AppError(409,"Transaction reverted; no launch recorded.");
      if(block-receipt.blockNumber<3n)throw new AppError(409,"Waiting for 3 confirmations. Check again shortly.");
      if(tx.to?.toLowerCase()!==PORTAL.toLowerCase()||tx.from.toLowerCase()!==plan.creator.toLowerCase()||tx.input!==plan.calldata||tx.value!==BigInt(plan.initial_buy_wei))throw new AppError(400,"Transaction does not match the saved launch plan.");
      // The signer independently checks canonical receipt, token implementation,
      // beneficiary and tax routing before binding this wallet permanently.
      const binding=await signerRequest<{address:string;tokenAddress:string;hash:string}>(`/v1/wallets/${coin.id}/launch`,{hash});
      if(binding.address.toLowerCase()!==wallet.address||binding.tokenAddress.toLowerCase()!==plan.predicted_address.toLowerCase()||binding.hash!==hash)throw new AppError(503,"Agent wallet launch verification failed.");
      const next={...coin,tweetUrl:plan.tweet_url,tokenAddress:plan.predicted_address,treasuryAddress:plan.treasury,state:"dormant"};
      const nextJson=JSON.stringify(next),now=new Date().toISOString();
      const batch=await db().batch([
        db().prepare("UPDATE coins SET config=?,token_address=?,treasury_address=?,updated_at=? WHERE id=? AND owner=? AND config=? AND token_address IS NULL").bind(nextJson,plan.predicted_address.toLowerCase(),plan.treasury.toLowerCase(),now,coin.id,owner,row.config),
        db().prepare("UPDATE prepared_launches SET tx_hash=? WHERE id=? AND EXISTS(SELECT 1 FROM coins WHERE id=? AND owner=? AND config=?)").bind(hash,v.planId,coin.id,owner,nextJson),
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
      const code=await client.getCode({address:v.creator as Address});
      if(code&&code!=="0x")throw new AppError(400,"Use a standard externally owned wallet for this launch.");
      const treasury=await agentWallet(coin.id),id=crypto.randomUUID(),expiresAt=Date.now()+600000;
      const configHash=keccak256(toHex(row.config)),buyWei=parseEther(v.initialBuyBnb);
      const message=["SHEN launch authorization",`Origin: ${requestOrigin(request)}`,"Chain ID: 56",`Coin: ${coin.id}`,`Creator: ${v.creator.toLowerCase()}`,`Agent wallet: ${treasury.toLowerCase()}`,`Configuration: ${configHash}`,`Developer buy: ${formatEther(buyWei)} BNB`,`Coin tweet: ${v.tweetUrl||"None"}`,`Nonce: ${id}`,`Expires: ${new Date(expiresAt).toISOString()}`,"The agent signs its own permitted transactions. After launch, the developer cannot pause or resume it. This message authorizes launch preparation only."].join("\n");
      await db().prepare("INSERT INTO launch_authorizations(id,coin_id,creator,treasury,message,config_hash,expires_at,initial_buy_wei,tweet_url) VALUES(?,?,?,?,?,?,?,?,?)").bind(id,coin.id,v.creator.toLowerCase(),treasury.toLowerCase(),message,configHash,expiresAt,buyWei.toString(),v.tweetUrl).run();
      return response({authorizationId:id,message,treasury,expiresAt});
    }
    const auth=await db().prepare("SELECT * FROM launch_authorizations WHERE id=? AND coin_id=?").bind(v.authorizationId,coin.id).first<{creator:string;treasury:string;message:string;config_hash:string;expires_at:number;used_at:number|null;initial_buy_wei:string;tweet_url:string}>();
    if(!auth||auth.expires_at<Date.now()||auth.config_hash!==keccak256(toHex(row.config)))throw new AppError(409,"Launch authorization expired or the plan changed. Prepare again.");
    if(!await verifyMessage({address:auth.creator as Address,message:auth.message,signature:v.signature as Hex}))throw new AppError(403,"Wallet authorization could not be verified.");
    const treasury=await agentWallet(coin.id);
    if(treasury.toLowerCase()!==auth.treasury)throw new AppError(503,"Agent wallet binding changed.");
    const predicted=predictedAddress(v.salt as Hex);
    if(!predicted.toLowerCase().endsWith("7777"))throw new AppError(400,"Invalid Flap vanity salt.");
    const existingCode=await client.getCode({address:predicted});
    if(existingCode&&existingCode!=="0x")throw new AppError(409,"Predicted token address already exists.");
    stage="contract validation";
    const buyWei=BigInt(auth.initial_buy_wei);
    const calldata=launchCalldata(coin,v.cid,treasury,v.salt as Hex,buyWei);
    await client.simulateContract({account:auth.creator as Address,address:PORTAL,abi:portalAbi,functionName:"newTokenV6",args:[launchParams(coin,v.cid,treasury,v.salt as Hex,buyWei)],value:buyWei});
    const gas=await client.estimateGas({account:auth.creator as Address,to:PORTAL,data:calldata,value:buyWei});
    const gasLimit=gas*120n/100n;
    const [balance,gasPrice]=await Promise.all([client.getBalance({address:auth.creator as Address,blockTag:"pending"}),client.getGasPrice()]);
    if(balance<buyWei+gasLimit*gasPrice)throw new AppError(422,"Your launch wallet needs enough BNB for the developer buy and network gas. Estimated total: "+formatEther(buyWei+gasLimit*gasPrice)+" BNB.");
    stage="plan storage";
    await db().batch([
      db().prepare("INSERT INTO prepared_launches(id,coin_id,creator,treasury,calldata,predicted_address,cid,created_at,initial_buy_wei,tweet_url) SELECT ?,?,?,?,?,?,?,?,?,? FROM launch_authorizations WHERE id=? AND used_at IS NULL ON CONFLICT(id) DO NOTHING").bind(v.authorizationId,coin.id,auth.creator,auth.treasury,calldata,predicted,v.cid,new Date().toISOString(),buyWei.toString(),auth.tweet_url,v.authorizationId),
      db().prepare("UPDATE launch_authorizations SET used_at=? WHERE id=? AND used_at IS NULL AND EXISTS(SELECT 1 FROM prepared_launches WHERE id=?)").bind(Date.now(),v.authorizationId,v.authorizationId),
    ]);
    const saved=await db().prepare("SELECT calldata FROM prepared_launches WHERE id=?").bind(v.authorizationId).first<{calldata:string}>();
    if(saved?.calldata!==calldata)throw new AppError(409,"This authorization was already used for a different plan.");
    return response({planId:v.authorizationId,transaction:{from:auth.creator,to:PORTAL,data:calldata,value:toHex(buyWei),chainId:"0x38",gas:toHex(gasLimit)},initialBuyBnb:formatEther(buyWei),estimatedGasBnb:formatEther(gasLimit*gasPrice),predictedAddress:predicted,treasury,preflight:"passed",agentWalletReady:true});
  }catch(e){return failure(launchError(e,stage))}
}
