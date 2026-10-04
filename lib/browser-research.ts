import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { db } from './server';
const capture=z.object({url:z.string().url().max(2048),title:z.string().max(300),text:z.string().max(8000),frames:z.array(z.object({scrollY:z.number().int().nonnegative(),base64:z.string().min(4).max(700000).regex(/^[A-Za-z0-9+/]+={0,2}$/)})).min(1).max(3)});
export type BrowserSession={id:string;url:string;title:string;status:string;startedAt:number;finishedAt:number|null;frames:{id:string;scrollY:number;imageUrl:string}[]};
export type BrowserStatus='ready'|'not_configured'|'unavailable';
export async function browserStatus():Promise<BrowserStatus>{
  if(!env.BROWSER_URL||!env.BROWSER_TOKEN||env.BROWSER_TOKEN.length<40)return 'not_configured';
  try{return (await fetch(new URL('/healthz',env.BROWSER_URL),{signal:AbortSignal.timeout(2000)})).ok?'ready':'unavailable';}catch{return 'unavailable';}
}
export async function browserReady(){return await browserStatus()==='ready';}
export async function browseResearch(coinId:string,id:string,url:string){
  if(!env.BROWSER_URL||!env.BROWSER_TOKEN)throw Error('Browser unavailable');
  await db().prepare("INSERT INTO browser_sessions(id,coin_id,url,status,started_at) VALUES(?,?,?,'browsing',?)").bind(id,coinId,url,Date.now()).run();
  try{
    const response=await fetch(new URL('/capture',env.BROWSER_URL),{method:'POST',headers:{Authorization:'Bearer '+env.BROWSER_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({url}),signal:AbortSignal.timeout(35000)});
    if(!response.ok)throw Error('Capture failed');
    const result=capture.parse(await response.json());
    if(!/^https?:\/\//.test(result.url))throw Error('Invalid page URL');
    await db().batch([
      ...result.frames.map((frame,i)=>db().prepare('INSERT INTO browser_frames(id,session_id,coin_id,position,scroll_y,base64) VALUES(?,?,?,?,?,?)').bind(id+':'+i,id,coinId,i,frame.scrollY,frame.base64)),
      db().prepare("UPDATE browser_sessions SET url=?,title=?,excerpt=?,status='complete',finished_at=? WHERE id=? AND coin_id=?").bind(result.url,result.title,result.text,Date.now(),id,coinId),
    ]);
    // Keep storage bounded per coin. Historical search links remain available.
    await db().prepare('DELETE FROM browser_frames WHERE coin_id=? AND session_id NOT IN (SELECT id FROM browser_sessions WHERE coin_id=? ORDER BY started_at DESC,id DESC LIMIT 10)').bind(coinId,coinId).run();
    return {id,url:result.url,title:result.title,text:result.text.slice(0,4000),status:'complete'};
  }catch{
    await db().prepare("UPDATE browser_sessions SET status='unavailable',finished_at=? WHERE id=? AND coin_id=?").bind(Date.now(),id,coinId).run();
    return {id,url,title:'',text:'Page unavailable. Continue from other sources; do not claim to have read it.',status:'unavailable'};
  }
}
export async function browserHistory(coinId:string):Promise<BrowserSession[]>{
  const sessions=await db().prepare('SELECT id,url,title,status,started_at,finished_at FROM browser_sessions WHERE coin_id=? ORDER BY started_at DESC,id DESC LIMIT 10').bind(coinId).all<{id:string;url:string;title:string;status:string;started_at:number;finished_at:number|null}>();
  const frames=await db().prepare('SELECT id,session_id,scroll_y FROM browser_frames WHERE coin_id=? ORDER BY position').bind(coinId).all<{id:string;session_id:string;scroll_y:number}>();
  return sessions.results.map(s=>({id:s.id,url:s.url,title:s.title,status:s.status==='browsing'&&Date.now()-s.started_at>60000?'interrupted':s.status,startedAt:s.started_at,finishedAt:s.finished_at,frames:frames.results.filter(f=>f.session_id===s.id).map(f=>({id:f.id,scrollY:f.scroll_y,imageUrl:`/api/coins/${encodeURIComponent(coinId)}/research/browser/${encodeURIComponent(f.id)}`}))}));
}
