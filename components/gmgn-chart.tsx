"use client";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { T } from "@/lib/ui";

export default function GmgnChart({address,symbol,t}:{address:string;symbol:string;t:T}){
  const [attempt,setAttempt]=useState(0);
  if(!/^0x[a-fA-F0-9]{40}$/.test(address))return <p className="body-copy">{t("代币地址不可用。","Token address unavailable.")}</p>;
  // Official BSC chart embed: https://docs.gmgn.ai/index/cooperation-api-integrate-gmgn-price-chart
  const url=`https://www.gmgn.cc/kline/bsc/${address}?theme=dark&interval=5`;
  return <div className="gmgn-chart">
    <iframe key={address+":"+attempt} src={url} title={`${symbol} · ${t("GMGN 价格图表","GMGN price chart")}`} loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"/>
    <div className="gmgn-chart-footer">
      <p>{t("图表由 GMGN 提供。新代币可能需要等待行情收录。","Chart provided by GMGN. New tokens may take time to be indexed.")}</p>
      <div><button type="button" className="text-link" onClick={()=>setAttempt(value=>value+1)}>{t("重新加载图表","Reload chart")}</button><a className="text-link" href={url} target="_blank" rel="noopener noreferrer">{t("在 GMGN 打开","Open in GMGN")} <ExternalLink size={13}/></a></div>
    </div>
  </div>;
}
