import { existsSync } from 'node:fs';
import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';
import { WalletStore } from './store.mjs';
import { SigningEngine } from './engine.mjs';
import { Campaigns } from './campaigns.mjs';
import { ProtocolFees } from './protocol-fees.mjs';
import { recoverTestFees, RecoveryError } from './test-fee-recovery.mjs';

// One recovery authorized by the operator in this chat. Not a withdrawal API.
const authority=Object.freeze({
 id:'98a43dcc-bdab-4d21-b60c-4fa595c799ba',
 previousRecoveryIds:['e4fbc49e-894d-4b82-ae31-a41c617882d0'],
 coinId:'0acdcac1-1a5f-4e97-b31e-9eea2a3eaabd',
 address:'0x92b3291953bad11b24debccd6e40c8eb6b1b964f',
 token:'0x2e027e343b6359c792B6a061888Bee4362C57777',
 recipient:'0x4a41ee912283966be446514af39e1e3322bb7840',
 maximumWei:'250000000000000000',
});
let store;
try{
 const args=process.argv.slice(2);
 if(args.length>1||(args.length===1&&!['--preview','--execute'].includes(args[0])))throw new RecoveryError('Use --preview or --execute');
 const path=process.env.SIGNER_DB_PATH??'/data/signer.sqlite';
 if(!existsSync(path))throw new RecoveryError('Signer database not found; run inside the deployed signer container');
 const rpc=process.env.BNB_RPC_URL;
 if(!rpc||new URL(rpc).protocol!=='https:')throw new RecoveryError('Configured HTTPS BNB RPC is required');
 const positive=name=>{const raw=process.env[name];if(!/^\d+$/.test(raw??'')||BigInt(raw)<=0n)throw new RecoveryError('Missing positive '+name);return BigInt(raw);};
 const policy={gasReserveWei:positive('SIGNER_GAS_RESERVE_WEI'),maxGasPriceWei:positive('SIGNER_MAX_GAS_PRICE_WEI'),shenTokenAddress:process.env.SHEN_TOKEN_ADDRESS};
 store=new WalletStore(path,process.env.SIGNER_MASTER_KEY);
 const client=createPublicClient({chain:bsc,transport:http(rpc,{timeout:12000,retryCount:1})}),engine=new SigningEngine(store,client,policy);
 engine.protocolFees=new ProtocolFees(store,engine,new Campaigns(store,engine));
 console.log(JSON.stringify(await recoverTestFees(store,engine,authority,{execute:args[0]==='--execute'}),null,2));
}catch(error){
 console.error(error instanceof RecoveryError?error.message:'Recovery could not finish. Check signer health and retry the same command; any saved transfer is resumed, never replaced.');
 process.exitCode=1;
}finally{store?.close();}
