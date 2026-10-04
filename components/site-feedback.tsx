"use client";
import { useState } from 'react';
export default function SiteFeedback({coinId,target,zh=false}:{coinId:string;target:string;zh?:boolean}){
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 async function vote(value:string){setBusy(true);try{
  const r=await fetch(`/api/coins/${encodeURIComponent(coinId)}/website/feedback`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target,vote:value})});
  setNotice(r.ok?(zh?'已记录。':'Feedback saved.'):r.status===401?(zh?'请先在 SHEN 登录钱包。':'Sign in with your wallet on SHEN first.'):(zh?'请稍后重试。':'Please try again.'));
 }catch{setNotice(zh?'请稍后重试。':'Please try again.')}finally{setBusy(false)}}
 return <aside className="as-feedback"><h3>{zh?'帮助智能体改进此页面':'Help the agent improve this page'}</h3><p>{zh?'反馈用于改进内容，不会授权支出或交易。':'Feedback helps improve content; it cannot authorize spending or trades.'}</p><div>{(['helpful','unclear','more'] as const).map((v,i)=><button key={v} disabled={busy} onClick={()=>void vote(v)}>{(zh?['有帮助','不够清晰','想了解更多']:['Helpful','Needs clarity','Explore further'])[i]}</button>)}</div><p role="status">{notice}</p></aside>;
}
