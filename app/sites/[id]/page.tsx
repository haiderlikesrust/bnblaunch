import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowDown, ArrowUpRight, ExternalLink } from 'lucide-react';
import { publishedWebsite } from '@/lib/websites';
import { db } from '@/lib/server';
import {env} from 'cloudflare:workers';
import './site.css';
import SiteKnowledge from '@/components/site-knowledge';

export const dynamic='force-dynamic';
type Props={params:Promise<{id:string}>};
export async function generateMetadata({params}:Props):Promise<Metadata>{
 const data=await publishedWebsite((await params).id);
 return data?{title:`${data.site.title} · $${data.coin.symbol}`,description:data.site.tagline}:{title:'Website not found',robots:{index:false,follow:false}};
}
export default async function HostedSite({params}:Props){
 const id=(await params).id,data=await publishedWebsite(id);if(!data)notFound();
 const {coin,site}=data,zh=coin.language==='zh',t=(cn:string,en:string)=>zh?cn:en;
 const [account,artwork,events]=await Promise.all([
  db().prepare('SELECT username FROM x_accounts WHERE coin_id=?').bind(id).first<{username:string}>(),
  db().prepare("SELECT a.id,a.alt_text FROM content_assets a JOIN content_jobs j ON j.id=a.id WHERE a.coin_id=? AND j.status='complete' ORDER BY a.created_at DESC LIMIT 3").bind(id).all<{id:string;alt_text:string}>(),
  db().prepare('SELECT id,message,created_at FROM events WHERE coin_id=? ORDER BY created_at DESC LIMIT 3').bind(id).all<{id:string;message:string;created_at:string}>(),
 ]);
 const origin=new URL(env.APP_ORIGIN??'https://shen.now').origin,tokenUrl=origin+'/token/'+encodeURIComponent(id),address=coin.tokenAddress!,imageUrl=coin.imageUrl?origin+'/api/coins/'+encodeURIComponent(id)+'/image':null;
 return <main data-shen-site={id} lang={zh?'zh-CN':'en'} className={`agent-site theme-${site.theme} layout-${site.layout}`}>
  <header className="as-header"><a href="#" className="as-identity">{imageUrl?<img src={imageUrl} alt=""/>:<span className="as-monogram">{coin.symbol.slice(0,2)}</span>}<strong>{coin.name}</strong><span>${coin.symbol}</span></a><nav aria-label={t('网站导航','Website navigation')}><a href="#about">{t('关于','About')}</a>{site.faq.length>0&&<a href="#questions">{t('常见问题','FAQ')}</a>}<a href={tokenUrl}>{t('认识智能体','Meet the agent')}<ArrowUpRight size={15}/></a></nav></header>
  <section className="as-hero"><div className="as-hero-copy"><p className="as-kicker"><span/> {t('链上身份 · 自主智能','ON-CHAIN IDENTITY / AUTONOMOUS MIND')}</p><h1>{site.title}</h1><p className="as-tagline">{site.tagline}</p><div className="as-actions"><a className="as-button" href={tokenUrl}>{t('探索代币与智能体','Explore token & agent')}<ArrowUpRight size={19}/></a><a href="#about" className="as-read">{t('了解项目','Get to know us')}<ArrowDown size={16}/></a></div></div><div className="as-emblem" aria-hidden="true"><div className="as-orbit one"/><div className="as-orbit two"/><div className="as-orbit three"/><div className="as-core">{imageUrl?<img src={imageUrl} alt=""/>:<span>{coin.symbol.slice(0,2)}</span>}</div><span className="as-emblem-label">{coin.symbol} / BNB CHAIN</span></div></section>
  <div className="as-strip"><span>BNB CHAIN</span><span>{t('智能体独立运行','AGENT OPERATED')}</span><span>{t('公开活动记录','PUBLIC ACTIVITY')}</span><a href={'https://bscscan.com/token/'+address} target="_blank" rel="noreferrer">{address.slice(0,8)}…{address.slice(-6)}<ExternalLink size={13}/></a></div>
  <section className="as-about" id="about"><div><span className="as-kicker">01 / {t('我们的故事','OUR STORY')}</span><h2>{t('从一个想法，开始。','Every idea starts somewhere.')}</h2></div><p>{site.about}</p></section>
  {site.sections.length>0&&<section className="as-sections">{site.sections.map((section,i)=><article key={i}><span className="as-kicker">{String(i+1).padStart(2,'0')} / {coin.symbol}</span><h2>{section.heading}</h2><p>{section.body}</p></article>)}</section>}
  {((site.pages?.length??0)>0||site.tools?.includes("knowledge-search"))&&<SiteKnowledge site={site} base={`${origin}/sites/${encodeURIComponent(id)}`} zh={zh}/>}
  <section className="as-feedback"><h3>{t("帮助改进网站","Help improve this website")}</h3><p>{t("在 QI 上提供反馈，帮助智能体了解哪些内容需要改进。","Tell the agent which content needs more clarity or detail.")}</p><a href={`${origin}/sites/${encodeURIComponent(id)}/feedback`}>{t("提供反馈","Give feedback")}</a></section>
  {artwork.results.length>0&&<section className="as-gallery"><div className="as-section-heading"><span className="as-kicker">{t('原创视觉','VISUAL JOURNAL')}</span><h2>{t('智能体的创作。','A visual point of view.')}</h2></div><div>{artwork.results.map(a=><figure key={a.id}><img src={`${origin}/api/coins/${encodeURIComponent(id)}/publications/${encodeURIComponent(a.id)}/image`} alt={a.alt_text} loading="lazy"/><figcaption>{a.alt_text}</figcaption></figure>)}</div></section>}
  {events.results.length>0&&<section className="as-activity"><div><span className="as-kicker">{t('公开记录','OPEN RECORD')}</span><h2>{t('每一步，都有迹可循。','Follow what happens next.')}</h2><a className="as-read" href={tokenUrl}>{t('查看智能体活动','View agent activity')}<ArrowUpRight size={16}/></a></div><ol>{events.results.map(event=><li key={event.id}><time dateTime={event.created_at}>{new Date(event.created_at).toISOString().slice(0,10)}</time><p>{event.message}</p></li>)}</ol></section>}
  {site.faq.length>0&&<section className="as-faq" id="questions"><div><span className="as-kicker">{t('常见问题','A LITTLE MORE CONTEXT')}</span><h2>{t('值得了解。','Good to know.')}</h2></div><div>{site.faq.map((item,i)=><details key={i}><summary>{item.question}<span>+</span></summary><p>{item.answer}</p></details>)}</div></section>}
  <section className="as-closing"><span className="as-kicker">${coin.symbol} / {coin.name}</span><h2>{t('认识背后的智能体。','Meet the mind behind it.')}</h2><div className="as-actions"><a className="as-button" href={tokenUrl}>{t('打开智能体页面','Open agent page')}<ArrowUpRight size={18}/></a>{account&&/^[A-Za-z0-9_]{1,15}$/.test(account.username)&&<a className="as-read" href={'https://x.com/'+account.username} target="_blank" rel="noreferrer">X / @{account.username}<ArrowUpRight size={16}/></a>}</div></section>
  <footer className="as-footer"><a href={origin} className="as-powered">{t('由','BUILT WITH')} <strong>QI <span>启</span></strong></a><p>{t('由智能体创建并维护','Created and maintained by the agent')}<br/>{t('更新于','Updated')} <time dateTime={new Date(site.publishedAt).toISOString()}>{new Date(site.publishedAt).toISOString().slice(0,10)}</time> · V{site.revision}</p></footer>
 </main>;
}
