"use client";
import { useEffect, useState } from 'react';
import type { T } from '@/lib/ui';
type Source={path:string;content:string};
type Step={exitCode:number;timedOut:boolean;output:string};
type Job={id:string;status:string;proposal:{goal:string;language:string;files:Source[];entrypoint:string;testFile:string};result:{execution?:Step;tests?:Step|null;error?:string}|null;costMicrousd:number;createdAt:number};
export default function AgentWorkshop({coinId,t}:{coinId:string;t:T}){
 const [data,setData]=useState<{available:boolean;model:string;jobs:Job[]}|null>(null),[error,setError]=useState(false),[jobId,setJobId]=useState(''),[path,setPath]=useState('');
 useEffect(()=>{let alive=true;const refresh=async()=>{try{const r=await fetch(`/api/coins/${encodeURIComponent(coinId)}/workshop`);if(!r.ok)throw Error();const d=await r.json() as {available:boolean;model:string;jobs:Job[]};if(alive){setData(d);setError(false)}}catch{if(alive)setError(true)}};void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>{alive=false;clearInterval(timer)}},[coinId]);
 const job=data?.jobs.find(j=>j.id===jobId)??data?.jobs[0],file=job?.proposal.files.find(f=>f.path===path)??job?.proposal.files[0];
 const active=job&&['queued','running'].includes(job.status);
 function download(source:Source){const url=URL.createObjectURL(new Blob([source.content],{type:'text/plain'})),a=document.createElement('a');a.href=url;a.download=source.path.split('/').at(-1)!;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 return <section className="panel code-editor"><div className="panel-heading"><div><span className="overline">AGENT WORKSPACE</span><h2>{t('代码编辑器','Code editor')}</h2></div><span className="overline">READ ONLY · REFRESHES EVERY 5S</span></div>
 <p className="body-copy">{t('查看它正在编写的程序、测试和运行结果。','Follow its source files, tests and execution results.')} {data?.model&&<strong>{data.model}</strong>}</p>
 {error&&<p role="status">{t('无法刷新，请稍后重试。','Could not refresh. Retrying shortly.')}</p>}
 {!data&&!error&&<p>{t('正在加载…','Loading…')}</p>}
 {data&&!data.available&&<p className="code-notice">{t('独立代码运行服务尚未就绪，其他工作继续。','The isolated coding service is not ready. Other work continues.')}</p>}
 {!job&&data&&<div className="empty-state"><h3>{t('等待第一个编程任务','Waiting for its first coding task')}</h3><p>{t('智能体会在编程有助于使命时创建任务。','The agent chooses a coding task when it helps its mission.')}</p></div>}
 {job&&<><header className="code-job-heading"><div><h3>{job.proposal.goal}</h3><p>{job.proposal.language} · {active?t('进行中','In progress'):job.status==='complete'?t('运行和测试通过','Program and tests passed'):t('需要修复','Needs a fix')} · ${(job.costMicrousd/1e6).toFixed(4)} {active?t('已预留','reserved'):t('已结算','settled')}</p></div>
 <label>{t('任务记录','Run history')}<select value={job.id} onChange={e=>{setJobId(e.target.value);setPath('')}}>{data?.jobs.map(j=><option key={j.id} value={j.id}>{new Date(j.createdAt).toISOString().slice(0,19).replace('T',' ')} UTC · {j.proposal.goal.slice(0,40)}</option>)}</select></label></header>
 <div className="code-layout"><nav aria-label={t('源文件','Source files')}><span className="overline">FILES</span>{job.proposal.files.map(f=><button key={f.path} aria-pressed={f.path===file?.path} onClick={()=>setPath(f.path)}>{f.path}<small>{f.path===job.proposal.testFile?'TEST':f.path===job.proposal.entrypoint?'ENTRY':''}</small></button>)}</nav>
 <div className="code-source"><header><span>{file?.path}</span>{file&&<button onClick={()=>download(file)}>{t('下载','Download')}</button>}</header><pre tabIndex={0} aria-label={t('只读源代码','Read-only source code')}>{file?.content}</pre></div></div>
 <section className="code-output"><h3>{t('终端与测试输出','Terminal and test output')}</h3>{!job.result&&<p role="status">{t('正在等待执行结果。文件是最近一次已保存的提案，不是实时按键记录。','Waiting for execution results. Files show the latest saved proposal, not a live keystroke stream.')}</p>}{job.result?.error&&<pre>{job.result.error}</pre>}
 {(['execution','tests'] as const).map(key=>job.result?.[key]&&<div key={key}><span className="overline">{key==='tests'?'TESTS':'PROGRAM'} · EXIT {job.result[key]!.exitCode}{job.result[key]!.timedOut?' · TIME LIMIT':''}</span><pre>{job.result[key]!.output||t('无输出','No output')}</pre></div>)}</section></>}
 </section>;
}
