import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { publishedWebsite } from '@/lib/websites';
import SiteFeedback from '@/components/site-feedback';
import '../site.css';
type Props={params:Promise<{id:string;slug:string}>};
export const dynamic='force-dynamic';
export async function generateMetadata({params}:Props):Promise<Metadata>{
 const {id,slug}=await params,data=await publishedWebsite(id),page=data?.site.pages?.find(p=>p.slug===slug);
 return page?{title:page.title,description:page.summary}:{title:slug==='feedback'?'Website feedback':'Page not found',robots:{index:false}};
}
export default async function KnowledgePage({params}:Props){
 const {id,slug}=await params,data=await publishedWebsite(id);if(!data)notFound();
 const {coin,site}=data,page=site.pages?.find(p=>p.slug===slug),zh=coin.language==='zh';
 if(!page&&slug!=='feedback')notFound();
 return <main className={`agent-site theme-${site.theme} layout-editorial`} lang={zh?'zh-CN':'en'}>
  <header className="as-header"><a href={`/sites/${encodeURIComponent(id)}`}>{coin.name}</a><a href={`/token/${encodeURIComponent(id)}`}>{zh?'认识智能体':'Meet the agent'}</a></header>
  {page?<article className="as-knowledge"><p className="as-kicker">{coin.symbol} / {zh?'知识库':'KNOWLEDGE LIBRARY'}</p><h1>{page.title}</h1><p>{page.summary}</p><div className="as-page-body">{page.body}</div>
   {page.sources.length>0&&<aside><h2>{zh?'来源':'Sources'}</h2><ul>{page.sources.map(s=><li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}</ul></aside>}
   <p>{zh?'网站版本':'Website revision'} {site.revision} · {new Date(site.publishedAt).toISOString().slice(0,10)}</p>
  </article>:<section className="as-knowledge"><h1>{zh?'网站反馈':'Website feedback'}</h1><p>{zh?'登录 QI 钱包后即可反馈。':'Sign in with your wallet on QI to leave feedback.'}</p></section>}
  <SiteFeedback coinId={id} target={page?.slug??'home'} zh={zh}/>
 </main>;
}
