"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { Wallet, LoaderCircle, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { connectWallet } from "@/lib/wallet-login";
import type { Language } from "@/lib/model";
import type { T } from "@/lib/ui";
export const X_HANDLE="qidotnow";
export default function ShenHeader({page,lang,setLang,t}:{page:string;lang:Language;setLang:(v:Language)=>void;t:T}){const [wallet,setWallet]=useState("");const [busy,setBusy]=useState(false);const [open,setOpen]=useState(false);useEffect(()=>{
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
 },[]);
 useEffect(()=>{if(!open)return;const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false)};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[open]);
 async function connect(){setBusy(true);try{setWallet(await connectWallet());toast.success(t('钱包已登录。','Wallet signed in.'))}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}}
 const links:[string,string,string,string][]=[["discover","/","探索","Discover"],["agents","/agents","我的智能体","My agents"],["docs","/docs","文档","Docs"]];
 const sheet:[string,string,string,string][]=[...links,["launch","/launch","发行代币","Launch a token"]];
 return <header className="qi-nav"><div className="qi-wrap qi-nav-row">
  <Link className="qi-logo" href="/" aria-label="QI home"><img src="/qi-symbol.svg" alt="" width={26} height={26}/><span translate="no">QI</span><b translate="no">启</b></Link>
  <nav className="qi-nav-links" aria-label="Main navigation">{links.map(([id,url,zh,en])=><Link key={id} href={url} className={page===id?"selected":""} aria-current={page===id?"page":undefined}>{t(zh,en)}</Link>)}</nav>
  <div className="qi-nav-end">
   <span className="qi-chain"><i/>BNB · 56</span>
   <button className="qi-lang" onClick={()=>setLang(lang==="zh"?"en":"zh")} aria-label={t("切换语言","Switch language")}>{lang==="zh"?"EN":"中文"}</button>
   <a className="qi-icon-btn" href={`https://x.com/${X_HANDLE}`} target="_blank" rel="noopener noreferrer" aria-label={`QI on X (@${X_HANDLE})`}><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>
   <Link href="/launch" className={"qi-btn qi-btn-sm qi-nav-cta"+(page==="launch"?" selected":"")}>{t("发行","Launch")}</Link>
   <button className="qi-btn qi-btn-ghost qi-btn-sm qi-wallet" onClick={connect} disabled={busy}>{busy?<LoaderCircle className="spin" size={14}/>:<Wallet size={14}/>}<span>{wallet?wallet.slice(0,6)+"…"+wallet.slice(-4):t("连接钱包","Connect wallet")}</span></button>
   <button className="qi-burger" aria-label={open?t("关闭菜单","Close menu"):t("打开菜单","Open menu")} aria-expanded={open} onClick={()=>setOpen(v=>!v)}><span/><span/></button>
  </div>
 </div>
 {open&&<div className="qi-sheet">{sheet.map(([id,url,zh,en],i)=><Link key={id} href={url} className={page===id?"selected":""} onClick={()=>setOpen(false)}><span>{String(i+1).padStart(2,"0")}</span>{t(zh,en)}</Link>)}<button className="qi-sheet-wallet" onClick={()=>{void connect()}} disabled={busy}><span>05</span>{wallet?wallet.slice(0,6)+"…"+wallet.slice(-4):t("连接钱包","Connect wallet")}{busy?<LoaderCircle className="spin" size={14}/>:<Wallet size={14}/>}</button><a href={`https://x.com/${X_HANDLE}`} target="_blank" rel="noopener noreferrer"><span>06</span>X · @{X_HANDLE}<ArrowUpRight size={14}/></a><button className="qi-sheet-lang" onClick={()=>setLang(lang==="zh"?"en":"zh")}><span>07</span>{lang==="zh"?"English":"中文"}</button></div>}
 </header>}
