import { db, AppError, failure, response } from "@/lib/server";
import { marketData } from "@/lib/market";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){try{const row=await db().prepare("SELECT token_address FROM coins WHERE id=? AND token_address IS NOT NULL").bind((await params).id).first<{token_address:string}>();if(!row)throw new AppError(404,"Launched token not found");return response(await marketData(row.token_address))}catch(e){return failure(e)}}
