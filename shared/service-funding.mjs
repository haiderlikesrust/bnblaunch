// Operator-confirmed reusable SolCard BNB Chain address and deposit limits.
// This does not authorize payments to addresses supplied by agent prompts.
export const SOLCARD_BNB_ADDRESS='0x4ed72eb56621de657d62007bc7a798d314d9765b';
export function serviceFundingBounds(address){
 return address?.toLowerCase()===SOLCARD_BNB_ADDRESS
  ?{minimumWei:10000000000000000n,maximumWei:65770000000000000000n}
  :{minimumWei:1n,maximumWei:2n**256n-1n};
}
export function serviceFundingAmount({targetMicrousd,price,availableWei,capacityMicrousd,address}){
 const bounds=serviceFundingBounds(address),requested=(BigInt(targetMicrousd)*100000000000000000000n+price-1n)/price;
 const amount=requested<bounds.minimumWei?bounds.minimumWei:requested;
 const reserve=(amount*price*120n+10000000000000000000000n-1n)/10000000000000000000000n;
 if(amount>bounds.maximumWei||amount>availableWei||reserve>BigInt(Math.max(0,Math.floor(capacityMicrousd))))return null;
 return {amountWei:amount,reserveMicrousd:Number(reserve)};
}
