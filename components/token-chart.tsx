"use client";
import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import type { Candle } from "@/lib/market";
import type { T } from "@/lib/ui";
type Data={candles:Candle[];source:string;currency?:string;indexing?:boolean;updatedAt:number;stale?:boolean;error?:string};
export default function TokenChart({coinId,t,compact=false}:{coinId:string;t:T;compact?:boolean}){
 const [data,setData]=useState<Data>(),[error,setError]=useState("");
 useEffect(()=>{let active=true;const load=async()=>{try{const r=await fetch("/api/coins/"+coinId+"/chart");const d=await r.json() as Data;if(!r.ok)throw Error(d.error||"Market data unavailable");if(active){setData(d);setError("")}}catch(e){if(active)setError((e as Error).message)}};void load();const timer=setInterval(load,120000);return()=>{active=false;clearInterval(timer)}},[coinId]);
 const candles=data?.candles??[],currency=data?.currency??"USD";
 if(!candles.length)return compact?<span className="no-data">{t("暂无交易数据","NO TRADE DATA")}</span>:<div className="empty-state"><Activity size={26}/><h3>{error?t("行情暂不可用","Market data unavailable"):t("等待已索引交易","Awaiting indexed trades")}</h3><p>{error||t("链上交易被索引后显示蜡烛图。","Candles appear as confirmed on-chain trades are indexed.")}</p></div>;
 const list=compact?candles.slice(-20):candles;const low=Math.min(...list.map(c=>c.low)),high=Math.max(...list.map(c=>c.high)),range=Math.max(high-low,high*.001,1e-16),width=compact?240:720,height=compact?80:260,pad=compact?2:14,step=width/list.length,y=(v:number)=>pad+(high-v)/range*(height-pad*2);
 return <div className={compact?"market-mini":"market-chart"}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={currency+" "+t("价格蜡烛图","price candlestick chart")} preserveAspectRatio="none">{[.25,.5,.75].map(v=><line key={v} x1={0} x2={width} y1={height*v} y2={height*v} stroke="currentColor" opacity=".12"/>)}{list.map((c,i)=>{const color=c.close>=c.open?"#94b39d":"#e07862";return <g key={c.time}><title>{new Date(c.time*1000).toLocaleString()} O {c.open} H {c.high} L {c.low} C {c.close}</title><line x1={(i+.5)*step} x2={(i+.5)*step} y1={y(c.high)} y2={y(c.low)} stroke={color}/><rect x={(i+.2)*step} y={y(Math.max(c.open,c.close))} width={Math.max(.5,step*.6)} height={Math.max(1,Math.abs(y(c.open)-y(c.close)))} fill={color}/></g>})}</svg>{!compact&&<><div className="market-axis"><span>{high.toPrecision(5)} {currency}</span><span>{new Date(list[0].time*1000).toLocaleString()}</span><span>{low.toPrecision(5)} {currency}</span></div><p className="market-source">{data?.source} · {currency} / 5M · {data?.indexing?t("正在补全历史 · ","Indexing history · "):""} {t("更新时间","Updated")} {new Date(data!.updatedAt).toLocaleTimeString()}{(data?.stale||error)&&" · "+t("缓存数据","Cached data")}</p></>}</div>
}
