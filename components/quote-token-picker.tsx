"use client";
import {useEffect,useId,useState} from 'react';
import {Check,ChevronRight,Search,ShieldCheck,LoaderCircle,AlertCircle,Wallet,X} from 'lucide-react';
import {QUOTE_CATALOG} from '@/shared/quote-catalog.mjs';
const NATIVE='0x0000000000000000000000000000000000000000';
const short=(address:string)=>address.toLowerCase()===NATIVE?'Native BNB':address.slice(0,6)+'…'+address.slice(-4);
const categories=[['crypto','Crypto'],['stocks','Stocks'],['pre-ipo','Pre-IPO'],['all','All']];
export default function QuoteTokenPicker({value,onChange,disabled}:{value:string;onChange:(address:string)=>void;disabled:boolean}){
 const id=useId(),[category,setCategory]=useState('crypto'),[search,setSearch]=useState(''),[custom,setCustom]=useState(''),[status,setStatus]=useState(''),[symbol,setSymbol]=useState(''),[gas,setGas]=useState(''),[phase,setPhase]=useState<'loading'|'ready'|'error'>('loading'),[retry,setRetry]=useState(0);
 const selected=QUOTE_CATALOG.find(t=>t.address.toLowerCase()===value.toLowerCase());
 useEffect(()=>{
  const controller=new AbortController();setPhase('loading');setStatus('Checking pair availability…');setGas('');setSymbol('');
  void fetch('/api/quote-tokens?address='+encodeURIComponent(value),{signal:controller.signal}).then(async r=>({ok:r.ok,body:await r.json() as {token?:{symbol:string};gasDepositBnb?:string;error?:string}})).then(({ok,body})=>{
   if(controller.signal.aborted)return;
   setPhase(ok?'ready':'error');setStatus(ok?'Eligible pair':body.error??'Pair unavailable');setSymbol(body.token?.symbol??'');setGas(body.gasDepositBnb??'');
  }).catch(()=>{if(!controller.signal.aborted){setPhase('error');setStatus('Could not check this pair. Try again.')}});
  return()=>controller.abort();
 },[value,retry]);
 const tokens=QUOTE_CATALOG.filter(t=>(category==='all'||t.category===category)&&`${t.symbol} ${t.name} ${t.address}`.toLowerCase().includes(search.trim().toLowerCase()));
 function choose(address:string){onChange(address.toLowerCase())}
 return <section className="quote-picker span-two" aria-labelledby={id+'-title'}>
  <header className="quote-heading"><div><span className="overline">TRADING PAIR</span><h3 id={id+'-title'}>Choose your pair token</h3><p>The asset your coin trades against.</p></div><span className="quote-chain"><i/>BNB CHAIN</span></header>
  <div className="quote-categories" role="group" aria-label="Token categories">{categories.map(([key,label])=><button type="button" aria-pressed={category===key} disabled={disabled} key={key} onClick={()=>setCategory(key)}>{label}</button>)}</div>
  <div className="quote-search"><Search size={17}/><input aria-label="Search pair tokens" placeholder="Search name, ticker or address" value={search} disabled={disabled} onChange={e=>setSearch(e.target.value)}/>{search&&<button type="button" disabled={disabled} aria-label="Clear search" onClick={()=>setSearch('')}><X size={15}/></button>}</div>
  <div className="quote-token-grid" role="group" aria-label="Available pair tokens">{tokens.length?tokens.map(token=>{
   const active=token.address.toLowerCase()===value.toLowerCase();
   return <button type="button" className="quote-token" aria-pressed={active} disabled={disabled} key={token.address} onClick={()=>choose(token.address)}>
    <span className={'quote-token-icon '+(token.address===NATIVE?'native':token.category)} aria-hidden="true">{token.address===NATIVE?'◆':token.symbol.slice(0,2)}</span>
    <span className="quote-token-details"><strong>{token.symbol}</strong><span>{token.name}</span><small>{short(token.address)}</small></span>
    <span className="quote-token-check" aria-hidden="true">{active&&<Check size={12}/>}</span>
   </button>;
  }):<div className="quote-empty"><Search size={22}/><strong>No matching tokens</strong><p>Try another category or check a contract address below.</p></div>}</div>
  <div className="quote-custom"><label htmlFor={id+'-custom'}>Custom contract address</label><div><input id={id+'-custom'} placeholder="0x… supported token on BNB Chain" value={custom} disabled={disabled} spellCheck={false} autoComplete="off" onChange={e=>setCustom(e.target.value.trim())}/><button type="button" className="button secondary" disabled={disabled||!/^0x[0-9a-fA-F]{40}$/.test(custom)} onClick={()=>{if(custom.toLowerCase()===value.toLowerCase())setRetry(n=>n+1);else choose(custom)}}>Check <ChevronRight size={14}/></button></div></div>
  <div className={'quote-selection '+phase} role="status"><div className="quote-selection-top">{phase==='loading'?<LoaderCircle className="spin" size={17}/>:phase==='ready'?<ShieldCheck size={17}/>:<AlertCircle size={17}/>}<strong>{selected?.symbol||symbol||'Custom token'}</strong><span>{short(value)}</span></div><div className="quote-selection-bottom"><span>{status}{phase==='ready'?' · rechecked before launch':''}</span>{phase==='error'&&<button type="button" disabled={disabled} onClick={()=>setRetry(n=>n+1)}>Retry</button>}</div></div>
  {value.toLowerCase()!==NATIVE&&<div className="quote-gas-note"><Wallet size={16}/><p><strong>{gas&&gas!=='0'?`${gas} BNB estimated agent gas deposit`:'Separate BNB deposit for agent gas'}</strong><span>Sent directly to the agent after launch, with your wallet approval. Network gas is additional.</span></p></div>}
  <p className="quote-disclaimer">Stock and pre-IPO options are tokenized assets, not direct share ownership.</p>
 </section>;
}
