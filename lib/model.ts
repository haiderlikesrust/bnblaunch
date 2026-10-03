import { PLATFORM_POLICY } from "./platform-policy";
import { DEFAULT_AGENT_MODEL, DEFAULT_AGENT_PURPOSE, type AgentModelId } from "./agent-models";
export type Language = "zh" | "en";
export type Coin = { id:string; name:string; symbol:string; description:string; language:Language; purpose?:string; imageUrl?:string; modelId?:AgentModelId; threshold:number; dailyBudget:number; reserve:number; taxRate:number; holders:number; burn:number; treasury:number; liquidity:number; balance:number; treasuryObservedAt?:number; state:"dormant"|"active"|"paused"|"draft"; social:boolean; research:boolean; website:boolean; images:boolean; buyback:boolean; owner?:string; tokenAddress?:string; treasuryAddress?:string;  color?:string; site?:{title:string; tagline:string; about:string}; };
export const blankCoin:Omit<Coin,"id">={name:"",symbol:"",description:"",language:"en",purpose:"",modelId:DEFAULT_AGENT_MODEL,balance:0,state:"draft",social:true,research:true,website:true,images:true,...PLATFORM_POLICY};
export function domainIdeas(name:string,symbol:string){const base=symbol.toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,25)||"shen";return [base+".fun",base+".ai","get"+base+".xyz"];}
