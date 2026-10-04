"use client";
import { useState, useEffect, useRef } from "react";
import { confirmLaunch } from "@/lib/launch-confirmation";
import { coinTweetUrl } from "@/lib/coin-tweet";
import { findSalt } from "@/lib/flap";
import { stringToHex, formatEther } from "viem";
import { verifyLaunchWallet } from "@/lib/launch-wallet";
import { LoaderCircle, ShieldCheck, Upload, ExternalLink, Wallet } from "lucide-react";
import type { Coin } from "@/lib/model";
type Plan={planId:string;transaction:Record<string,string>;predictedAddress:string;treasury:string};
type LaunchResponse=Plan&{coin:Coin;error?:string;authorizationId:string;message:string;readiness:{ready:boolean;reason:string}};
export default function FlapLaunch({coin,onConfirmed}:{coin:Coin;onConfirmed:(c:Coin)=>void}){
  const confirmedRef=useRef(onConfirmed);
  useEffect(()=>{confirmedRef.current=onConfirmed},[onConfirmed]);
  const [confirmation,setConfirmation]=useState<"idle"|"checking"|"failed"|"done">("idle"),[retry,setRetry]=useState(0);
  const [buy,setBuy]=useState("0");
  const [tweetUrl,setTweetUrl]=useState(coin.tweetUrl??"");
  const [file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[plan,setPlan]=useState<Plan|null>(null),[hash,setHash]=useState("");
  const [readiness,setReadiness]=useState<{ready:boolean;reason:string}>({ready:false,reason:"Checking launch wallet…"});
  useEffect(()=>{
    const saved=sessionStorage.getItem("shen-launch:"+coin.id);if(saved){try{const v=JSON.parse(saved);if(v.plan?.planId&&/^0x[a-fA-F0-9]{64}$/.test(v.hash)){setPlan(v.plan);setHash(v.hash)}}catch{}}
    let alive=true;
    async function check(){try{const r=await fetch(`/api/coins/${coin.id}/launch`);const d=await r.json() as LaunchResponse;if(alive)setReadiness(r.ok?d.readiness:{ready:false,reason:d.error??"The launch wallet service is unavailable."})}catch{if(alive)setReadiness({ready:false,reason:"Could not check the launch wallet. Retrying shortly."})}}
    void check();window.addEventListener("shen-x-connected",check);const timer=setInterval(check,30000);return()=>{alive=false;clearInterval(timer);window.removeEventListener("shen-x-connected",check)};
  },[coin.id]);
  useEffect(()=>{
    if(!hash||!plan?.planId)return;
    const controller=new AbortController();
    setConfirmation("checking");setMessage("Confirming launch on BNB Chain…");
    void confirmLaunch({coinId:coin.id,planId:plan.planId,hash,signal:controller.signal,onPending:setMessage}).then(launched=>{
      if(controller.signal.aborted)return;
      try{sessionStorage.removeItem("shen-launch:"+coin.id)}catch{}
      setConfirmation("done");setMessage("Token launched. The agent starts working when its treasury and operating services are ready.");
      confirmedRef.current(launched);
    }).catch(error=>{if(!controller.signal.aborted){setConfirmation("failed");setMessage(error instanceof Error?error.message:"Could not verify the launch. Retry verification.")}});
    return()=>controller.abort();
  },[coin.id,hash,plan?.planId,retry]);
  async function post(body:unknown){const r=await fetch(`/api/coins/${coin.id}/launch`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json() as LaunchResponse;if(!r.ok)throw new Error(d.error);return d}
  async function prepare(){
    setBusy(true);setMessage("");setPlan(null);
    try{
      if(!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(buy))throw new Error("Enter a non-negative developer buy in BNB, with at most 18 decimals.");
      const tweet=coinTweetUrl.safeParse(tweetUrl);if(!tweet.success)throw new Error(tweet.error.issues[0].message);
      if(!window.ethereum)throw new Error("Open in a browser with a BNB-compatible wallet.");
      if(!file&&!coin.imageUrl)throw new Error("Choose a token logo first.");
      const accounts=await window.ethereum.request({method:"eth_requestAccounts"}) as string[];
      if(!accounts[0])throw new Error("Connect your launch wallet.");
      await verifyLaunchWallet(accounts[0]);
      const chain=await window.ethereum.request({method:"eth_chainId"});if(chain!=="0x38")throw new Error("Switch your wallet to BNB Chain (56) and retry.");
      setMessage("Preparing the agent’s dedicated wallet…");
      const auth=await post({action:"authorize",creator:accounts[0],initialBuyBnb:buy,tweetUrl:tweet.data}) as {authorizationId:string;message:string};
      const signature=await window.ethereum.request({method:"personal_sign",params:[stringToHex(auth.message),accounts[0]]});
      setMessage("Pinning your logo and metadata through Flap…");
      const f=new FormData();f.append("authorizationId",auth.authorizationId);if(file)f.append("image",file);
      const r=await fetch(`/api/coins/${coin.id}/metadata`,coin.imageUrl?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({useSavedImage:true,authorizationId:auth.authorizationId})}:{method:"POST",body:f});const d=await r.json() as {cid:string;error:string};if(!r.ok)throw new Error(d.error);
      setMessage("Finding the token address and validating the transaction…");
      const salt=await findSalt();
      const ready=await post({action:"prepare",authorizationId:auth.authorizationId,signature,cid:d.cid,salt:salt.salt});
      setPlan(ready);setMessage("Validation passed. Review the BNB mainnet transaction below.");
    }catch(e){setMessage((e as Error).message)}finally{setBusy(false)}
  }
  async function sign(){
    if(!plan||!window.ethereum)return;setBusy(true);
    try{
      const status=await fetch(`/api/coins/${coin.id}/launch`);const current=await status.json() as LaunchResponse;if(!status.ok||!current.readiness?.ready)throw new Error(current.readiness?.reason??"The launch wallet service is unavailable.");
      const accounts=await window.ethereum.request({method:"eth_accounts"}) as string[],chain=await window.ethereum.request({method:"eth_chainId"});
      if(chain!=="0x38"||accounts[0]?.toLowerCase()!==plan.transaction.from.toLowerCase())throw new Error("Wallet account or network changed. Prepare again.");
      const transactionHash=await window.ethereum.request({method:"eth_sendTransaction",params:[plan.transaction]}) as string;
      try{sessionStorage.setItem("shen-launch:"+coin.id,JSON.stringify({plan,hash:transactionHash}))}catch{}
      setHash(transactionHash);setMessage("Confirming launch on BNB Chain…");
    }catch(e){setMessage((e as Error).message)}finally{setBusy(false)}
  }
  return <section className="panel" style={{marginTop:24}}><div className="panel-heading"><h2>Launch on Flap</h2><span className="status dormant">BNB MAINNET</span></div>
    <div className="subtle-note"><Wallet size={18}/><span>The agent receives its own wallet, collects its fees and signs its transactions automatically. After launch, developer controls are permanently locked.</span></div>
    <div className="subtle-note launch-coin-link"><span>Coin link & launch website: <a className="text-link" href={"/token/"+coin.id}>{"shen.now/token/"+coin.id}</a></span></div>
    <p className="body-copy">You can launch before connecting X. AI, research and image services do not delay token creation; the agent uses them when they are available and funded.</p>
    {!readiness.ready&&<p className="body-copy" role="status">{readiness.reason}</p>}
    <div className="form-grid" style={{marginTop:22}}>{coin.imageUrl?<div className="saved-token-image span-two"><img src={coin.imageUrl} alt={coin.name+" token logo"}/><div><strong>Token artwork ready</strong><p>Your uploaded image will be used for the launch.</p></div></div>:<label className="form-field span-two">Token logo · PNG, JPEG, WebP · under 2 MB<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!!hash||busy} onChange={e=>{setFile(e.target.files?.[0]??null);setPlan(null)}}/></label>}</div>
    <label className="form-field" style={{marginTop:22}}>Coin tweet URL (optional)<input type="url" value={tweetUrl} placeholder="https://x.com/youraccount/status/…" maxLength={500} disabled={busy||!!hash} onChange={e=>{setTweetUrl(e.target.value);setPlan(null);setMessage("")}} aria-describedby="coin-tweet-help"/><small id="coin-tweet-help">Link an announcement post on X. It appears in your token metadata and on this coin’s page. No X account connection required.</small></label>
    <label className="form-field" style={{marginTop:22}}>Developer buy · BNB (optional)<input type="text" inputMode="decimal" value={buy} disabled={busy||!!hash} onChange={e=>{setBuy(e.target.value);setPlan(null);setMessage("")}} aria-describedby="developer-buy-help"/><small id="developer-buy-help">Leave at 0 to launch without buying. You pay this amount plus network gas; purchased tokens go to your connected wallet.</small></label>
    <div className="subtle-note"><ShieldCheck size={17}/><span>You sign the token launch and pay its network gas. The optional developer buy goes to your launch wallet. Buy/sell tax: {coin.taxRate}% for 365 days. Of distributable fees, 85% funds the agent and 15% funds system SHEN buybacks and burns.</span></div>
    {!hash&&<button className="button secondary" style={{marginTop:20}} disabled={busy||!readiness.ready} onClick={prepare}>{busy?<LoaderCircle className="spin" size={16}/>:<Upload size={16}/>}Validate launch</button>}
    {plan&&!hash&&<><p className="body-copy" style={{overflowWrap:"anywhere"}}>Expected token: {plan.predictedAddress}<br/>Agent wallet: {plan.treasury}<br/>Developer buy: {formatEther(BigInt(plan.transaction.value))} BNB + network gas<br/>Buyer: {plan.transaction.from}</p><button className="button primary" style={{marginTop:16}} disabled={busy||!readiness.ready} onClick={sign}>Review mainnet launch in wallet</button></>}
    {hash&&<><a href={`https://bscscan.com/tx/${hash}`} target="_blank" rel="noreferrer" className="button secondary" style={{marginTop:18}}>View transaction <ExternalLink size={14}/></a>{confirmation==="checking"&&<span className="button secondary" role="status" style={{margin:12}}><LoaderCircle className="spin" size={16}/>Confirming launch…</span>}{confirmation==="failed"&&<button className="button primary" style={{margin:12}} onClick={()=>setRetry(value=>value+1)}>Retry verification</button>}</>}
    <p className="body-copy" role="status">{message}</p>
  </section>;
}
