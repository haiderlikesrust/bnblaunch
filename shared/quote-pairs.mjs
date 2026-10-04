import {parseAbi,zeroAddress,isAddress,encodePacked} from 'viem';
import {PORTAL} from './flap-contract.mjs';
export const WBNB='0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
export const V2_ROUTER='0x10ED43C718714eb63d5aA57B78B54704E256024E';
export const V3_ROUTER='0x1b81D678ffb9C0263b24A97847620C99d213eB14';
export const V3_QUOTER='0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997';
export const BRIDGES=['0x55d398326f99059fF775485246999027B3197955','0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'];
export const erc20QuoteAbi=parseAbi(['function symbol() view returns(string)','function name() view returns(string)','function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)','function withdraw(uint256)','event Withdrawal(address indexed src,uint256 wad)']);
export const quoteConfigAbi=parseAbi(['function getQuoteTokenConfiguration(address) view returns((uint8 enabled,uint8 defaultCurve,uint8 alternativeCurve,uint8 nativeToQuoteSwapType,uint8 dexId))']);
export const v2ConversionAbi=parseAbi(['function getAmountsOut(uint256,address[]) view returns(uint256[])','function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)']);
export const v3ConversionAbi=parseAbi(['function exactInput((bytes path,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum)) payable returns(uint256)']);
const quoterAbi=parseAbi(['function quoteExactInput(bytes,uint256) returns(uint256,uint160[],uint32[],uint256)']);
export const sameAddress=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
export async function quoteTokenInfo(client,address,eligibility=true){
 if(!isAddress(address))throw Error('Enter a valid BNB Chain token address.');
 if(sameAddress(address,zeroAddress))return {address:zeroAddress,symbol:'BNB',name:'BNB',decimals:18,dexId:0};
 if(sameAddress(address,WBNB))throw Error('Choose native BNB instead of WBNB for the launch pair.');
 const config=eligibility?await client.readContract({address:PORTAL,abi:quoteConfigAbi,functionName:'getQuoteTokenConfiguration',args:[address]}):{enabled:1,dexId:0};
 if(config.enabled!==1)throw Error('Flap has not enabled this quote token.');
 if(config.dexId!==0)throw Error('This quote token requires a DEX route QI does not support yet.');
 const [symbol,name,decimals]=await Promise.all(['symbol','name','decimals'].map(functionName=>client.readContract({address,abi:erc20QuoteAbi,functionName})));
 if(typeof symbol!=='string'||symbol.length>40||typeof name!=='string'||name.length>120||!Number.isInteger(decimals)||decimals<0||decimals>36)throw Error('Quote token metadata is invalid.');
 return {address:address.toLowerCase(),symbol,name,decimals,dexId:config.dexId};
}
export function validateConversionRoute(route,token){
 if(!route||!['v2','v3','wrapped'].includes(route.kind)||!Array.isArray(route.tokens)||route.tokens.length<1||route.tokens.length>3||route.tokens.some(t=>!isAddress(t))||!sameAddress(route.tokens[0],token)||!sameAddress(route.tokens.at(-1),WBNB))throw Error('Invalid conversion route');
 if(route.kind==='wrapped'){if(route.tokens.length!==1||!sameAddress(token,WBNB))throw Error('Invalid unwrap route');return route;}
 if(route.tokens.length<2||new Set(route.tokens.map(t=>t.toLowerCase())).size!==route.tokens.length||route.tokens.slice(1,-1).some(t=>!BRIDGES.some(b=>sameAddress(t,b))))throw Error('Unsupported conversion intermediary');
 if(route.kind==='v3'&&(!Array.isArray(route.fees)||route.fees.length!==route.tokens.length-1||route.fees.some(f=>![100,500,2500,10000].includes(f))))throw Error('Unsupported pool fee');
 return route;
}
export function packedRoute(route){validateConversionRoute(route,route.tokens[0]);const types=['address'],values=[route.tokens[0]];for(let i=0;i<route.fees.length;i++){types.push('uint24','address');values.push(route.fees[i],route.tokens[i+1])}return encodePacked(types,values);}
export async function quoteConversion(client,route,amount){
 validateConversionRoute(route,route.tokens[0]);if(amount<=0n)throw Error('Empty conversion');
 if(route.kind==='wrapped')return amount;
 if(route.kind==='v2'){const out=await client.readContract({address:V2_ROUTER,abi:v2ConversionAbi,functionName:'getAmountsOut',args:[amount,route.tokens]});return out.at(-1);}
 const out=await client.simulateContract({address:V3_QUOTER,abi:quoterAbi,functionName:'quoteExactInput',args:[packedRoute(route),amount]});return out.result[0];
}
export async function findConversionRoute(client,token,amount){
 if(sameAddress(token,WBNB))return {kind:'wrapped',tokens:[token],output:amount};
 const paths=[[token,WBNB],...BRIDGES.filter(b=>!sameAddress(b,token)).map(b=>[token,b,WBNB])],candidates=[];
 // Bounded discovery: V2 direct/stable routes and V3 direct routes. For V3
 // two-hop routes choose each hop's best quoted fee, then quote the full path.
 // quoteConversion validates whole routes, so intermediate hop quotes use the
 // same fixed quoter directly (the resulting full route is validated below).
 const hop=async(a,b,input)=>{const quotes=await Promise.allSettled([100,500,2500,10000].map(async fee=>{const path=encodePacked(['address','uint24','address'],[a,fee,b]);const r=await client.simulateContract({address:V3_QUOTER,abi:quoterAbi,functionName:'quoteExactInput',args:[path,input]});return {fee,output:r.result[0]}}));return quotes.filter(q=>q.status==='fulfilled'&&q.value.output>0n).map(q=>q.value).sort((a,b)=>a.output>b.output?-1:1)[0];};
 await Promise.all(paths.map(async tokens=>{try{const route={kind:'v2',tokens};candidates.push({...route,output:await quoteConversion(client,route,amount)})}catch{};try{const first=await hop(tokens[0],tokens[1],amount);if(!first)return;const second=tokens.length===3?await hop(tokens[1],tokens[2],first.output):null;if(tokens.length===3&&!second)return;const route={kind:'v3',tokens,fees:second?[first.fee,second.fee]:[first.fee]};candidates.push({...route,output:await quoteConversion(client,route,amount)})}catch{}}));
 const best=candidates.filter(c=>c.output>0n).sort((a,b)=>a.output>b.output?-1:1)[0];if(!best)throw Error('No supported liquid route from this quote token to BNB.');return best;
}
export function gasDepositTarget(reserve,maxGasPrice){
 // Startup reserve plus allowance for approval, conversion and unwrap. The
 // amount is shown before signing and goes directly to the coin's wallet.
 if(reserve<=0n||maxGasPrice<=0n)throw Error('Gas policy unavailable');
 return reserve+1500000n*maxGasPrice;
}
