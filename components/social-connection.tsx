"use client";
import { useEffect, useState } from 'react';
import { Check, LockKeyhole, LoaderCircle, ArrowUpRight } from 'lucide-react';
import type { T } from '@/lib/ui';
type Status={configured:boolean;connected:boolean;username:string|null;reconnectRequired:boolean;error?:string};
export default function SocialConnection({coinId,t}:{coinId:string;t:T}){
 const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let alive=true;fetch('/api/coins/'+coinId+'/social').then(r=>r.json() as Promise<Status>).then(v=>{if(alive){if(v.error)setError(v.error);else setStatus(v)}}).catch(()=>{if(alive)setError('Could not check the X account.')});return()=>{alive=false}},[coinId]);
 async function connect(){setBusy(true);setError('');try{const r=await fetch('/api/coins/'+coinId+'/social',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'connect',consent:true})});const value=await r.json() as {url:string;error?:string};if(!r.ok)throw Error(value.error);const url=new URL(value.url);if(url.origin!=='https://x.com'||url.pathname!=='/i/oauth2/authorize')throw Error('Invalid X authorization link');window.location.assign(url.href)}catch(e){setError((e as Error).message);setBusy(false)}}
 return <section className="panel x-connection"><div className="panel-heading"><h2><span className="x-mark">𝕏</span>{t('社区账号','Community account')}</h2><span className={'status '+(status?.connected&&!status.reconnectRequired?'active':'dormant')}>{status?.connected&&!status.reconnectRequired?t('已连接','Connected'):t('待连接','Connect account')}</span></div>
 <p className="body-copy">{t('通过 X 授权你的项目账号。发行并获得资金后，智能体自主发布更新与图片。','Authorize your project’s account on X. After launch and funding, the agent decides when to publish updates and artwork.')}</p>
 {status?.username&&<div className="x-connected"><Check size={18}/><a href={'https://x.com/'+status.username} target="_blank" rel="noreferrer">@{status.username}<ArrowUpRight size={15}/></a></div>}
 <div className="subtle-note"><LockKeyhole size={17}/><p>{t('你将在 X 上登录并批准权限。SHEN 不会要求你的密码或双重验证密钥。授权仅绑定此代币，重新连接需使用同一账号。','You sign in and approve access on X. SHEN never asks for your password or 2FA secret. This connection belongs to this coin; reconnect using the same account.')}</p></div>
 {status?.reconnectRequired&&<p className="body-copy">{t('请重新授权此账号以继续发布。','Reconnect this account to restore publishing access.')}</p>}
 {status?.configured?<button className="button primary" style={{marginTop:20}} type="button" disabled={busy} onClick={()=>void connect()}>{busy?<LoaderCircle size={16} className="spin"/>:<span>𝕏</span>}{busy?t('正在前往 X…','Opening X…'):status.username?t('重新连接 X','Reconnect X'):t('连接 X','Connect X')}</button>:status&&<p className="body-copy">{t('X 接入服务尚未配置。','X account connection is not configured yet.')}</p>}
 <p className="body-copy">{t('连接即授权发行后自主发布。你可以在 X 的设置中撤销授权；这只会停止 X 访问，不会暂停智能体。','Connecting authorizes autonomous posts after launch. You can revoke access in X settings; this stops X access without pausing the agent.')}</p>
 {error&&<p className="form-error" role="status">{error}</p>}</section>
}
