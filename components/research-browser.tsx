"use client";
import { useEffect, useState } from 'react';
import type { BrowserSession } from '@/lib/browser-research';
import type { T } from '@/lib/ui';
export default function ResearchBrowser({sessions,t}:{sessions:BrowserSession[];t:T}){
  const [selected,setSelected]=useState<string|null>(null),[index,setIndex]=useState(0),[playing,setPlaying]=useState(false);
  const session=sessions.find(s=>s.id===selected)??sessions[0];
  useEffect(()=>{setIndex(0);setPlaying(false);},[session?.id]);
  useEffect(()=>{if(!playing||!session?.frames.length)return;const timer=setInterval(()=>setIndex(i=>(i+1)%session.frames.length),2000);return()=>clearInterval(timer);},[playing,session?.id,session?.frames.length]);
  if(!session)return <div className="research-browser"><span className="overline">{t('浏览器','BROWSER')}</span><p>{t('智能体打开来源页面后，真实页面截图会显示在这里。','Actual page captures appear here when the agent opens a source.')}</p></div>;
  const frame=session.frames[index]??session.frames[0];
  return <div className="research-browser"><header><span className="overline">{t('浏览器','BROWSER')}</span><span>{t('只读页面记录','READ-ONLY CAPTURE')}</span></header><a className="browser-address" href={session.url} target="_blank" rel="noopener noreferrer nofollow">{session.url}</a>
    {frame?<div className="browser-screen"><img src={frame.imageUrl} alt={session.title||t('智能体访问的页面','Page visited by the agent')}/></div>:<div className="browser-placeholder">{session.status==='browsing'?t('正在打开公开页面…','Opening public page…'):t('没有已确认的页面截图。','No confirmed page capture.')}</div>}
    <div className="browser-controls"><button type="button" disabled={session.frames.length<2} onClick={()=>setPlaying(v=>!v)}>{playing?t('暂停','Pause'):t('重播','Replay')}</button><span>{session.title||new URL(session.url).hostname}</span><time>{new Date(session.startedAt).toLocaleString()}</time></div>
    <div className="browser-frames">{session.frames.map((f,i)=><button type="button" key={f.id} aria-label={t('页面截图','Page capture')+' '+(i+1)} aria-pressed={index===i} onClick={()=>{setIndex(i);setPlaying(false);}}><img src={f.imageUrl} alt="" loading="lazy"/></button>)}</div>
    {sessions.length>1&&<label>{t('浏览记录','Visited pages')}<select value={session.id} onChange={e=>setSelected(e.target.value)}>{sessions.map(s=><option key={s.id} value={s.id}>{s.title||new URL(s.url).hostname} · {new Date(s.startedAt).toLocaleTimeString()}</option>)}</select></label>}
  </div>;
}
