// Product guidance, not a withdrawal limit or a forced first-run action.
// Fees use the verified processor dispatch counter; deposits/pending fees and
// market capitalization never count. USD is a current-price estimate.
export function websiteTiming(lifetimeFeesWei:string|undefined,bnbPriceAnswer:bigint|undefined){
 const base={targetCollectedFeesUsd:[500,600],valuation:'Distributed BNB fees valued at the current verified BNB/USD quote; not historical dollar receipts.',automaticOnActivation:false};
 if(!lifetimeFeesWei||!/^\d{1,78}$/.test(lifetimeFeesWei)||!bnbPriceAnswer||bnbPriceAnswer<=0n)return {...base,estimatedCollectedFeesUsd:null,priority:'unknown'};
 const cents=BigInt(lifetimeFeesWei)*bnbPriceAnswer/1000000000000000000000000n;
 if(cents>BigInt(Number.MAX_SAFE_INTEGER))return {...base,estimatedCollectedFeesUsd:null,priority:'unknown'};
 const estimate=Number(cents)/100;
 return {...base,estimatedCollectedFeesUsd:estimate,priority:estimate>=600?'overdue':estimate>=500?'ready':'growing'};
}
