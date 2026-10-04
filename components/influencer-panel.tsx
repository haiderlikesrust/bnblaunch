"use client";
import { useEffect, useState } from "react";
import { Clapperboard, ArrowUpRight, LoaderCircle, Video } from "lucide-react";
import { optionLabel, INFLUENCER_GROUPS, type InfluencerConfig, type InfluencerGroup } from "@/lib/influencer-options";
import type { T } from "@/lib/ui";

type Status={enabled:false}|{enabled:true;status:string;brief:string;config:InfluencerConfig;characterImageUrl:string|null;referenceImageUrl:string|null;xUsername:string|null;xConnected:boolean;nextPostAt:number|null;notice:string|null;posts:{id:string;kind:string;status:string;caption:string|null;imageUrl:string|null;tweetUrl:string|null;createdAt:number}[]};
const SUMMARY:InfluencerGroup[]=["kind","presents","age","vibe","style"];

export default function InfluencerPanel({coinId,canManage,t}:{coinId:string;canManage:boolean;t:T}){
 const [value,setValue]=useState<Status|null>(null),[error,setError]=useState("");
 useEffect(()=>{let alive=true;async function read(){try{const r=await fetch(`/api/coins/${encodeURIComponent(coinId)}/influencer`,{cache:"no-store"}),v=await r.json() as Status&{error?:string};if(!r.ok)throw Error(v.error);if(alive){setValue(v);setError("")}}catch(e){if(alive)setError((e as Error).message)}}void read();const timer=setInterval(read,60000);return()=>{alive=false;clearInterval(timer)}},[coinId]);
 if(error)return <div className="panel"><p className="body-copy" role="status">{error}</p></div>;
 if(!value)return <div className="panel empty-state"><LoaderCircle className="spin" size={22}/></div>;
 if(!value.enabled)return <div className="panel empty-state"><Clapperboard size={26}/><h3>{t("未启用 AI 网红","No AI influencer")}</h3><p>{t("此代币发行时没有选择 AI 网红。","This coin launched without an AI influencer.")}</p></div>;
 const status:Record<string,[string,string,string]>={
  pending_launch:["dormant",t("等待发行","Starts after launch"),t("代币发行后，连接 X 即可开启网红。","Once the coin launches, connecting X turns the influencer on.")],
  awaiting_x:["dormant",t("等待连接 X","Connect X"),canManage?t("在下方连接此代币的 X 账号以开启网红。该账号将成为角色的公开身份。","Connect this coin's X account below to turn the influencer on. That account becomes the character's public identity."):t("开发者连接 X 后，网红将开始发布。","The influencer starts posting once the developer connects X.")],
  awaiting_funds:["dormant",t("等待服务额度","Waiting for credit"),t("角色设计需要智能体的服务额度。金库获得费用后会自动开始。","Designing the character needs the agent's service credit. It starts automatically once the treasury has earned fees.")],
  designing:["dormant",t("正在设计","Designing"),t("正在通过 Higgsfield 设计角色的全身主形象…","Designing the character's full-body master with Higgsfield…")],
  training:["dormant",t("正在训练","Training identity"),t("正在训练角色身份，让每条内容都是同一个角色…","Training the character's identity so every post stays the same character…")],
  active:["active",t("在线","Live"),value.xUsername?t(`正在以 @${value.xUsername} 的身份在 X 发布。`,`Posting on X as @${value.xUsername}.`):t("正在 X 发布。","Posting on X.")],
  failed:["paused",t("设计失败","Design failed"),value.notice??t("角色设计未能完成。","The character design could not complete.")],
  unavailable:["paused",t("暂不可用","Unavailable"),t("平台尚未开启 AI 网红媒体服务。角色设定已保存。","AI influencer media isn't switched on for QI yet. The character is saved.")],
 };
 const [tone,label,detail]=status[value.status]??status.unavailable;
 const chips=SUMMARY.map(g=>optionLabel(g,value.config[g] as string|null,t)).filter(Boolean);
 const extras=[...value.config.features,...value.config.accessories].map(id=>optionLabel(INFLUENCER_GROUPS.features.options.some(o=>o[0]===id)?"features":"accessories",id,t)).filter(Boolean);
 return <div className="panel influencer-panel">
  <div className="panel-heading"><h2><Clapperboard size={18}/>{t("AI 网红","AI influencer")}</h2><span className={"status "+tone}>{label}</span></div>
  <div className="influencer-profile">
   <div className="influencer-portrait">{value.characterImageUrl?<img src={value.characterImageUrl} alt={t("AI 网红角色主形象","AI influencer character master")}/>:<Clapperboard size={30}/>}</div>
   <div><p className="body-copy">{detail}</p>{value.status==="active"&&value.notice&&<p className="body-copy">{value.notice}</p>}{value.nextPostAt&&value.status==="active"&&<small className="overline">{t("下一条约在","Next post around")} {new Date(value.nextPostAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</small>}
    {(chips.length>0||extras.length>0)&&<div className="influencer-chips">{[...chips,...extras].map(c=><span key={c}>{c}</span>)}</div>}
    <p className="influencer-brief-text">{value.brief}</p>{value.config.notes&&<p className="influencer-brief-text">“{value.config.notes}”</p>}
    {value.xUsername&&<a className="text-link" href={"https://x.com/"+value.xUsername} target="_blank" rel="noreferrer">𝕏 @{value.xUsername}<ArrowUpRight size={14}/></a>}
   </div>
  </div>
  {value.posts.length?<div className="influencer-posts">{value.posts.map(p=><article key={p.id} className="influencer-post">{p.imageUrl?<div className="influencer-post-media"><img src={p.imageUrl} alt={p.caption??t("网红内容","Influencer post")} loading="lazy"/>{p.kind==="video"&&<span><Video size={13}/>{t("视频","Video")}</span>}</div>:<div className="influencer-post-media pending"><LoaderCircle className="spin" size={18}/><small>{t("创作中…","Creating…")}</small></div>}{p.caption&&<p>{p.caption}</p>}<div className="publication-meta"><span className="overline">{new Date(p.createdAt).toLocaleString()}</span>{p.tweetUrl&&<a href={p.tweetUrl} className="text-link" target="_blank" rel="noreferrer">{t("在 X 查看","View on X")}<ArrowUpRight size={14}/></a>}</div></article>)}</div>:<p className="body-copy">{t("网红发布的视频、自拍和照片会出现在这里。","Videos, selfies and photos the influencer posts appear here.")}</p>}
 </div>;
}
