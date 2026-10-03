"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bot, MessageSquare, ShieldCheck, Send, LoaderCircle, Clock3, Moon } from "lucide-react";
import type { Coin } from "@/lib/model";
import { agentModel } from "@/lib/agent-models";
import type { T } from "@/lib/ui";
import ModelLogo from "./model-logo";
import type { ChatWindow } from "@/lib/chat-schedule";

type Message={role:"visitor"|"agent";text:string;blocked?:boolean};
export default function AgentChat({coin,t}:{coin:Coin;t:T}){
 const [question,setQuestion]=useState(""),[messages,setMessages]=useState<Message[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[signIn,setSignIn]=useState(false);
 const [session,setSession]=useState<ChatWindow|null>(null),[now,setNow]=useState(Date.now()),[statusError,setStatusError]=useState(false);
 useEffect(()=>{let active=true;let serverTime=Date.now(),received=Date.now();const refresh=async()=>{try{const r=await fetch("/api/coins/"+coin.id+"/chat");const data=await r.json() as {window?:ChatWindow};if(!r.ok||!data.window)throw Error("Unavailable");if(active){serverTime=data.window.checkedAt;received=Date.now();setSession(data.window);setNow(serverTime);setStatusError(false)}}catch{if(active){setSession(null);setStatusError(true)}}};void refresh();const poll=setInterval(refresh,20000),tick=setInterval(()=>setNow(serverTime+Date.now()-received),1000);return()=>{active=false;clearInterval(poll);clearInterval(tick)}},[coin.id,coin.state]);
 const open=!!session?.open&&!!session.closesAt&&now<session.closesAt;
 const countdown=session?.closesAt?Math.max(0,Math.ceil((session.closesAt-now)/1000)):0;
 const cadence=session?.cadence==="hourly"?t("每小时","Every hour"):session?.cadence==="four-hourly"?t("每 4 小时","Every 4 hours"):t("每天","Daily");
 const end=useRef<HTMLDivElement>(null);
 useEffect(()=>{end.current?.scrollIntoView({behavior:"smooth",block:"nearest"})},[messages,busy]);
 async function ask(e:FormEvent){e.preventDefault();if(busy||!open||question.trim().length<3)return;setBusy(true);setError("");setSignIn(false);const text=question.trim();
  try{const r=await fetch("/api/coins/"+coin.id+"/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:text})});const data=await r.json() as {answer:string;blocked:boolean;error?:string;window?:ChatWindow};if(data.window)setSession(data.window);if(!r.ok){setSignIn(r.status===401);throw new Error(data.error||"Chat is unavailable.")}setMessages(m=>[...m.slice(-38),{role:"visitor",text},{role:"agent",text:data.answer,blocked:data.blocked}]);setQuestion("")}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <section className="agent-chat panel" aria-label={t("与智能体聊天","Chat with agent")}>
  <div className="chat-heading"><div className="chat-avatar"><Bot size={24}/></div><div><h2>{t("询问","Ask ")}{coin.symbol}</h2><span className="model-label"><ModelLogo modelId={coin.modelId} size={18}/>{agentModel(coin.modelId).name} <b>·</b> {coin.language==="zh"?"中文":"English"}</span></div><span className="chat-mode"><ShieldCheck size={14}/>{t("仅限问答","Q&A only")}</span></div>
  <div className="chat-boundary"><ShieldCheck size={18}/><p>{t("可以提问，不能下达指令。聊天不会改变使命、触发交易、支出或发帖。智能体按既定使命自主运行。","Ask questions, not commands. Chat cannot change the mission, trigger trades, spend funds or publish posts. The agent acts independently under its saved mission.")}</p></div>
  <div className={"chat-session "+(open?"is-open":"is-closed")}><div className="session-icon">{open?<Clock3 size={22}/>:<Moon size={22}/>}</div><div><span className="overline">{t("智能体管理的会话","AGENT-MANAGED SESSIONS")}</span><h3>{open?t("现在可以提问","Chat is open"):session?t("聊天暂歇","Chat is resting"):statusError?t("暂时无法获取会话状态","Session status unavailable"):t("正在检查会话…","Checking the session…")}</h3><p>{open?`${t("本次会话将在","Closes in")} ${Math.floor(countdown/60)}:${String(countdown%60).padStart(2,"0")}`:session?.nextOpensAt?`${t("下次计划开放","Next scheduled opening")}: ${new Date(session.nextOpensAt).toLocaleString()}`:t("资金与服务就绪后安排开放。","Sessions begin when funding and services are ready.")}</p>{session&&session.cadence!=="closed"&&<small>{cadence} · {session.durationMinutes} {t("分钟 / 次","minutes per session")} · {t("以资金情况为准","subject to funding")}</small>}</div></div>
  <p className="chat-funding-note">{t("智能体根据已确认的资金流入与服务成本安排聊天时间，必要时可提前关闭。访客不能开启或延长会话。","Chat hours adapt to confirmed funding and service costs. The agent can close early to conserve funds. Visitors cannot open or extend a session.")}</p>
  <div className="chat-messages" role="log" aria-live="polite" aria-relevant="additions">
   {!messages.length&&<div className="chat-empty"><MessageSquare size={29}/><h3>{t("了解它的想法。","Get to know the agent.")}</h3><p>{t("询问它的使命、资金机制或已记录的活动。","Ask about its purpose, funding or recorded activity.")}</p><div className="chat-suggestions">{[t("你的主要使命是什么？","What is your main purpose?"),t("金库资金如何使用？","How is the treasury used?"),t("你使用什么模型？","Which model do you use?")].map(q=><button key={q} type="button" onClick={()=>setQuestion(q)}>{q}</button>)}</div></div>}
   {messages.map((m,i)=><div key={i} className={"chat-message "+m.role+(m.blocked?" guarded":"")}><span className="overline">{m.role==="visitor"?t("你","YOU"):m.blocked?t("边界检查","GUARDRAIL"):coin.symbol}</span><p>{m.text}</p></div>)}
   {busy&&<div className="chat-thinking" role="status"><LoaderCircle className="spin" size={16}/>{t("正在检查并准备回答…","Checking your question…")}</div>}<div ref={end}/>
  </div>
  {error&&<div className="form-error" role="alert">{error}{signIn&&<a className="text-link" target="_top" href={"/signin?return_to="+encodeURIComponent("/token/"+coin.id)}>{t("登录后提问","Sign in to ask")}</a>}</div>}
  <form className="chat-composer" onSubmit={ask}><label className="sr-only" htmlFor="agent-question">{t("你的问题","Your question")}</label><textarea id="agent-question" maxLength={1200} minLength={3} required rows={2} value={question} onChange={e=>setQuestion(e.target.value)} placeholder={t("关于这个代币，你想了解什么？","What would you like to know about this coin?")} disabled={busy||!open}/><div><span>{question.length} / 1200</span><button className="button primary" type="submit" disabled={busy||!open||question.trim().length<3}>{busy?<LoaderCircle className="spin" size={16}/>:<Send size={15}/>} {open?t("提问","Ask agent"):t("会话已关闭","Chat closed")}</button></div></form>
 </section>
}
