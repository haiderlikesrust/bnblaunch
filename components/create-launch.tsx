"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Check, Bot, Search, Globe2, ImageIcon, Radio, LoaderCircle, Info, Clapperboard, ShieldCheck, Wallet, ExternalLink } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import TokenImageInput, { type TokenImage } from "./token-image-input";
import QuoteTokenPicker from "./quote-token-picker";
import TokenCard from "./token-card";
import ModelLogo from "./model-logo";
import AgentSetup from "./agent-setup";
import InfluencerSetup from "./influencer-setup";
import { agentModel, DEFAULT_AGENT_MODEL, DEFAULT_AGENT_PURPOSE } from "@/lib/agent-models";
import { blankCoin, type Language } from "@/lib/model";
import { api, type T } from "@/lib/ui";
import { creatorFields, creatorInput, identityStepInput, agentStepInput } from "@/lib/policy";
import { PLATFORM_POLICY } from "@/lib/platform-policy";
import { influencerInput } from "@/lib/influencer-options";
import { coinTweetUrl } from "@/lib/coin-tweet";
import { readyWallet, prepareLaunch, sendLaunch, fundAgentGas, launchStatus, forgetLaunch, type LaunchStage, type LaunchPlan } from "@/lib/launch-flow";
import { confirmLaunch } from "@/lib/launch-confirmation";
import {openXConnection} from "@/lib/x-connection-flow";
import {rememberLaunchPreferences} from "@/lib/launch-preferences";
import { logoPalette } from "@/lib/logo-palette";

const DRAFT="shen-creator-draft",ATTEMPT="shen-launch-attempt";
const STAGES:LaunchStage[]=["wallet","create","authorize","metadata","validate","send","confirm"];
const draftInput=creatorFields.extend({purpose:z.string().max(2000),influencer:influencerInput.nullable().catch(null)}).partial();
const stored=(key:string)=>{try{return sessionStorage.getItem(key)}catch{return null}};
const store=(key:string,value:string|null)=>{try{if(value===null)sessionStorage.removeItem(key);else sessionStorage.setItem(key,value)}catch{}};
async function fingerprint(value:unknown){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value)));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");}

export default function CreateLaunch({lang,t}:{lang:Language;t:T}){
 const router=useRouter();
 const [form,setForm]=useState({...blankCoin,language:"en" as Language}),[step,setStep]=useState(1),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const [tokenImage,setTokenImage]=useState<TokenImage|null>(null),[reference,setReference]=useState<TokenImage|null>(null),[consent,setConsent]=useState(false);
 const [connectingX,setConnectingX]=useState(false);
 const [buy,setBuy]=useState("0"),[tweetUrl,setTweetUrl]=useState("");
 const [stage,setStage]=useState<LaunchStage|null>(null),[note,setNote]=useState(""),[plan,setPlan]=useState<LaunchPlan|null>(null),[sent,setSent]=useState<string|null>(null);
 const controller=useRef<AbortController|null>(null),done=useRef(false);
 useEffect(()=>()=>controller.current?.abort(),[]);
 useEffect(()=>{const saved=stored(DRAFT);if(!saved)return;try{const raw=JSON.parse(saved) as {form?:unknown;buy?:unknown;tweetUrl?:unknown};const value=draftInput.parse(raw.form??raw);setForm(f=>({...f,...value,purpose:value.purpose===DEFAULT_AGENT_PURPOSE?"":value.purpose??"",influencer:value.influencer??null,...PLATFORM_POLICY}));if(typeof raw.buy==="string")setBuy(raw.buy);if(typeof raw.tweetUrl==="string")setTweetUrl(raw.tweetUrl)}catch{}},[]);
 const influencerOn=!!form.influencer,influencerStyle=form.influencer?.style;
 // "Match the logo" samples the token image's colours for the character.
 useEffect(()=>{
  if(!tokenImage||!influencerOn||influencerStyle!=="logo")return;let alive=true;
  logoPalette(`data:${tokenImage.mime};base64,${tokenImage.base64}`).then(palette=>{if(alive)setForm(f=>f.influencer&&JSON.stringify(f.influencer.palette)!==JSON.stringify(palette)?{...f,influencer:{...f.influencer,palette}}:f)}).catch(()=>{});
  return()=>{alive=false};
 },[tokenImage,influencerOn,influencerStyle]);
 const input=()=>({name:form.name,symbol:form.symbol,description:form.description,language:form.language,quoteToken:form.quoteToken??"0x0000000000000000000000000000000000000000",social:form.social,research:form.research,website:form.website,images:form.images,purpose:form.purpose,modelId:form.modelId,personality:form.personality,focus:form.focus,influencer:form.influencer??null});
 const issues=(e:z.ZodError)=>e.issues.map(i=>i.message).join(" ");
 const label=(s:LaunchStage)=>({wallet:t("连接并登录钱包","Connect and sign in"),create:t("创建代币","Create the coin"),authorize:t("签署发行授权","Sign the launch authorization"),metadata:t("上传标志与元数据","Pin logo and metadata"),validate:t("验证发行交易","Validate the transaction"),send:t("在钱包中确认发行","Approve the launch in your wallet"),confirm:t("BNB 链确认","Confirm on BNB Chain")})[s];
 // Stays busy while navigating, so a second click cannot start another coin.
 function finish(coinId:string){done.current=true;store(DRAFT,null);store(ATTEMPT,null);forgetLaunch(coinId);router.push("/token/"+coinId);}
 async function ensureDraft(account:string){
  const value=creatorInput.parse(input());
  if(!tokenImage)throw Error(t("请上传代币图片。","Add a token image."));
  if(value.influencer&&reference&&!consent)throw Error(t("请确认你有权使用此参考图。","Confirm you have the right to use this reference image."));
  const print=await fingerprint({value,image:tokenImage.base64,reference:value.influencer?reference?.base64??null:null});
  const saved=(()=>{try{return JSON.parse(stored(ATTEMPT)??"null") as {coinId:string;print:string;owner:string}|null}catch{return null}})();
  let coinId:string;
  if(saved&&saved.print===print&&saved.owner===account.toLowerCase()){
   // A failed read must not silently create another coin or orphan its X account.
   const existing=await api("/api/coins/"+encodeURIComponent(saved.coinId));
   if(!existing.canManage)throw Error("Sign in with the wallet that saved this coin.");
   if(existing.coin.tokenAddress){finish(saved.coinId);return saved.coinId}
   coinId=saved.coinId;
  }else{
   setStage("create");
   const created=await api("/api/coins",{...value,image:tokenImage});coinId=created.coin.id;
   store(ATTEMPT,JSON.stringify({coinId,print,owner:account.toLowerCase()}));
  }
  // Save references before leaving for OAuth; retry uploads against the same draft.
  if(value.influencer&&reference)await api(`/api/coins/${coinId}/influencer`,{action:"reference",image:reference,consent:true});
  rememberLaunchPreferences(coinId,buy,tweetUrl);
  return coinId;
 }
 async function connectX(){
  if(busy)return;setBusy(true);setConnectingX(true);setError("");
  store(DRAFT,JSON.stringify({form:input(),buy,tweetUrl}));
  try{const account=await readyWallet(),coinId=await ensureDraft(account);if(!done.current)await openXConnection(coinId)}
  catch(e){setError(e instanceof z.ZodError?issues(e):(e as Error).message)}
  finally{setBusy(false);setConnectingX(false);setStage(null)}
 }
 async function launch(){
  setError("");setNote("");setPlan(null);setSent(null);setBusy(true);setStage("wallet");
  controller.current?.abort();const abort=new AbortController();controller.current=abort;
  let coinId:string|null=null,hash:string|null=null;
  try{
   creatorInput.parse(input());const tweet=coinTweetUrl.safeParse(tweetUrl);
   if(!tweet.success)throw Error(tweet.error.issues[0].message);
   if(!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(buy))throw Error(t("请输入有效的开发者购买数量（BNB）。","Enter a valid developer buy in the selected pair token."));
   if(!tokenImage)throw Error(t("请上传代币图片。","Add a token image."));
   const account=await readyWallet();
   coinId=await ensureDraft(account);
   if(done.current)return;
   const status=await launchStatus(coinId);
   if(status.launched)return finish(coinId);
   let planId:string;
   if(status.pending){planId=status.pending.planId;hash=status.pending.hash;}
   else{
    const prepared=await prepareLaunch({coinId,hasSavedImage:true,account,buy,tweetUrl:tweet.data,onStage:setStage});
    setPlan(prepared);setStage("send");
    hash=await sendLaunch(coinId,prepared);planId=prepared.planId;
   }
   setSent(coinId);setStage("confirm");
   const launchedCoin=await confirmLaunch({coinId,planId,hash,signal:abort.signal,onPending:setNote});
   if(launchedCoin.quoteToken&&launchedCoin.quoteToken!=="0x0000000000000000000000000000000000000000"){setNote("Token launched. Approve the separate BNB deposit to fund agent gas.");await fundAgentGas(coinId);}
   finish(coinId);
  }catch(e){
   if(abort.signal.aborted)return;
   const message=(e as {code?:number})?.code===4001?t("你在钱包中取消了此操作。可以随时重新发行。","You cancelled in your wallet. You can launch again any time."):e instanceof z.ZodError?issues(e):(e as Error).message;
   setError(hash&&coinId?message+" "+t("你的交易已保存，可在代币页面完成验证。","Your transaction is saved; finish verification from the coin page."):message);
  }finally{if(!abort.signal.aborted&&!done.current)setBusy(false)}
 }
 async function submit(e:FormEvent){
  e.preventDefault();if(busy||done.current)return;setError("");const value=input();
  if(step===1){const v=identityStepInput.safeParse(value);if(!v.success)return setError(issues(v.error));if(!tokenImage)return setError(t("请上传代币图片。Flap 发行需要标志。","Add a token image. Flap needs a logo to launch."));}
  if(step===2){const v=agentStepInput.safeParse(value);if(!v.success)return setError(issues(v.error));}
  if(step===3){const v=creatorInput.safeParse(value);if(!v.success)return setError(issues(v.error));if(value.influencer&&reference&&!consent)return setError(t("请确认你有权使用此参考图。","Confirm you have the right to use this reference image."));}
  store(DRAFT,JSON.stringify({form:value,buy,tweetUrl}));
  if(step<4){setStep(step+1);return}
  await launch();
 }
 const titles=[[t("一切，从身份开始。","Start with an identity.")],[t("设定智能体的使命。","Define the agent's role.")],[t("给它一张会说话的脸。","Give it a face that posts.")],[t("检查，然后发行。","Review, then launch.")]];
 const current=stage?STAGES.indexOf(stage):-1;
 return <><div className="page-heading"><div><span className="overline accent">CREATE / SHEN</span><h1>{t("为你的代币，注入智能。","A token with a mind of its own.")}</h1><p>{t("填写一次，一步发行。智能体从第一笔费用开始工作。","Fill it in once and launch in one go. The agent takes it from the first fees.")}</p></div></div><div className="launch-layout"><section className="launch-form panel"><div className="creation-steps">{[["身份","Identity"],["智能体","Agent"],["AI 网红","Influencer"],["发行","Launch"]].map(([zh,en],i)=><div className={step===i+1?"current":step>i+1?"complete":""} key={en}><span>{step>i+1?<Check size={14}/>:"0"+(i+1)}</span>{t(zh,en)}</div>)}</div><form onSubmit={submit}><div className="form-section-title"><span className="overline">STEP 0{step} / 04</span><h2>{titles[step-1]}</h2></div>
  {step===1&&<div className="form-grid"><TokenImageInput value={tokenImage} onChange={setTokenImage} t={t}/><label className="form-field">{t("代币名称","Token name")}<input required maxLength={32} placeholder="e.g. Jinchan" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label className="form-field">{t("代币代号","Ticker")}<input required pattern="[A-Z0-9]{2,10}" maxLength={10} placeholder="JINCHAN" value={form.symbol} onChange={e=>setForm({...form,symbol:e.target.value.toUpperCase()})}/></label><label className="form-field span-two">{t("项目介绍","The story")}<textarea required minLength={10} maxLength={600} rows={5} placeholder={t("你的代币代表什么？智能体将为社区做什么？","What does your token stand for? What should its agent do for the community?")} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/><small>{form.description.length} / 600</small></label><div className="form-field span-two"><label id="language-label">{t("智能体语言","Agent language")}</label><Select value={form.language} onValueChange={v=>setForm({...form,language:v as Language})}><SelectTrigger aria-labelledby="language-label" className="w-full h-12"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="zh">中文 · Chinese</SelectItem></SelectContent></Select><small>{t("用于研究总结、社区更新与网站内容。","Used for research, community updates and website content.")}</small></div></div>}
  {step===2&&<><div className="agent-language"><Bot/><span>{t("智能体语言","Agent language")}</span><strong>{form.language==="zh"?"中文":"English"}</strong></div><AgentSetup personality={form.personality??""} focus={form.focus??""} onCharacter={value=>setForm({...form,...value})} purpose={form.purpose??""} modelId={form.modelId??DEFAULT_AGENT_MODEL} onPurpose={purpose=>setForm({...form,purpose})} onModel={modelId=>setForm({...form,modelId})} t={t}/>{[["research",Search,"网络研究","Web research","通过 Brave 获取公开信息。","Research public sources with Brave."],["social",Radio,"社区更新","Community updates","为已连接的 X 账号准备更新。","Prepare updates for a connected X account."],["images",ImageIcon,"图像创作","Image generation","为你的代币创作原创配图。","Create original visuals for your coin."],["website",Globe2,"社区网站","Community website","自动创建、托管并更新社区网站。","Create, host and update a community website."]].map(([key,Icon,zh,en,zd,ed])=>{const I=Icon as typeof Bot,locked=key==="social"&&!!form.influencer;return <div className="capability-row" key={String(key)}><I size={20}/><label htmlFor={String(key)}><strong>{t(String(zh),String(en))}</strong><small>{locked?t("AI 网红在 X 发布，因此保持开启。","Kept on because the AI influencer posts on X."):t(String(zd),String(ed))}</small></label><Switch id={String(key)} disabled={locked} checked={form[key as keyof typeof form] as boolean} onCheckedChange={v=>setForm({...form,[String(key)]:v})}/></div>})}</>}
  {step===3&&<InfluencerSetup value={form.influencer??null} onChange={influencer=>setForm({...form,influencer,...(influencer?{social:true}:{})})} reference={reference} onReference={setReference} consent={consent} onConsent={setConsent} coin={{name:form.name,symbol:form.symbol}} t={t}/>}
  {step===4&&<div className="launch-review">
   <div className="form-grid"><QuoteTokenPicker value={form.quoteToken??"0x0000000000000000000000000000000000000000"} onChange={quoteToken=>setForm(f=>({...f,quoteToken}))} disabled={busy}/><label className="form-field span-two">{t("代币推文链接（可选）","Coin tweet URL (optional)")}<input type="url" value={tweetUrl} placeholder="https://x.com/youraccount/status/…" maxLength={500} disabled={busy} onChange={e=>setTweetUrl(e.target.value)} aria-describedby="coin-tweet-help"/><small id="coin-tweet-help">{t("链接一条 X 公告。它会出现在代币元数据和代币页面中，无需连接 X 账号。","Link an announcement post on X. It appears in your token metadata and on the coin page. No X connection required.")}</small></label><label className="form-field span-two">{t("开发者购买 · BNB（可选）","Developer buy · selected pair token (optional)")}<input type="text" inputMode="decimal" value={buy} disabled={busy} onChange={e=>setBuy(e.target.value.trim())} aria-describedby="developer-buy-help"/><small id="developer-buy-help">{t("保持 0 则不购买。你支付此金额与网络燃料费，购买的代币进入你的钱包。","Leave at 0 to launch without buying. You pay this amount plus network gas; purchased tokens go to your wallet.")}</small></label></div>
   {form.social&&<section className="launch-x-connect"><div className="launch-x-icon">𝕏</div><div><span className="overline">COMMUNITY ACCOUNT</span><h3>{t("发行前连接 X","Connect X before launch")}</h3><p>{t("保存设置并授权项目账号，然后返回完成发行。只有发行后且资金就绪，智能体才会发布。","Save your setup and authorize your project account, then return to finish launching. The agent can post only after launch and funding.")}</p><button type="button" className="button secondary" disabled={busy} onClick={()=>void connectX()}>{connectingX?<LoaderCircle className="spin" size={15}/>:<ExternalLink size={15}/>} {connectingX?t("正在连接…","Connecting…"):t("保存并连接 X","Save & connect X")}</button></div></section>}
   <div className="agent-economics"><span className="overline">AGENT-MANAGED ECONOMY</span><h3>{t("85% 驱动智能体，15% 回购 SHEN。","85% for the agent. 15% for SHEN.")}</h3><p>{t("已确认可分配费用的 15% 由平台自动留作 SHEN 回购与销毁。其余 85% 用于智能体，先支付计算、X、搜索、托管与 AI 网红等服务成本，再由智能体规划社区支出。","The platform reserves 15% of distributable fees for automated SHEN buybacks and burns. The remaining 85% funds the agent: compute, X, research, hosting and the AI influencer come first, then the agent plans community spending.")}</p><div><span>{t("交易税","Trading tax")}</span><strong>{PLATFORM_POLICY.taxRate}% · {t("365 天","365 days")}</strong></div><div><span>{t("AI 网红","AI influencer")}</span><strong>{form.influencer?t("已启用 · 连接 X 后开始","On · starts once X is connected"):t("未启用","Off")}</strong></div></div>
   <div className="subtle-note"><ShieldCheck size={17}/><span>{t("你将在钱包中签署两次：一次发行授权，一次发行交易（支付网络燃料费）。智能体获得自己的钱包，收取费用并自动签署交易。发行后，开发者控制权永久锁定。","Your wallet asks twice: once to authorize the launch and once to send the launch transaction (you pay network gas). The agent gets its own wallet, collects its fees and signs its own transactions. After launch, developer controls are permanently locked.")}</span></div>
   {stage&&!connectingX&&<ol className="launch-progress" aria-live="polite">{STAGES.map((s,i)=>{const state=i<current?"done":i===current?(busy?"active":"failed"):"todo";return <li key={s} className={state}>{state==="done"?<Check size={14}/>:state==="active"?<LoaderCircle className="spin" size={14}/>:<span className="launch-progress-dot"/>}{label(s)}</li>})}</ol>}
   {plan&&<p className="body-copy launch-plan-summary">{t("预计代币地址","Expected token")}: {plan.predictedAddress}<br/>{t("智能体钱包","Agent wallet")}: {plan.treasury}<br/>{t("开发者购买","Developer buy")}: {plan.initialBuyBnb} {plan.quoteSymbol??"BNB"} + {t("约","~")}{Number(plan.estimatedGasBnb).toFixed(5)} BNB {t("燃料费","gas")}</p>}
   {note&&busy&&<p className="body-copy" role="status">{note}</p>}
  </div>}
  {error&&<div className="form-error" role="alert">{error}{sent&&<> <a className="text-link" href={"/token/"+sent}>{t("打开代币页面","Open the coin page")}<ExternalLink size={13}/></a></>}</div>}
  <div className="form-bottom">{step>1?<button type="button" className="button secondary" disabled={busy} onClick={()=>{setError("");setStep(step-1)}}>{t("返回","Back")}</button>:<span className="overline">BNB CHAIN / FLAP</span>}<button type="submit" className="button primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={16}/>:step===4?<Wallet size={16}/>:step===3&&form.influencer?<Clapperboard size={16}/>:null}{step===4?(busy?(connectingX?t("正在连接 X…","Connecting X…"):t("发行中…","Launching…")):t("在 BNB 链发行","Launch on BNB Chain")):t("下一步","Continue")}</button></div>
  {step===4&&!busy&&<p className="subtle-note"><Info size={17}/>{t("连接 X 会保存发行设置。取消后可从“我的智能体”继续完成发行。","Connecting X saves your launch setup. You can resume the saved coin from My agents before sending its launch transaction.")}</p>}
 </form></section><aside className="launch-preview"><div className="preview-label"><span className="overline">{t("实时预览","LIVE PREVIEW")}</span><span>01 / TOKEN CARD</span></div><TokenCard coin={{...form,...PLATFORM_POLICY,imageUrl:tokenImage?`data:${tokenImage.mime};base64,${tokenImage.base64}`:undefined,id:"preview"}} lang={lang} t={t} preview/><div className="preview-summary"><div><span>{t("智能体模型","Agent model")}</span><strong className="model-label"><ModelLogo modelId={form.modelId} size={18}/>{agentModel(form.modelId).name}</strong></div><div><span>{t("网络","Network")}</span><strong>BNB Chain</strong></div><div><span>{t("智能体语言","Agent language")}</span><strong>{form.language==="zh"?"中文":"English"}</strong></div><div><span>{t("AI 网红","AI influencer")}</span><strong>{form.influencer?t("已启用","Enabled"):t("未启用","Off")}</strong></div><div><span>{t("收益分配","Revenue routing")}</span><strong>85% {t("智能体","agent")} / 15% SHEN</strong></div><div><span>{t("支出策略","Spending")}</span><strong>{t("动态 · 成本优先","Adaptive · costs first")}</strong></div></div></aside></div></>}
