"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot } from "lucide-react";
import QiHome from "./qi-home";
import { Toaster } from "sonner";
import ShenHeader from "./shen-header";
import ShenFooter from "./shen-footer";
import type { ApiResponse } from "@/lib/ui";
import CreateLaunch from "./create-launch";
import ShenDocs from "./shen-docs";
import TokenView from "./token-view";
import XConnectionNotice from "./x-connection-notice";
import type { Coin, Language } from "@/lib/model";
import { api } from "@/lib/ui";

export default function ShenApp({page="discover",coinId}:{page?:string;coinId?:string}){
 const [lang,setLang]=useState<Language>("en"),[query,setQuery]=useState(""),[filter,setFilter]=useState("all"),[coins,setCoins]=useState<Coin[]>([]),[events,setEvents]=useState<ApiResponse["events"]>([]),[coin,setCoin]=useState<Coin>(),[canManage,setCanManage]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const [authVersion,setAuthVersion]=useState(0);
 // Reload views only when the signed-in wallet actually changes; signing in
 // again with the same wallet must not remount an in-progress launch.
 useEffect(()=>{let user:string|null|undefined;const read=async()=>{try{const r=await fetch("/api/auth",{cache:"no-store"});if(!r.ok)return;const next=((await r.json()) as {user?:{userId?:string}|null}).user?.userId??null;if(user!==undefined&&next!==user)setAuthVersion(v=>v+1);user=next}catch{}};void read();const changed=()=>void read();window.addEventListener("shen-auth-changed",changed);return()=>window.removeEventListener("shen-auth-changed",changed)},[]);
 const t=(zh:string,en:string)=>lang==="zh"?zh:en;
 // Storage can be blocked (private modes, site-data settings); never crash on it.
 useEffect(()=>{try{const saved=localStorage.getItem("shen-language");if(saved==="zh"||saved==="en")setLang(saved)}catch{}},[]);
 useEffect(()=>{document.documentElement.lang=lang==="zh"?"zh-CN":"en"},[lang]);
 function language(v:Language){setLang(v);try{localStorage.setItem("shen-language",v)}catch{}}
 useEffect(()=>{if(page==="launch"||page==="docs"){setLoading(false);return}let active=true;setLoading(true);setError("");setCoin(undefined);setCanManage(false);setCoins([]);setEvents([]);const url=page==="token"?"/api/coins/"+encodeURIComponent(coinId??""):page==="discover"?"/api/directory":"/api/coins";api(url).then(data=>{if(!active)return;if(page==="token"){setCoin(data.coin);setCanManage(!!data.canManage)}else{setCoins(data.coins);setEvents(data.events??[])}}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[page,coinId,authVersion]);
 useEffect(()=>{const ctx=(document as Document&{modelContext?:{registerTool:(tool:unknown,options:{signal:AbortSignal})=>void}}).modelContext;if(!ctx||!["discover","agents"].includes(page))return;const lifecycle=new AbortController();try{ctx.registerTool({name:"filter_agent_directory",description:"Filter the visible directory by name and status. Does not create, launch or control agents.",inputSchema:{type:"object",properties:{query:{type:"string"},status:{type:"string",enum:["all","active","dormant"]}},required:["query","status"],additionalProperties:false},annotations:{readOnlyHint:false},execute(input:unknown){const v=input as {query?:unknown;status?:unknown};if(typeof v?.query!=="string"||v.query.length>100||!(["all","active","dormant"] as unknown[]).includes(v.status))throw Error("Invalid filter");setQuery(v.query);setFilter(v.status as string);return {query:v.query,status:v.status}}},{signal:lifecycle.signal})}catch{}return()=>lifecycle.abort()},[page]);
 const signIn=error.toLowerCase().includes("sign in");
 return <div className="site-shell"><Toaster theme="dark"/><ShenHeader page={page} lang={lang} setLang={language} t={t}/><main className={"site-main qi-main qi-main-"+page}>
  <div className="qi-wrap qi-notice-wrap"><XConnectionNotice page={page} coinId={coinId} t={t}/></div>
  {(page==="discover"||page==="agents")&&<QiHome page={page} lang={lang} t={t} coins={coins} events={events} loading={loading} error={error} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter}/>}
  {page==="launch"&&<CreateLaunch lang={lang} t={t}/>}{page==="docs"&&<ShenDocs t={t}/>}
  {page==="token"&&(!loading&&!error&&coin?<TokenView key={coin.id+":"+authVersion} coin={coin} lang={lang} t={t} canManage={canManage}/>:<div className="qi-wrap qi-page"><div className="qi-empty qi-empty-page"><Bot/><h1>{loading?t("正在加载…","Loading agent…"):t("智能体不可用","Agent unavailable")}</h1><p>{error}</p><Link className="qi-btn qi-btn-ghost" href="/">{t("探索智能体","Discover agents")}</Link>{signIn&&<a href={"/signin?return_to="+encodeURIComponent("/token/"+coinId)} target="_top">{t("登录","Sign in")}</a>}</div></div>)}
 </main><ShenFooter t={t}/></div>
}
