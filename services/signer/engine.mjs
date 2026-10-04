import { serviceFundingBounds } from '../../shared/service-funding.mjs';
import { decodeFunctionData, encodeFunctionData, getContractAddress, keccak256, parseAbi, zeroAddress } from 'viem';
import { PORTAL, TAX_V3_IMPL, portalAbi } from '../../shared/flap-contract.mjs';
import { pendingCampaign, campaignLeg, netReceived, DEAD as BURN_SINK } from './campaigns.mjs';
import { hasPendingDomainBridge } from './domain-funding.mjs';

const DEAD = '0x000000000000000000000000000000000000dEaD';
const ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const erc20 = parseAbi(['function transfer(address to,uint256 amount) returns (bool)','function balanceOf(address) view returns (uint256)']);
const trading = parseAbi([
  'function getTokenV8Safe(address token) view returns ((uint8 status,uint256 reserve,uint256 circulatingSupply,uint256 price,uint8 tokenVersion,uint256 r,uint256 h,uint256 k,uint256 dexSupplyThresh,address quoteTokenAddress,bool nativeToQuoteSwapEnabled,bytes32 extensionID,uint256 buyTaxRate,uint256 sellTaxRate,address pool,uint256 progress,uint8 lpFeeProfile,uint8 dexId) state)',
  'function quoteExactInput((address inputToken,address outputToken,uint256 inputAmount) params) returns (uint256 outputAmount)',
  'function swapExactInput((address inputToken,address outputToken,uint256 inputAmount,uint256 minOutputAmount,bytes permitData) params) payable returns (uint256 outputAmount)',
]);
const routerAbi = parseAbi(['function factory() view returns (address)','function WETH() view returns (address)','function getAmountsOut(uint256 amountIn,address[] path) view returns (uint256[] amounts)','function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline) payable']);
const factoryAbi = parseAbi(['function getPair(address,address) view returns (address)']);
const same = (a,b) => a?.toLowerCase() === b?.toLowerCase();
const summary = row => ({id:row.id,coinId:row.coin_id,kind:row.kind,amountWei:row.amount_wei,status:row.status,hash:row.tx_hash,block:row.receipt_block});

export class SigningEngine {
  constructor(store, client, policy) { this.store=store;this.client=client;this.policy=policy; }
  async protocolReserve(wallet){return this.protocolFees?BigInt((await this.protocolFees.quote(wallet)).reserveWei):0n;}
  transactionToken(row,wallet){
    const leg=row.id?campaignLeg(this.store,row.id):null;
    if(leg?.campaign_kind!=='shen_buyback_burn')return wallet.token_address;
    const token=JSON.parse(leg.campaign_record).targetToken;
    if(!token||!same(token,this.policy.shenTokenAddress))throw Error('Protocol token configuration changed; reconciliation required');
    return token;
  }
  async chainReady() {
    if(await this.client.getChainId()!==56) throw Error('RPC must be BNB Chain');
    const block=await this.client.getBlock();
    if(BigInt(Math.floor(Date.now()/1000))-block.timestamp>90n) throw Error('RPC head is stale');
    return block;
  }
  async bindLaunch(coinId, hash) {
    const wallet=this.store.wallet(coinId);
    if(!wallet) throw Error('Agent wallet must be provisioned first');
    const head=await this.chainReady();
    const [tx,receipt]=await Promise.all([this.client.getTransaction({hash}),this.client.getTransactionReceipt({hash})]);
    if(receipt.status!=='success'||head.number-receipt.blockNumber<3n||!same(tx.to,PORTAL)) throw Error('Confirmed Flap launch required');
    const canonical=await this.client.getBlock({blockNumber:receipt.blockNumber});
    if(canonical.hash!==receipt.blockHash) throw Error('Launch receipt is not canonical');
    const {functionName,args}=decodeFunctionData({abi:portalAbi,data:tx.input});
    const p=args?.[0];
    if(functionName!=='newTokenV6'||!p||!same(p.beneficiary,wallet.address)||p.tokenVersion!==6||p.mktBps!==10000||p.deflationBps!==0||p.dividendBps!==0||p.lpBps!==0||p.buyTaxRate!==300||p.sellTaxRate!==300||tx.value!==p.quoteAmt||p.quoteToken!==zeroAddress||p.dexId!==0||p.migratorType!==1||p.extensionID!=='0x'+'0'.repeat(64)||p.extensionData!=='0x'||p.permitData!=='0x'||p.commissionReceiver!==zeroAddress||p.dividendToken!==zeroAddress||p.taxDuration!==31536000n||p.antiFarmerDuration!==3600n) throw Error('Launch does not bind platform economics to this agent wallet');
    const token=getContractAddress({from:PORTAL,salt:p.salt,bytecode:'0x3d602d80600a3d3981f3363d3d373d3d3d363d73'+TAX_V3_IMPL.slice(2).toLowerCase()+'5af43d82803e903d91602b57fd5bf3',opcode:'CREATE2'});
    const code=await this.client.getCode({address:token,blockNumber:receipt.blockNumber});
    const expected='0x363d3d373d3d3d363d73'+TAX_V3_IMPL.slice(2).toLowerCase()+'5af43d82803e903d91602b57fd5bf3';
    if(!token.toLowerCase().endsWith('7777')||code?.toLowerCase()!==expected) throw Error('Flap token implementation was not verified');
    this.store.bindLaunch(coinId,token,hash);
    return {coinId,address:wallet.address,tokenAddress:token,hash};
  }
  async requestTransaction(row, wallet) {
    const amount=BigInt(row.amount_wei),token=this.transactionToken(row,wallet);
    if(row.kind==='compute') {
      if(!this.policy.settlementAddress) throw Error('Settlement recipient is not configured');
      const bounds=serviceFundingBounds(this.policy.settlementAddress);
      if(amount<bounds.minimumWei||amount>bounds.maximumWei)throw Error('Service payment is outside deposit limits');
      return {to:this.policy.settlementAddress,value:amount,data:'0x'};
    }
    if(row.kind==='reward') {
      const leg=campaignLeg(this.store,row.id);
      if(!leg||leg.coin_id!==row.coin_id||leg.kind!=='reward'||leg.amount_wei!==row.amount_wei||leg.campaign_status!=='running'||!leg.recipient)throw Error('Reward is not authorized by a holder snapshot');
      const code=await this.client.getCode({address:leg.recipient,blockTag:'pending'});
      if(code&&code!=='0x')throw Error('Reward recipient is no longer an externally owned account');
      return {to:leg.recipient,value:amount,data:'0x'};
    }
    if(row.kind==='burn') {
      const balance=await this.client.readContract({address:token,abi:erc20,functionName:'balanceOf',args:[wallet.address]});
      if(amount>balance) throw Error('Insufficient token balance');
      return {to:token,value:0n,data:encodeFunctionData({abi:erc20,functionName:'transfer',args:[DEAD,amount]})};
    }
    if(row.kind!=='buyback')throw Error('Unsupported signing operation');
    if(!this.policy.buybacksEnabled) throw Error('Buybacks are not enabled by platform policy');
    const state=await this.client.readContract({address:PORTAL,abi:trading,functionName:'getTokenV8Safe',args:[token]});
    if(state.tokenVersion!==6||!same(state.quoteTokenAddress,zeroAddress)||state.dexId!==0) throw Error('Unsupported token route');
    const net=quote=>quote*(10000n-state.buyTaxRate)/10000n*(10000n-BigInt(this.policy.slippageBps))/10000n;
    if(state.buyTaxRate>1000n) throw Error('Tax exceeds supported route policy');
    if(state.status===1) {
      const quote=await this.client.simulateContract({account:wallet.address,address:PORTAL,abi:trading,functionName:'quoteExactInput',args:[{inputToken:zeroAddress,outputToken:token,inputAmount:amount}]});
      // Portal quotes already include the curve's input tax; only DEX reserve
      // quotes below need a separate output-transfer-tax deduction.
      const probeAmount=amount/1000n||1n;
      const probe=await this.client.simulateContract({account:wallet.address,address:PORTAL,abi:trading,functionName:'quoteExactInput',args:[{inputToken:zeroAddress,outputToken:token,inputAmount:probeAmount}]});
      this.checkPriceImpact(amount,quote.result,probeAmount,probe.result);
      const min=quote.result*(10000n-BigInt(this.policy.slippageBps))/10000n;if(min<=0n) throw Error('Empty buy quote');
      return {to:PORTAL,value:amount,data:encodeFunctionData({abi:trading,functionName:'swapExactInput',args:[{inputToken:zeroAddress,outputToken:token,inputAmount:amount,minOutputAmount:min,permitData:'0x'}]})};
    }
    if(state.status!==4) throw Error('Token is not tradable');
    const [factory,wrapped,pair,amounts]=await Promise.all([
      this.client.readContract({address:ROUTER,abi:routerAbi,functionName:'factory'}),
      this.client.readContract({address:ROUTER,abi:routerAbi,functionName:'WETH'}),
      this.client.readContract({address:FACTORY,abi:factoryAbi,functionName:'getPair',args:[WBNB,token]}),
      this.client.readContract({address:ROUTER,abi:routerAbi,functionName:'getAmountsOut',args:[amount,[WBNB,token]]}),
    ]);
    if(!same(factory,FACTORY)||!same(wrapped,WBNB)||same(pair,zeroAddress)||!same(pair,state.pool)) throw Error('Pancake V2 route is not verified');
    const probeAmount=amount/1000n||1n;
    const probe=await this.client.readContract({address:ROUTER,abi:routerAbi,functionName:'getAmountsOut',args:[probeAmount,[WBNB,token]]});
    this.checkPriceImpact(amount,amounts[1],probeAmount,probe[1]);
    const min=net(amounts[1]);if(min<=0n) throw Error('Empty buy quote');
    return {to:ROUTER,value:amount,data:encodeFunctionData({abi:routerAbi,functionName:'swapExactETHForTokensSupportingFeeOnTransferTokens',args:[min,[WBNB,token],wallet.address,BigInt(Math.floor(row.expires_at/1000))]})};
  }
  checkPriceImpact(amount,quote,probeAmount,probeQuote){
    const limit=BigInt(this.policy.maxPriceImpactBps??300);
    if(quote<=0n||probeQuote<=0n||quote*probeAmount*10000n<probeQuote*amount*(10000n-limit))throw Error('Buy exceeds price-impact policy');
  }
  async execute(input) {
    const row=this.store.createIntent(input),fence=this.store.acquire(row.coin_id);
    try {
      if(row.status!=='created') return await this.reconcile(row.id);
      const campaign=pendingCampaign(this.store,row.coin_id),leg=campaignLeg(this.store,row.id);
      if(campaign&&(!leg||leg.campaign_id!==campaign.id))throw Error('Treasury campaign is pending');
      if(leg&&Date.now()>JSON.parse(leg.campaign_record).deadline)throw Error('Campaign authority expired');
      if(leg&&(!campaign||leg.coin_id!==row.coin_id||leg.kind!==row.kind||leg.amount_wei!==row.amount_wei||leg.expires_at!==row.expires_at||leg.campaign_status!=='running'))throw Error('Campaign leg authorization mismatch');
      if(hasPendingDomainBridge(this.store,row.coin_id)) throw Error('Domain funding is pending for this wallet');
      if(row.expires_at<=Date.now()) throw Error('Unsigned intent expired');
      const pending=this.store.pending(row.coin_id);
      if(pending) {await this.reconcile(pending.id);if(this.store.pending(row.coin_id)) throw Error('Previous agent transaction is still pending');}
      const wallet=this.store.wallet(row.coin_id),head=await this.chainReady();
      // Reverify the immutable launch independently before granting signing authority.
      await this.bindLaunch(row.coin_id,wallet.launch_hash);
      const transaction=await this.requestTransaction(row,wallet);
      const [nonce,latest,balance,confirmed,gasPrice,estimated]=await Promise.all([
        this.client.getTransactionCount({address:wallet.address,blockTag:'pending'}),this.client.getTransactionCount({address:wallet.address,blockTag:'latest'}),
        this.client.getBalance({address:wallet.address,blockTag:'pending'}),this.client.getBalance({address:wallet.address,blockNumber:head.number-3n}),
        this.client.getGasPrice(),this.client.estimateGas({account:wallet.address,...transaction}),
      ]);
      if(nonce!==latest) throw Error('Untracked pending nonce; signing stopped');
      if(gasPrice>this.policy.maxGasPriceWei) throw Error('Gas price exceeds platform policy');
      const gas=estimated*120n/100n;if(gas>2000000n) throw Error('Gas estimate exceeds transaction policy');
      if(row.kind==='reward'&&(!leg?.gas_limit_wei||gas*gasPrice>BigInt(leg.gas_limit_wei)))throw Error('Reward gas exceeds its reserved allowance');
      const cost=transaction.value+gas*gasPrice,available=balance<confirmed?balance:confirmed;
      let protocolReserve=await this.protocolReserve(wallet);
      if(leg?.campaign_kind==='shen_buyback_burn'&&row.kind==='buyback'){
        if(BigInt(row.amount_wei)>protocolReserve)throw Error('Protocol buy exceeds accrued fee allocation');
        protocolReserve-=BigInt(row.amount_wei);
      }
      if(available<cost+this.policy.gasReserveWei+protocolReserve) throw Error('Insufficient confirmed funds after gas and protocol reserves');
      const expected={...transaction,nonce,gas,gasPrice};
      const raw=await this.store.account(row.coin_id).signTransaction({...expected,chainId:56,type:'legacy'});
      await this.store.persistSigned(row.id,fence,raw,expected);
      return await this.reconcile(row.id);
    } finally {this.store.release(row.coin_id,fence);}
  }
  async reconcile(id) {
    const row=this.store.intent(id);if(!row) throw Error('Intent not found');
    if(!row.tx_hash) return summary(row);
    const head=await this.chainReady();
    let receipt;
    try {receipt=await this.client.getTransactionReceipt({hash:row.tx_hash});}
    catch(e) {if(e.name!=='TransactionReceiptNotFoundError') throw e;}
    if(receipt) {
      const canonical=await this.client.getBlock({blockNumber:receipt.blockNumber});
      if(canonical.hash!==receipt.blockHash) throw Error('Transaction receipt changed; reconciliation required');
      if(row.receipt_hash&&row.receipt_hash!==receipt.blockHash) throw Error('Confirmed transaction reorganized; reconciliation required');
      if(head.number-receipt.blockNumber>=3n){
        const wallet=this.store.wallet(row.coin_id),token=this.transactionToken(row,wallet);
        if(receipt.status==='success'&&row.kind==='buyback'&&netReceived(receipt.logs??[],token,wallet.address)<=0n)throw Error('Buy receipt has no verified tokens received');
        if(receipt.status==='success'&&row.kind==='burn'&&netReceived(receipt.logs??[],token,BURN_SINK)!==BigInt(row.amount_wei))throw Error('Burn-sink receipt does not prove the authorized amount');
        this.store.finish(id,receipt);
      }
      return summary(this.store.intent(id));
    }
    if(['confirmed','reverted'].includes(row.status)) throw Error('Confirmed transaction is missing; reconciliation required');
    const raw=this.store.signedBytes(id);
    if(!raw||keccak256(raw)!==row.tx_hash) throw Error('Signed transaction journal mismatch');
    try {
      const hash=await this.client.sendRawTransaction({serializedTransaction:raw});
      if(hash!==row.tx_hash) throw Error('RPC returned a different transaction hash');
      this.store.broadcast(id);
    } catch {
      // A timeout may mean accepted. Keep the exact signed bytes and same nonce;
      // callers reconcile/rebroadcast this ID, never create a replacement payment.
    }
    return summary(this.store.intent(id));
  }
}
