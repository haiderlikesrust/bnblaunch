import { env } from "cloudflare:workers";
import { db, response } from "@/lib/server";
export async function GET(){try{await db().prepare('SELECT 1 AS ready').first();return response({ok:true,service:'shen',database:env.SHEN_RUNTIME==='node'?'postgres':'d1'})}catch{return response({ok:false,service:'shen'},503)}}
