"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { Compass, Bot, Activity, Wallet, Plus, LoaderCircle, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { connectWallet } from "@/lib/wallet-login";
import type { Language } from "@/lib/model";
import type { T } from "@/lib/ui";
export default function ShenHeader({page,lang,setLang,t}:{page:string;lang:Language;setLang:(v:Language)=>void;t:T}){const [wallet,setWallet]=useState("");const [busy,setBusy]=useState(false);useEffect(()=>{
 let alive=true,generation=0,previous:string|undefined;
 const read=async()=>{const current=++generation;try{
  const response=await fetch('/api/auth',{cache:'no-store'});if(!response.ok)return;
  const data=await response.json() as {user?:{userId:string}|null};
  if(!alive||current!==generation)return;
  const next=data.user?.userId??'',changed=previous!==undefined&&previous!==next;
  previous=next;setWallet(next);
  if(changed)window.dispatchEvent(new Event('shen-auth-changed'));
 }catch{}};
 const stored=(event:StorageEvent)=>{if(event.key==='shen-auth-version')window.dispatchEvent(new Event('shen-auth-changed'))};
 void read();window.addEventListener('shen-auth-changed',read);window.addEventListener('focus',read);window.addEventListener('storage',stored);
 return()=>{alive=false;window.removeEventListener('shen-auth-changed',read);window.removeEventListener('focus',read);window.removeEventListener('storage',stored)}
 },[]);async function connect(){setBusy(true);try{setWallet(await connectWallet());toast.success(t('钱包已登录。','Wallet signed in.'))}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}}return <header className="shen-header"><div className="header-top"><Link className="shen-brand" href="/" aria-label="SHEN home"><img src="/shen-symbol.png" alt="" width={45} height={45}/><span translate="no">SHEN<span className="brand-period">.</span></span><span className="brand-kanji" translate="no">神</span></Link><div className="network-tag"><span className="network-diamond"/>BNB CHAIN <span className="network-sub">/ AGENT PROTOCOL</span></div><div className="header-controls"><button className="language-btn" onClick={()=>setLang(lang==="zh"?"en":"zh")}>{lang==="zh"?"EN":"中文"}</button><button className="button wallet-button" onClick={connect} disabled={busy}>{busy?<LoaderCircle className="spin" size={15}/>:<Wallet size={15}/>}<span>{wallet?wallet.slice(0,6)+"…"+wallet.slice(-4):t("连接钱包","Connect wallet")}</span></button></div></div><div className="header-bottom"><nav className="main-nav" aria-label="Main navigation">{[["discover","/",Compass,"探索","Discover"],["agents","/agents",Bot,"我的智能体","My agents"],["activity","/activity",Activity,"动态","Activity"],["docs","/docs",BookOpen,"文档","Docs"]].map(([id,url,Icon,zh,en],i)=>{const I=Icon as typeof Compass;return <Link key={String(id)} href={String(url)} className={page===id?"selected":""} aria-current={page===id?"page":undefined}><span className="nav-number">0{i+1}</span><I size={15}/>{t(String(zh),String(en))}</Link>})}</nav><Link href="/launch" className={"launch-link "+(page==="launch"?"selected":"")}><Plus size={15}/>{t("创建代币","Create a token")}</Link></div></header>}
