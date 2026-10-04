import { db } from './server';
import { personaInput, type AgentPersona } from './persona-policy';
import type { Coin } from './model';

export async function sharedPersona(coin:Coin){
 const [row,posts,episodes]=await Promise.all([
  db().prepare('SELECT content FROM agent_personas WHERE coin_id=?').bind(coin.id).first<{content:string}>(),
  db().prepare("SELECT json_extract(payload,'$.text') AS text,updated_at AS at FROM content_jobs WHERE coin_id=? AND status='complete' ORDER BY updated_at DESC LIMIT 3").bind(coin.id).all<{text:string;at:number}>(),
  db().prepare("SELECT caption AS text,updated_at AS at FROM influencer_posts WHERE coin_id=? AND status='complete' ORDER BY updated_at DESC LIMIT 3").bind(coin.id).all<{text:string;at:number}>(),
 ]);
 return {anchor:{voice:coin.personality??'',focus:coin.focus??''},profile:row?personaInput.parse(JSON.parse(row.content)):null,
  recentPublished:[...posts.results,...episodes.results].filter(p=>typeof p.text==='string'&&p.text.trim()).sort((a,b)=>Number(b.at)-Number(a.at)).slice(0,4).map(p=>({text:p.text.slice(0,400),at:p.at})),
  meaning:'Public creative continuity only. Fictional stories are not real events; published claims are not independent evidence.'};
}
export function personaStatement(lease:{coinId:string;id:string},runId:string,persona:AgentPersona,now:number){
 return db().prepare(`INSERT INTO agent_personas(coin_id,content,run_id,updated_at) SELECT ?,?,?,?
 WHERE EXISTS(SELECT 1 FROM runtime_leases l JOIN coins c ON c.id=l.coin_id WHERE l.coin_id=? AND l.lease_id=? AND l.lease_until>? AND json_extract(c.config,'$.lastPlanRunId')=?)
 ON CONFLICT(coin_id) DO UPDATE SET content=excluded.content,run_id=excluded.run_id,updated_at=excluded.updated_at`)
 .bind(lease.coinId,JSON.stringify(personaInput.parse(persona)),runId,now,lease.coinId,lease.id,now,runId);
}
