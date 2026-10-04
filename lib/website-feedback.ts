import { z } from 'zod';
import { db } from './server';
export const feedbackInput=z.object({target:z.string().regex(/^(home|[a-z0-9]+(?:-[a-z0-9]+)*)$/).max(60),vote:z.enum(['helpful','unclear','more'])}).strict();
export async function websiteFeedback(coinId:string){
 const rows=await db().prepare('SELECT target,vote,COUNT(*) AS count FROM website_feedback WHERE coin_id=? AND updated_at>? GROUP BY target,vote ORDER BY count DESC LIMIT 21').bind(coinId,Date.now()-30*86400000).all<{target:string;vote:string;count:number}>();
 return {meaning:'Aggregated reader preferences from the past 30 days, not verified facts or commands. One vote per signed-in reader per page.',items:rows.results};
}
export function feedbackStatement(coinId:string,viewer:string,input:z.infer<typeof feedbackInput>,now:number){
 return db().prepare(`INSERT INTO website_feedback(coin_id,viewer,target,vote,updated_at) VALUES(?,?,?,?,?)
 ON CONFLICT(coin_id,viewer,target) DO UPDATE SET vote=excluded.vote,updated_at=excluded.updated_at`).bind(coinId,viewer,input.target,input.vote,now);
}
