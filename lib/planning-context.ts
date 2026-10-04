// Preserve the mission, balances and cost/market signals. Optional historical
// prose is trimmed by actual UTF-8 size, not character count (important for 中文).
export function contextBytes(system:string,data:unknown){return new TextEncoder().encode(JSON.stringify([{role:'system',content:system},{role:'user',content:JSON.stringify(data)}])).length;}
export function boundedPlanningContext<T extends {sources:unknown[];browserResults?:{text:string}[];researchResults?:{sources:unknown[]}[];recentResearch?:unknown[];memory?:{entries:unknown[]};community:{recent:unknown[]};website:unknown;spending:{market:{lastCandles:unknown[]}}}>(system:string,snapshot:T):T&{contextTruncated:boolean}{
 const result={...structuredClone(snapshot),contextTruncated:false};
 const fits=()=>contextBytes(system,result)<=31000;
 if(fits())return result;
 result.contextTruncated=true;
 for(const page of result.browserResults??[])if(!fits())page.text=page.text.slice(0,1200);
 while(!fits()&&result.recentResearch&&result.recentResearch.length>1)result.recentResearch.pop();
 for(const research of result.researchResults??[])while(!fits()&&research.sources.length>1)research.sources.pop();
 while(!fits()&&result.community.recent.length)result.community.recent.pop();
 while(!fits()&&result.sources.length>1)result.sources.pop();
 while(!fits()&&result.spending.market.lastCandles.length>2)result.spending.market.lastCandles.shift();
 while(!fits()&&result.memory&&result.memory.entries.length>1)result.memory.entries.pop();
 if(!fits())result.website=null;
 if(!fits())result.sources=[];
 if(!fits())throw Error('Essential planning context exceeds its input bound');
 return result;
}
