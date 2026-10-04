// Preserve the mission, balances and cost/market signals. Optional historical
// prose is trimmed by actual UTF-8 size, not character count (important for 中文).
export function contextBytes(system:string,data:unknown){return new TextEncoder().encode(JSON.stringify([{role:'system',content:system},{role:'user',content:JSON.stringify(data)}])).length;}
// Shorten prose only: identifiers, source URLs and financial bounds stay exact.
const prose=new Set(['mission','story','voice','focus','summary','nextSteps','goal','nextStep','message','reviewReason','reason','description','text','title','name','brief','output','content','premise','nextBeat']);
function shorten(value:unknown,limit:number):void{
 if(Array.isArray(value)){for(let i=0;i<value.length;i++){shorten(value[i],limit);}return;}
 if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){if(prose.has(key)&&typeof item==='string'&&item.length>limit)(value as Record<string,unknown>)[key]=item.slice(0,limit)+'…';else shorten(item,limit);}
}
function longestList(value:unknown,best:unknown[]|null=null):unknown[]|null{
 if(Array.isArray(value)){if(value.length>1&&(!best||value.length>best.length))best=value;for(const item of value)best=longestList(item,best);return best;}
 if(value&&typeof value==='object')for(const item of Object.values(value))best=longestList(item,best);
 return best;
}
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
 // Growing history (tasks, memories, operations, signals, long missions) must
 // never stop planning permanently, so shorten prose and lists until it fits.
 for(const limit of [1500,800,400,200,100]){if(fits())break;shorten(result,limit);}
 for(let i=0;i<200&&!fits();i++){const list=longestList(result);if(!list)break;list.pop();}
 if(!fits())throw Error('Essential planning context exceeds its input bound');
 return result;
}
