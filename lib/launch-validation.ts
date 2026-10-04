import { z } from 'zod';
import { parseEther, ContractFunctionRevertedError, BaseError } from 'viem';
import { AppError } from './server';

export class LaunchPendingError extends AppError {}

export const initialBuyBnb=z.string().max(80).regex(/^(0|[1-9]\d*)(\.\d{1,18})?$/, 'Enter a non-negative BNB amount with at most 18 decimal places.').refine(value=>{
 try{return parseEther(value)<2n**256n}catch{return false}
},'Developer buy amount is too large.').default('0');

export function launchError(error:unknown,stage:string){
 if(error instanceof AppError)return error;
 if(error instanceof BaseError){
  const revert=error.walk(e=>e instanceof ContractFunctionRevertedError);
  if(revert instanceof ContractFunctionRevertedError){
   const name=revert.data?.errorName;
   const known=name==='InvalidDexThresholdType'?'Flap rejected the launch threshold.':name==='InvalidMigratorType'?'Flap rejected the migration route.':'Flap rejected the launch transaction.';
   return new AppError(422,known+' No transaction was sent. Revalidate the launch; if it persists, share the launch error with support.');
  }
  const missing=error.walk(e=>e instanceof Error&&['TransactionReceiptNotFoundError','TransactionNotFoundError'].includes(e.name));
  if(missing instanceof Error&&['TransactionReceiptNotFoundError','TransactionNotFoundError'].includes(missing.name))return new LaunchPendingError(202,'Confirming launch on BNB Chain… Waiting for the transaction to be mined.');
  const funds=error.walk(e=>e instanceof Error&&e.name==='InsufficientFundsError');
  if(funds instanceof Error&&funds.name==='InsufficientFundsError')return new AppError(422,'Your launch wallet needs enough BNB for the developer buy and network gas.');
 }
 // Do not expose RPC endpoints, request payloads, signatures or provider text.
 console.warn('[SHEN launch]',stage,error instanceof Error?error.name:'unknown');
 return new AppError(503,`Launch ${stage} could not complete. Check the web/signing service and BNB RPC, then retry. No successful launch has been recorded.`);
}
