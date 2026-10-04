import {zeroAddress,formatEther} from 'viem';
import {chainClient} from '@/lib/providers';
import {AppError,failure,response} from '@/lib/server';
import {QUOTE_CATALOG} from '@/shared/quote-catalog.mjs';
import {quoteTokenInfo,findConversionRoute,sameAddress,gasDepositTarget} from '@/shared/quote-pairs.mjs';
import {signerRequest} from '@/lib/signer';
export async function GET(request:Request){
 try{
  const address=new URL(request.url).searchParams.get('address');if(!address)return response({tokens:QUOTE_CATALOG});
  const client=chainClient();if(await client.getChainId()!==56)throw new AppError(503,'BNB Chain RPC unavailable.');
  const token=await quoteTokenInfo(client,address);
  const route=sameAddress(address,zeroAddress)?null:await findConversionRoute(client,address,10n**BigInt(token.decimals));
  const policy=route?await signerRequest<{gasReserveWei:string;maxGasPriceWei:string}>('/v1/status'):null;
  return response({token,gasDepositBnb:policy?formatEther(gasDepositTarget(BigInt(policy.gasReserveWei),BigInt(policy.maxGasPriceWei))):'0',conversion:route?{kind:route.kind,tokens:route.tokens}:null,checkedAt:Date.now()});
 }catch(e){return failure(e instanceof AppError?e:new AppError(422,'This pair is not currently eligible, or a supported BNB conversion route is unavailable.'))}
}
