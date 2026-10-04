"use client";
import { useState, useEffect, useRef } from "react";
import { LoaderCircle, ShieldCheck, ExternalLink, Wallet, RotateCcw } from "lucide-react";
import { confirmLaunch, LaunchConfirmationError } from "@/lib/launch-confirmation";
import { readyWallet, prepareLaunch, sendLaunch, launchStatus, recordSubmission, rememberLaunch, rememberedLaunch, forgetLaunch } from "@/lib/launch-flow";
import type { Coin } from "@/lib/model";
import type { T } from "@/lib/ui";

type Pending={planId:string;hash:string};
// Resumes a launch started from the create form, on any device.
export default function FlapLaunch({coin,onConfirmed,t}:{coin:Coin;onConfirmed:(c:Coin)=>void;t:T}){
  // t is recreated each render; effects read it through a ref so polling never restarts.
  const confirmedRef=useRef(onConfirmed),tRef=useRef(t);
  useEffect(()=>{confirmedRef.current=onConfirmed;tRef.current=t});
  const [pending,setPending]=useState<Pending|null>(null),[phase,setPhase]=useState<"loading"|"form"|"confirming"|"failed"|"replaced"|"done">("loading"),[retry,setRetry]=useState(0);
  const [buy,setBuy]=useState("0"),[tweetUrl,setTweetUrl]=useState(coin.tweetUrl??""),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[replacement,setReplacement]=useState("");
  const [readiness,setReadiness]=useState<{ready:boolean;reason:string}>({ready:false,reason:t("正在检查发行钱包…","Checking the launch wallet…")});
  useEffect(()=>{
    let alive=true;
    async function check(){try{const status=await launchStatus(coin.id);if(!alive)return;setReadiness(status.readiness);
      const saved=status.pending??rememberedLaunch(coin.id);
      setPending(current=>current??saved);setPhase(current=>current==="loading"?(saved?"confirming":"form"):current);
    }catch(e){if(alive){setReadiness({ready:false,reason:(e as Error).message});setPhase(current=>current==="loading"?(rememberedLaunch(coin.id)?"confirming":"form"):current);setPending(current=>current??rememberedLaunch(coin.id))}}}
    void check();const timer=setInterval(check,30000);return()=>{alive=false;clearInterval(timer)};
  },[coin.id]);
  useEffect(()=>{
    if(phase!=="confirming"||!pending)return;
    const t=tRef.current,controller=new AbortController();setMessage(t("正在 BNB 链上确认发行…","Confirming launch on BNB Chain…"));
    void confirmLaunch({coinId:coin.id,planId:pending.planId,hash:pending.hash,signal:controller.signal,onPending:setMessage}).then(launched=>{
      if(controller.signal.aborted)return;forgetLaunch(coin.id);setPhase("done");
      setMessage(t("代币已发行。资金与服务就绪后，智能体开始工作。","Token launched. The agent starts working when its treasury and operating services are ready."));confirmedRef.current(launched);
    }).catch(error=>{
      if(controller.signal.aborted)return;
      if(error instanceof LaunchConfirmationError&&error.code==="transaction_replaced"){setPhase("replaced");setMessage(error.message);return;}
      // A final answer (reverted or mismatched) frees the coin for a fresh launch.
      if(error instanceof LaunchConfirmationError&&error.final){forgetLaunch(coin.id);setPending(null);setPhase("form");setMessage(error.message);return;}
      setPhase("failed");setMessage(error instanceof Error?error.message:t("无法验证发行，请重试。","Could not verify the launch. Retry verification."));
    });
    return()=>controller.abort();
  },[coin.id,pending,phase,retry]);
  async function launch(){
    setBusy(true);setMessage("");
    try{
      const account=await readyWallet();
      const plan=await prepareLaunch({coinId:coin.id,hasSavedImage:!!coin.imageUrl,file,account,buy,tweetUrl,onStage:stage=>setMessage(({wallet:"",create:"",authorize:t("正在准备智能体专属钱包…","Preparing the agent's dedicated wallet…"),metadata:t("正在通过 Flap 上传标志与元数据…","Pinning your logo and metadata through Flap…"),validate:t("正在计算代币地址并验证交易…","Finding the token address and validating the transaction…"),send:"",confirm:""})[stage])});
      setMessage(t("请在钱包中确认 BNB 主网发行交易。","Approve the BNB mainnet launch transaction in your wallet."));
      const hash=await sendLaunch(coin.id,plan);
      setPending({planId:plan.planId,hash});setPhase("confirming");
    }catch(e){setMessage((e as {code?:number})?.code===4001?t("你在钱包中取消了此操作。","You cancelled in your wallet."):(e as Error).message)}finally{setBusy(false)}
  }
  async function applyReplacement(){
    if(!pending||!/^0x[a-fA-F0-9]{64}$/.test(replacement.trim()))return setMessage(t("请输入有效的交易哈希。","Enter a valid transaction hash."));
    const next={planId:pending.planId,hash:replacement.trim().toLowerCase()};
    await recordSubmission(coin.id,next.planId,next.hash);rememberLaunch(coin.id,next.planId,next.hash);
    setReplacement("");setPending(next);setPhase("confirming");
  }
  return <section className="panel" style={{marginTop:24}}><div className="panel-heading"><h2>{t("完成发行","Finish launch")}</h2><span className="status dormant">BNB MAINNET</span></div>
    <div className="subtle-note"><Wallet size={18}/><span>{t("智能体获得自己的钱包，收取费用并自动签署交易。发行后，开发者控制权永久锁定。","The agent receives its own wallet, collects its fees and signs its transactions automatically. After launch, developer controls are permanently locked.")}</span></div>
    {phase==="form"&&<>
      {!readiness.ready&&<p className="body-copy" role="status">{readiness.reason}</p>}
      <div className="form-grid" style={{marginTop:22}}>{coin.imageUrl?<div className="saved-token-image span-two"><img src={coin.imageUrl} alt={coin.name+" token logo"}/><div><strong>{t("代币图片已就绪","Token artwork ready")}</strong><p>{t("发行将使用你上传的图片。","Your uploaded image will be used for the launch.")}</p></div></div>:<label className="form-field span-two">{t("代币标志 · PNG、JPEG、WebP · 小于 2 MB","Token logo · PNG, JPEG, WebP · under 2 MB")}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>setFile(e.target.files?.[0]??null)}/></label>}</div>
      <label className="form-field" style={{marginTop:22}}>{t("代币推文链接（可选）","Coin tweet URL (optional)")}<input type="url" value={tweetUrl} placeholder="https://x.com/youraccount/status/…" maxLength={500} disabled={busy} onChange={e=>setTweetUrl(e.target.value)}/></label>
      <label className="form-field" style={{marginTop:22}}>{t("开发者购买 · BNB（可选）","Developer buy · BNB (optional)")}<input type="text" inputMode="decimal" value={buy} disabled={busy} onChange={e=>setBuy(e.target.value.trim())}/><small>{t("保持 0 则不购买。你支付此金额与网络燃料费。","Leave at 0 to launch without buying. You pay this amount plus network gas.")}</small></label>
      <div className="subtle-note"><ShieldCheck size={17}/><span>{t(`买卖税：${coin.taxRate}%，持续 365 天。可分配费用中 85% 用于智能体，15% 用于 SHEN 回购与销毁。`,`Buy/sell tax: ${coin.taxRate}% for 365 days. Of distributable fees, 85% funds the agent and 15% funds system SHEN buybacks and burns.`)}</span></div>
      <button className="button primary" style={{marginTop:20}} disabled={busy||!readiness.ready} onClick={()=>void launch()}>{busy?<LoaderCircle className="spin" size={16}/>:<Wallet size={16}/>}{t("在 BNB 链发行","Launch on BNB Chain")}</button>
    </>}
    {pending&&phase!=="form"&&<a href={`https://bscscan.com/tx/${pending.hash}`} target="_blank" rel="noreferrer" className="button secondary" style={{marginTop:18}}>{t("查看交易","View transaction")} <ExternalLink size={14}/></a>}
    {phase==="confirming"&&<span className="button secondary" role="status" style={{margin:12}}><LoaderCircle className="spin" size={16}/>{t("确认中…","Confirming launch…")}</span>}
    {phase==="failed"&&<button className="button primary" style={{margin:12}} onClick={()=>{setPhase("confirming");setRetry(v=>v+1)}}><RotateCcw size={15}/>{t("重试验证","Retry verification")}</button>}
    {phase==="replaced"&&<div className="form-field" style={{marginTop:18}}><label htmlFor="replacement-hash">{t("最终交易哈希","Final transaction hash")}</label><input id="replacement-hash" value={replacement} placeholder="0x…" onChange={e=>setReplacement(e.target.value)}/><button className="button primary" style={{marginTop:12}} onClick={()=>void applyReplacement()}>{t("使用此哈希验证","Verify with this hash")}</button></div>}
    <p className="body-copy" role="status">{message}</p>
  </section>;
}
