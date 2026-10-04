import {type Address,type Hex,type PublicClient} from 'viem';
import {AppError} from './server';
export async function verifyGasDeposit(client:Pick<PublicClient,'getChainId'|'getTransaction'|'getTransactionReceipt'|'getBlockNumber'|'getBlock'>,deposit:{creator:string;wallet:string;amount_wei:string;tx_hash:string;nonce?:number}){
 if(await client.getChainId()!==56)throw new AppError(503,'BNB Chain RPC unavailable.');
 const hash=deposit.tx_hash as Hex;
 const [tx,receipt,head]=await Promise.all([client.getTransaction({hash}),client.getTransactionReceipt({hash}),client.getBlockNumber()]);
 if(tx.from.toLowerCase()!==deposit.creator.toLowerCase()||tx.to?.toLowerCase()!==deposit.wallet.toLowerCase()||tx.value!==BigInt(deposit.amount_wei)||tx.input!=='0x'||(deposit.nonce!==undefined&&tx.nonce!==deposit.nonce))throw new AppError(400,'This transaction does not match the gas deposit.');
 if(head-receipt.blockNumber<3n)return null;
 if((await client.getBlock({blockNumber:receipt.blockNumber})).hash!==receipt.blockHash)throw new AppError(409,'Gas deposit confirmation changed; retry verification.');
 if(receipt.status!=='success')throw new AppError(409,'The gas deposit reverted.');
 return {blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash};
}
