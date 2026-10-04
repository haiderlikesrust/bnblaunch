import { env } from "cloudflare:workers";
import { type Coin } from "@/lib/model";
import { agentModel, GUARDRAIL_MODEL } from "@/lib/agent-models";
import { chatInput, CHAT_REFUSAL, guardedAnswer, obviousInstruction } from "@/lib/chat-policy";
import { chatSnapshot } from "@/lib/public-coin";
import { chatCompletion, chatPrice, callCeiling, PaidCompletionRejected } from "@/lib/chat-completion";
import { reserveChat, settleChat } from "@/lib/chat-meter";
import { availability } from "@/lib/chat-availability";
import { getUser } from "@/lib/auth";
import { AppError, db, failure, identity, response, type CoinRow } from "@/lib/server";

async function input(request:Request){
 const reader=request.body?.getReader();if(!reader)throw new AppError(400,"Question required.");
 const parts:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8000){await reader.cancel();throw new AppError(413,"Question too long.")}parts.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length}
 try{return chatInput.parse(JSON.parse(new TextDecoder().decode(bytes)))}catch{throw new AppError(400,"Send only a question of 3–1,200 characters.")}
}
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 try{const {id}=await params;
 const user=await getUser();const row=await db().prepare("SELECT * FROM coins WHERE id=? AND (token_address IS NOT NULL OR owner=?)").bind(id,user?.userId??"").first<CoinRow>();if(!row)throw new AppError(404,"Coin not found.");return response({window:await availability(JSON.parse(row.config) as Coin,row)})}catch(e){return failure(e)}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  // identity validates the configured public origin, including behind a proxy.
  const viewer=await identity(request);
  const {message}=await input(request),{id}=await params;
  const row=await db().prepare("SELECT * FROM coins WHERE id=? AND (token_address IS NOT NULL OR owner=?)").bind(id,viewer).first<CoinRow>();
  if(!row)throw new AppError(404,"Coin not found.");
  const coin=JSON.parse(row.config) as Coin;
  if(obviousInstruction(message))return response({answer:CHAT_REFUSAL[coin.language],blocked:true});
  if(!coin.tokenAddress||coin.state==="paused"||coin.balance<coin.threshold)throw new AppError(412,"The agent is not funded and available yet. Chat opens after launch and activation funding.");
  if(!env.OPENROUTER_API_KEY||row.ai_credit_microusd<=0)throw new AppError(412,"Live chat awaits AI service setup and confirmed funding.");
  const window=await availability(coin,row);
  if(!window.open||!window.closesAt)return response({error:"Chat is currently closed to conserve service funds. The next session depends on available funding.",window},423);
  const [guard,answer]=await Promise.all([chatPrice(GUARDRAIL_MODEL),chatPrice(agentModel(coin.modelId).id)]);
  const reservation=await reserveChat(coin.id,viewer,callCeiling(guard)*2+callCeiling(answer),window.closesAt);
  let cost=0,unresolvedProviderCall=false;
  // No agent executor, action adapters, transcripts, tools or caller-provided roles enter this path.
  // Unknown provider costs retain the reservation. Verified rejected output is
  // charged and never reaches an answer or any autonomous action.
  const ensureOpen=async()=>{const fresh=await db().prepare("SELECT * FROM coins WHERE id=?").bind(coin.id).first<CoinRow>();if(!fresh)throw new AppError(423,"Chat is closed.");const state=await availability(JSON.parse(fresh.config) as Coin,{...fresh,ai_credit_microusd:fresh.ai_credit_microusd+reservation.ceiling-cost});if(!state.open||Date.now()>=window.closesAt!)throw new AppError(423,"The chat session has ended. No agent action was taken.")};
  let result;
  try{result=await guardedAnswer(message,chatSnapshot(coin),coin.language,async(kind,system,data)=>{
   await ensureOpen();unresolvedProviderCall=true;
   try{const completion=await chatCompletion(kind==="answer"?answer:guard,system,data,800,32000,{coinId:coin.id,runId:reservation.id,kind});unresolvedProviderCall=false;cost+=completion.cost;return completion.text;}
   catch(e){if(e instanceof PaidCompletionRejected){unresolvedProviderCall=false;cost+=e.cost;}else if(e instanceof AppError&&(e.status===413||e.status===412))unresolvedProviderCall=false;throw e;}
  });await ensureOpen()}catch(e){if(!unresolvedProviderCall)await settleChat(reservation,cost);throw e}
  await settleChat(reservation,cost);
  return response({...result,model:agentModel(coin.modelId).name});
 }catch(e){return failure(e)}
}
