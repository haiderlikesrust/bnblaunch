"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search, Bot, Layers, Network, CircleDollarSign } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "sonner";
import ShenHeader from "./shen-header";
import ShenFooter from "./shen-footer";
import TokenCard from "./token-card";
import CreateLaunch from "./create-launch";
import ShenDocs from "./shen-docs";
import TokenView from "./token-view";
import XConnectionNotice from "./x-connection-notice";
import type { Coin, Language } from "@/lib/model";
import { api } from "@/lib/ui";

export default function ShenApp({page="discover",coinId}:{page?:string;coinId?:string}){
 const [lang,setLang]=useState<Language>("en"),[query,setQuery]=useState(""),[filter,setFilter]=useState("all"),[coins,setCoins]=useState<Coin[]>([]),[coin,setCoin]=useState<Coin>(),[canManage,setCanManage]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const [authVersion,setAuthVersion]=useState(0);
 useEffect(()=>{const changed=()=>setAuthVersion(v=>v+1);window.addEventListener("shen-auth-changed",changed);return()=>window.removeEventListener("shen-auth-changed",changed)},[]);
 const t=(zh:string,en:string)=>lang==="zh"?zh:en;
 useEffect(()=>{const saved=localStorage.getItem("shen-language");if(saved==="zh"||saved==="en")setLang(saved)},[]);
 useEffect(()=>{document.documentElement.lang=lang==="zh"?"zh-CN":"en"},[lang]);
 function language(v:Language){setLang(v);localStorage.setItem("shen-language",v)}
 useEffect(()=>{if(page==="launch"||page==="docs"){setLoading(false);return}let active=true;setLoading(true);setError("");setCoin(undefined);setCanManage(false);setCoins([]);const url=page==="token"?"/api/coins/"+encodeURIComponent(coinId??""):page==="discover"?"/api/directory":"/api/coins";api(url).then(data=>{if(!active)return;if(page==="token"){setCoin(data.coin);setCanManage(!!data.canManage)}else{setCoins(data.coins)}}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[page,coinId,authVersion]);
 useEffect(()=>{const ctx=(document as Document&{modelContext?:{registerTool:(tool:unknown,options:{signal:AbortSignal})=>void}}).modelContext;if(!ctx||!["discover","agents"].includes(page))return;const lifecycle=new AbortController();try{ctx.registerTool({name:"filter_agent_directory",description:"Filter the visible directory by name and status. Does not create, launch or control agents.",inputSchema:{type:"object",properties:{query:{type:"string"},status:{type:"string",enum:["all","active","dormant"]}},required:["query","status"],additionalProperties:false},annotations:{readOnlyHint:false},execute(input:unknown){const v=input as {query?:unknown;status?:unknown};if(typeof v?.query!=="string"||v.query.length>100||!(["all","active","dormant"] as unknown[]).includes(v.status))throw Error("Invalid filter");setQuery(v.query);setFilter(v.status as string);return {query:v.query,status:v.status}}},{signal:lifecycle.signal})}catch{}return()=>lifecycle.abort()},[page]);
 const filtered=coins.filter(c=>(filter==="all"||c.state===filter)&&(c.name+c.symbol+c.description).toLowerCase().includes(query.toLowerCase()));
 const signIn=error.toLowerCase().includes("sign in");
 return <div className="site-shell"><Toaster theme="dark"/><ShenHeader page={page} lang={lang} setLang={language} t={t}/><main className="site-main">
  <XConnectionNotice page={page} coinId={coinId} t={t}/>
  {["discover","agents"].includes(page)&&<><div className="directory-heading"><div><div className="eyebrow"><span className="accent">神</span><span>THE AGENT LAUNCHPAD</span></div><h1>{page==="agents"?t("你的智能体，自主成长。","Your agents. Independent minds."):<>{t("代币，有了","Tokens with ")}<span>{t("自主灵魂。","a mind of their own.")}</span></>}</h1><p>{t("在 BNB 发行代币，用收益驱动研究、创作与社区。","Launch on BNB. Turn token revenue into research, creation, and community.")}</p></div></div>
  <div className="metric-strip">{[[Layers,page==="agents"?t("你的代币","YOUR TOKENS"):t("已发行代币","LAUNCHED TOKENS"),String(coins.length).padStart(2,"0")],[Bot,t("资金已达标的智能体","FUNDED AGENTS"),String(coins.filter(c=>c.state==="active").length).padStart(2,"0")],[CircleDollarSign,t("金库总额","TREASURY BALANCES"),coins.reduce((a,c)=>a+c.balance,0).toFixed(3)],[Network,t("发行网络","LAUNCH NETWORK"),"BNB"]].map(([Icon,label,value],i)=>{const I=Icon as typeof Bot;return <div className="metric" key={String(label)}><span className="overline"><I size={13}/>{String(label)}</span><strong>{loading?"—":String(value)}{i===2&&<small>BNB</small>}</strong><span className="metric-foot">{i===3?"POWERED BY FLAP":i===2?t("最近确认的余额","LAST CONFIRMED BALANCES"):t("已记录","RECORDED")}</span></div>})}</div>
  <div className="directory-toolbar"><div className="directory-title"><h2>{page==="agents"?t("我的智能体","My agents"):t("探索智能体","Agent directory")}</h2><span>{coins.length.toString().padStart(2,"0")}</span></div><label className="search-field"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={t("搜索名称或代号","Search name or ticker")} aria-label="Search agents"/></label></div>
  <div className="directory-subbar"><Tabs value={filter} onValueChange={setFilter}><TabsList><TabsTrigger value="all">{t("全部智能体","All agents")}</TabsTrigger><TabsTrigger value="active">{t("资金已达标","Funded")}</TabsTrigger><TabsTrigger value="dormant">{t("待筹资","Awaiting funding")}</TabsTrigger></TabsList></Tabs></div>
  <div className="directory-layout"><div><div className="agent-grid">{filtered.map((c,i)=><TokenCard key={c.id} coin={c} index={i} lang={lang} t={t}/>)}</div>{!filtered.length&&<div className="panel empty-state"><Bot size={32}/><h3>{loading?t("正在加载…","Loading agents…"):error?t("暂时无法加载","Unable to load agents"):coins.length?t("未找到匹配的智能体","No matching agents"):t("从第一个智能体开始。","The first mind starts here.")}</h3><p>{error||(coins.length?t("尝试其他名称或状态。","Try another name or status."):t("尚无已发行的代币。创建你的代币与智能体。","No tokens have launched yet. Create a token and give its agent a purpose."))}</p>{signIn?<a href="/signin?return_to=/agents" target="_top" className="button secondary">{t("登录","Sign in")}</a>:!loading&&!coins.length&&!error&&<Link href="/launch" className="button primary"><Plus size={15}/>{t("创建代币","Create a token")}</Link>}</div>}</div><aside className="directory-aside"><div className="protocol-panel"><span className="overline">THE SHEN CYCLE</span><h3>{t("收益，变为行动。","Revenue becomes action.")}</h3>{[["01","发行","Launch","在 Flap 发行代币。","Create a token on Flap."],["02","积蓄","Accumulate","费用进入智能体金库。","Fees fund its treasury."],["03","启动","Activate","资金与服务就绪后开始。","Begin when funds and services are ready."]].map(([n,zh,en,zd,ed])=><div className="protocol-step" key={n}><span>{n}</span><div><strong>{t(zh,en)}</strong><p>{t(zd,ed)}</p></div></div>)}</div></aside></div></>}
  {page==="launch"&&<CreateLaunch lang={lang} t={t}/>}{page==="docs"&&<ShenDocs t={t}/>}
  {page==="token"&&(!loading&&!error&&coin?<TokenView key={coin.id+":"+authVersion} coin={coin} lang={lang} t={t} canManage={canManage}/>:<div className="empty-state"><Bot/><h1>{loading?t("正在加载…","Loading agent…"):t("智能体不可用","Agent unavailable")}</h1><p>{error}</p><Link className="button secondary" href="/">{t("探索智能体","Discover agents")}</Link>{signIn&&<a href={"/signin?return_to="+encodeURIComponent("/token/"+coinId)} target="_top">{t("登录","Sign in")}</a>}</div>)}
 </main><ShenFooter t={t}/></div>
}
