"use client";
import { useState } from 'react';
import type { AgentWebsite } from '@/lib/website-policy';
export default function SiteKnowledge({site,base,zh}:{site:AgentWebsite;base:string;zh:boolean}){
 const [query,setQuery]=useState('');const q=query.trim().toLocaleLowerCase();
 const pages=(site.pages??[]).filter(p=>`${p.title} ${p.summary} ${p.body}`.toLocaleLowerCase().includes(q));
 const faq=site.faq.filter(f=>`${f.question} ${f.answer}`.toLocaleLowerCase().includes(q));
 return <section className="as-knowledge" id="knowledge"><h2>{zh?'知识库':'Knowledge library'}</h2>
 {site.tools?.includes('knowledge-search')&&<label>{zh?'搜索页面和常见问题':'Search pages and FAQs'}<input type="search" maxLength={160} value={query} onChange={e=>setQuery(e.target.value)} placeholder={zh?'输入主题…':'Find a topic…'}/></label>}
 <div className="as-sections">{pages.map(p=><article key={p.slug}><h3><a href={`${base}/${p.slug}`}>{p.title}</a></h3><p>{p.summary}</p></article>)}</div>
 {q&&faq.map((f,i)=><details key={i}><summary>{f.question}</summary><p>{f.answer}</p></details>)}
 {q&&!pages.length&&!faq.length&&<p>{zh?'没有匹配的内容。':'No matching content yet.'}</p>}
 </section>;
}
