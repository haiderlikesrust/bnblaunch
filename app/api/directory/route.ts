import { db, failure, response } from "@/lib/server";
import { publicCoin } from "@/lib/public-coin";
import type { Coin } from "@/lib/model";
export async function GET(){try{const [coins,events]=await Promise.all([
 db().prepare("SELECT config FROM coins WHERE token_address IS NOT NULL ORDER BY created_at DESC LIMIT 100").all<{config:string}>(),
 db().prepare("SELECT e.id,e.coin_id AS coinId,e.name,e.message,e.created_at AS createdAt FROM events e JOIN coins c ON c.id=e.coin_id WHERE c.token_address IS NOT NULL ORDER BY e.created_at DESC LIMIT 20").all(),
]);return response({coins:coins.results.map(r=>publicCoin(JSON.parse(r.config) as Coin)),events:events.results})}catch(e){return failure(e)}}
