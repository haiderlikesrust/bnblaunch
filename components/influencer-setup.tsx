"use client";
import { useEffect, useRef, useState } from "react";
import { Clapperboard, Upload, X, LockKeyhole, Sparkles } from "lucide-react";
import { INFLUENCER_GROUPS, influencerBrief, hasCharacterChoices, type InfluencerConfig, type InfluencerGroup } from "@/lib/influencer-options";
import { validateImage } from "@/lib/token-image";
import type { TokenImage } from "./token-image-input";
import type { T } from "@/lib/ui";

export const blankInfluencer:InfluencerConfig={enabled:true,kind:null,presents:null,age:null,build:null,hair:null,outfit:null,features:[],accessories:[],vibe:null,style:"logo",palette:[],notes:""};
export type InfluencerPlatform={available:boolean;dailyPosts:number;videos:boolean};
const ORDER:InfluencerGroup[]=["kind","presents","age","build","hair","outfit","features","accessories","vibe","style"];

export default function InfluencerSetup({value,onChange,reference,onReference,consent,onConsent,coin,t}:{value:InfluencerConfig|null;onChange:(value:InfluencerConfig|null)=>void;reference:TokenImage|null;onReference:(value:TokenImage|null)=>void;consent:boolean;onConsent:(value:boolean)=>void;coin:{name:string;symbol:string};t:T}){
 const input=useRef<HTMLInputElement>(null),[error,setError]=useState(""),[platform,setPlatform]=useState<InfluencerPlatform|null>(null);
 useEffect(()=>{let alive=true;fetch("/api/platform").then(r=>r.json() as Promise<{influencer?:InfluencerPlatform}>).then(v=>{if(alive&&v.influencer)setPlatform(v.influencer)}).catch(()=>{});return()=>{alive=false}},[]);
 async function select(file?:File){if(!file)return;setError("");try{
  if(file.size>2000000||!["image/png","image/jpeg","image/webp"].includes(file.type))throw Error(t("请选择小于 2 MB 的 PNG、JPEG 或 WebP 图片。","Choose a PNG, JPEG or WebP image under 2 MB."));
  const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error("Could not read image."));reader.readAsDataURL(file)});
  const next={mime:file.type as TokenImage["mime"],base64:data.split(",")[1]};validateImage(next);
  const image=new Image();image.src=data;await image.decode();onReference(next);onConsent(false);
 }catch(e){setError((e as Error).message)}finally{if(input.current)input.current.value=""}}
 function toggle(group:InfluencerGroup,id:string){
  if(!value)return;
  if(INFLUENCER_GROUPS[group].multi){const list=value[group as "features"|"accessories"] as string[];onChange({...value,[group]:list.includes(id)?list.filter(v=>v!==id):[...list,id]});return;}
  if(group==="style"){onChange({...value,style:id as InfluencerConfig["style"]});return;}
  onChange({...value,[group]:value[group]===id?null:id});
 }
 const pressed=(group:InfluencerGroup,id:string)=>{const current=value?.[group];return Array.isArray(current)?(current as string[]).includes(id):current===id;};
 const posts=platform?.dailyPosts??6;
 return <div className="influencer-setup">
  <div className="influencer-choice" role="radiogroup" aria-label={t("AI 网红","AI influencer")}>
   <button type="button" role="radio" aria-checked={!value} onClick={()=>{onChange(null);onReference(null);onConsent(false)}}><strong>{t("跳过","Skip")}</strong><span>{t("没有角色，无需 X","No character, no X needed")}</span></button>
   <button type="button" role="radio" aria-checked={!!value} onClick={()=>onChange(value??blankInfluencer)}><strong><Clapperboard size={16}/>{t("启用 AI 网红","Enable AI influencer")}</strong><span>{t("一个持续存在的角色，制作视频并在 X 发布","A persistent character that makes videos and posts on X")}</span></button>
  </div>
  {platform&&!platform.available&&<p className="subtle-note"><Sparkles size={17}/>{t("平台尚未开启 AI 网红媒体服务。你的角色设定会被保存，服务开启后自动开始。","AI influencer media isn't switched on for SHEN yet. Your character is saved and starts automatically once it is.")}</p>}
  {value&&<>
   <div className="influencer-step"><span>1</span><div><h4>{t("连接 X","Connect X")}</h4><p>{t("必需。发行后在代币页面连接该代币的 X 账号，它将成为角色的公开身份。你在 x.com 登录：SHEN 不会看到你的密码，令牌在服务器上加密保存。","Required. After launch, connect the coin's X account from its page; it becomes the character's public identity. You sign in on x.com: SHEN never sees your password, and its tokens stay encrypted on the server.")}</p></div></div>
   <div className="influencer-step"><span>2</span><div><h4>{t("创建它的角色","Create its character")}</h4><p>{t("SHEN 通过 Higgsfield 设计一次全身主形象并训练角色身份，之后每条内容都会对照它生成，保持同一个角色。参考照片或绘画是最强的指引；代币标志决定配色。","SHEN designs a full-body master once with Higgsfield and trains the character's identity, then checks every piece against it so it stays the same character. A reference photo or drawing is the strongest guide; the coin logo sets its colours.")}</p></div></div>
   <div className="influencer-designer">
    <div className="influencer-reference">
     <div className="influencer-reference-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void select(e.dataTransfer.files[0])}}>
      {reference?<><img src={`data:${reference.mime};base64,${reference.base64}`} alt={t("角色参考图","Character reference")}/><button type="button" className="image-remove" aria-label={t("移除参考图","Remove reference")} onClick={()=>{onReference(null);onConsent(false)}}><X size={15}/></button></>:<label htmlFor="influencer-reference"><Upload size={20}/><strong>{t("参考图","Reference")}</strong><small>{t("可选 · PNG JPG WEBP","optional · PNG JPG WEBP")}</small></label>}
      <input ref={input} id="influencer-reference" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>void select(e.target.files?.[0])}/>
     </div>
     {reference&&<label className="influencer-consent"><input type="checkbox" checked={consent} onChange={e=>onConsent(e.target.checked)}/><span>{t("我拥有此图片或已获授权，且图中不是未经同意的真实人物。","I own this image or have permission to use it, and it doesn't show a real person without their consent.")}</span></label>}
     {error&&<small role="alert" className="form-error">{error}</small>}
    </div>
    <div className="influencer-groups">{ORDER.map(group=>{const g=INFLUENCER_GROUPS[group];return <div className="influencer-group" key={group} role="group" aria-label={t(g.label[0],g.label[1])}><span className="overline">{t(g.label[0],g.label[1])}{g.multi&&<small>{t("可多选","any")}</small>}</span><div className="character-options">{g.options.map(o=><button type="button" key={o[0]} aria-pressed={pressed(group,o[0])} onClick={()=>toggle(group,o[0])}>{t(o[2],o[1])}</button>)}</div></div>})}
     <label className="form-field influencer-notes">{t("用你的话描述","In your words")}<small>{t("它怎么说话、喜欢什么，其他任何细节","how it talks, what it is into, anything else")}</small><textarea rows={3} maxLength={600} value={value.notes} placeholder={t("像深夜电台主持人一样说话，痴迷图表，从不微笑","Talks like a late-night radio host, obsessed with charts, never smiles")} onChange={e=>onChange({...value,notes:e.target.value})}/><small>{value.notes.length} / 600</small></label>
     <div className="influencer-brief"><span className="overline">{t("角色简报","BRIEF")}</span><p>{hasCharacterChoices(value)||reference?influencerBrief(value,{name:coin.name||t("你的代币","your coin"),symbol:coin.symbol||"TICKER"}):t("留空：SHEN 将根据代币标志与个性设计角色。","Empty: SHEN designs it from the coin's logo and personality.")}</p></div>
    </div>
   </div>
   <p className="influencer-footnote">{t(`无需调整设置：角色按自己的节奏生活，每天最多约 ${posts} 条内容（短视频、自拍与照片），费用来自智能体的服务额度。`,`No settings to tune: the character lives its own life, up to about ${posts} posts a day${platform?.videos===false?"":" mixing short videos, selfies and photos"}, spread out at its own pace and paid from the agent's service credit.`)}</p>
   <p className="influencer-footnote"><LockKeyhole size={14}/>{t("发行后连接 X 即可开启网红。在此之前，代币正常运行但没有网红。","Connect X after launch to turn the influencer on. Until then, this coin runs without it.")}</p>
  </>}
 </div>;
}
