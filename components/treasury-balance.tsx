"use client";
import { useEffect, useState } from "react";
import type { Coin } from "@/lib/model";
import type { T } from "@/lib/ui";

export default function TreasuryBalance({coin,t}:{coin:Coin;t:T}){
  const [snapshot,setSnapshot]=useState<{balance:number;observedAt:number}|null>(coin.treasuryObservedAt?{balance:coin.balance,observedAt:coin.treasuryObservedAt}:null);
  const [error,setError]=useState(false);
  useEffect(()=>{
    if(!coin.tokenAddress||!coin.treasuryAddress)return;
    let active=true,timer:ReturnType<typeof setTimeout>;
    const controller=new AbortController();
    async function load(){
      try{
        const result=await fetch(`/api/coins/${coin.id}/balance`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),cache:"no-store"});
        const data=await result.json() as {address?:string;balance:number;observedAt:number};
        if(!result.ok||data.address?.toLowerCase()!==coin.treasuryAddress?.toLowerCase()||!Number.isFinite(data.balance)||data.balance<0||!Number.isFinite(data.observedAt))throw Error();
        if(active){setSnapshot({balance:data.balance,observedAt:data.observedAt});setError(false)}
      }catch{if(active)setError(true)}
      finally{if(active)timer=setTimeout(()=>{void load()},15000)}
    }
    void load();return()=>{active=false;controller.abort();clearTimeout(timer)};
  },[coin.id,coin.tokenAddress,coin.treasuryAddress]);
  const value=snapshot?.balance;
  return <div><span className="overline">{t("已确认的金库余额","Confirmed treasury balance")}</span>
    <strong>{!coin.tokenAddress?"0.000":value===undefined?"—":value>0&&value<0.000001?"<0.000001":value.toFixed(6)}<small>BNB</small></strong>
    <span className="treasury-balance-status" role="status">{!coin.tokenAddress?t("尚未发行","Pre-launch"):error?snapshot?t("更新暂不可用 · 显示上次记录","Update unavailable · last known balance"):t("余额暂不可用","Balance unavailable"):snapshot?`${t("检查时间","Checked")} ${new Date(snapshot.observedAt).toLocaleTimeString()}`:t("正在读取链上余额…","Reading on-chain balance…")}</span>
    {coin.treasuryAddress&&<a className="text-link treasury-balance-link" href={`https://bscscan.com/address/${coin.treasuryAddress}`} target="_blank" rel="noopener noreferrer">{t("在 BscScan 查看钱包","View wallet on BscScan")}</a>}
  </div>;
}
