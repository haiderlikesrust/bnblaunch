# Quote-token launches and agent gas

Newly created SHEN coins use **2% buy tax and 2% sell tax**, with the existing 365-day duration and fee allocation. Existing 3% launches remain valid and keep their on-chain rate. Creator input cannot override platform tax or treasury allocation.

The launch picker includes crypto, stock-token and pre-IPO entries from Flap's BNB catalog, plus a supported contract-address field. The catalog is discovery metadata, not a guarantee of eligibility. SHEN re-reads Flap's quote-token configuration and ERC-20 decimals, obtains a BNB conversion quote, and simulates the final launch before sending it to the creator's wallet. Unsupported DEX configurations or unavailable conversion routes block preparation. Tokenized stock/pre-IPO assets are identified as tokens, not direct share ownership.

For a non-BNB developer buy, the creator approves only the requested quote-token amount to the Flap Portal. A nonzero insufficient allowance is reset before approval. `quoteAmt` uses that token's decimals and the launch transaction sends zero native value. Native BNB launches retain their original payment flow. The signer independently decodes the confirmed launch and permanently binds its beneficiary, token, quote asset and fee economics.

## Initial BNB deposit

After the launch is confirmed, the creator approves a separate BNB transfer directly to the agent wallet. The target is:

```
SIGNER_GAS_RESERVE_WEI + 1,500,000 × SIGNER_MAX_GAS_PRICE_WEI
```

With the existing template values (0.002 BNB reserve and 3 gwei ceiling), this is **0.0065 BNB**, less an existing confirmed BNB balance. The creator separately pays network gas. The picker displays the target and the wallet displays the actual payment. No new gas-deposit secret or environment variable is required. Deploy the updated signer as well as web/worker so the gas policy is available.

The deposit records a fixed creator nonce, recipient and amount. A retry does not allocate another nonce for an unknown transfer. Verification requires a successful canonical receipt with three confirmations. The owner can resume from the coin page and provide a replacement transaction hash. A failed or cancelled launch never asks for the gas deposit. Cancelling gas funding after launch leaves the token launched, with funding resumable on its page.

This deposit is not trading revenue, does not receive the 85/15 fee split, and is not credited as AI-provider funds. The usual confirmed BNB gas reserve remains protected during spending.

## Fee conversion

The signer worker runs fee conversion independently of agent planning. It audits the bound Flap tax processor's cumulative dispatched quote fees and converts only that earned quantity, bounded by the wallet's confirmed quote-token balance. Unrelated quote-token deposits are not added to fee income.

Supported routes are PancakeSwap V2 or V3, direct to WBNB or through USDT/USDC. V3 discovery checks the standard 100, 500, 2500 and 10000 fee tiers. Contracts and intermediaries are fixed in code; agents and public requests cannot supply routers, calldata or recipients. This does not guarantee every Flap-supported token has a usable route at every time.

Each batch journals exact approval/reset, swap and WBNB withdrawal legs. Signed bytes, nonces and transaction IDs survive restarts and lost responses. Swap receipts must prove the exact quote-token debit and WBNB received; withdrawal receipts must prove the matching native-BNB amount. Only these confirmed native proceeds accrue the protocol allocation. Failed unwraps retain their WBNB proceeds and never repeat the original sale.

Fresh quotes enforce the configured signer slippage (maximum 3%) and existing price-impact policy. Batches shrink when needed for price impact instead of using a fixed maximum BNB sale. Fees accumulate until conversion is economical: output must cover the minimum batch and at least twice a conservative gas allowance. Gas shortages, missing liquidity and failed quotes defer this job; unrelated planning, research and publication can continue with their own available funds. There is no automatic slippage increase.

Revenue shows the conversion steps and transaction links. Curve prices use the selected quote asset's decimals and symbol; SHEN does not label a stock-token quote as BNB or invent a USD conversion.

## Deployment and verification

Redeploy **web, signer and worker together**. Web migration `0034_quote_launch.sql` adds quote metadata and gas receipts. Signer storage adds quote bindings and conversion journals without changing existing keys or launch bindings. Preserve both database volumes. Existing worker/signing secrets and BNB RPC configuration are reused.

Tests cover legacy/new tax rates, decimal rounding rejection, bounded route construction, gas receipts, exact-once conversion after lost responses, forged intents, missing output receipts, insufficient gas and separate protocol accounting. Read-only BNB mainnet checks on 2026-10-04 found routes for USDT, NVDAB, pPOLY, xKLSH and oANTHROPIC. Flap `eth_call` launch simulations passed at 2% for native BNB, USDT and pPOLY. No live launch, approval, swap or transfer was signed or broadcast for verification.

References: [Flap launch interface](https://docs.flap.sh/flap/developers/token-launcher-developers/launch-token-through-portal), [Flap TaxProcessor interface](https://github.com/flap-sh/FlapVaultExample/blob/main/src/flap/ITaxProcessor.sol), [PancakeSwap V3 addresses](https://developer.pancakeswap.finance/contracts/v3/addresses), [V3 swap interface](https://github.com/pancakeswap/pancake-v3-contracts/blob/main/projects/v3-periphery/contracts/interfaces/ISwapRouter.sol).
