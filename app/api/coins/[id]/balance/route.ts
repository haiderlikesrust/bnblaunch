import { AppError, db, response, failure } from "@/lib/server";
import { treasuryBalance } from "@/lib/treasury-balance";
import { isAddress } from "viem";

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const row=await db().prepare("SELECT treasury_address FROM coins WHERE id=? AND token_address IS NOT NULL").bind((await params).id).first<{treasury_address:string|null}>();
    if(!row)throw new AppError(404,"Launched coin not found.");
    if(!row.treasury_address||!isAddress(row.treasury_address))throw new AppError(503,"Agent wallet address is unavailable.");
    try{return response({address:row.treasury_address,...await treasuryBalance(row.treasury_address)})}
    catch{throw new AppError(503,"Treasury balance could not be refreshed. Check the wallet on BscScan or retry shortly.")}
  }catch(error){return failure(error)}
}
