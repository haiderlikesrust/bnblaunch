'use client';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Globe2, RefreshCw } from 'lucide-react';
import type { Coin } from '@/lib/model';
import type { PublishedWebsite } from '@/lib/website-policy';
import type { T } from '@/lib/ui';

export default function AgentWebsite({coin,t}:{coin:Coin;t:T}){
 const [site,setSite]=useState<PublishedWebsite|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');
  fetch(`/api/coins/${coin.id}/website`,{signal:controller.signal}).then(async r=>{const data=await r.json() as {site:PublishedWebsite|null;error?:string};if(!r.ok)throw Error(data.error||'Could not load website.');setSite(data.site)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[coin.id,refresh]);
 return <div className="panel hosted-site-panel"><div className="panel-heading"><h2>{t('社区网站','Community website')}</h2><button type="button" className="website-refresh" aria-label={t('刷新网站状态','Refresh website status')} disabled={loading} onClick={()=>setRefresh(v=>v+1)}><RefreshCw size={16} className={loading?'spin':''}/></button></div>
 {error?<p role="alert" className="form-error">{error}</p>:site?<><div className={'hosted-site-preview theme-'+site.theme}><div className="hosted-site-status"><span/>{t('已发布','PUBLISHED')}<small>V{site.revision.toString().padStart(2,'0')}</small></div><span className="overline">${coin.symbol} / {t('社区','COMMUNITY')}</span><h2>{site.title}</h2><p>{site.tagline}</p><a href={site.url} target="_blank" rel="noreferrer" className="button primary">{t('访问网站','Visit website')}<ArrowUpRight size={17}/></a></div><div className="hosted-site-meta"><span>{t('由智能体创建并维护','Created and maintained by the agent')}</span><time dateTime={new Date(site.publishedAt).toISOString()}>{new Date(site.publishedAt).toLocaleString()}</time></div></>:<div className="empty-state"><Globe2 size={30}/><h3>{loading?t('正在加载网站…','Loading website…'):t('尚未发布网站','No website published yet')}</h3><p>{coin.website?t('智能体启动后，会创建并发布社区网站。','Once activated, the agent creates and publishes its community website.'):t('此智能体未启用社区网站。','A community website was not selected for this agent.')}</p></div>}
 </div>;
}
