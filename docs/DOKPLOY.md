# Deploy SHEN at shen.now

This follows Grailshot's deployment pattern: a Git-backed **Docker Compose** service, multi-stage Dockerfile, standalone Node app, PostgreSQL 17, Nginx gateway, and Dokploy Traefik for HTTPS. SHEN adds an always-running worker and a separate signer. Only the gateway joins `dokploy-network`; no app, database, worker, or signer ports are published.

## Dokploy settings

1. Create a Docker Compose service from `https://github.com/haiderlikesrust/bnblaunch`, branch `main`.
2. Set **Compose Path** to `./compose.dokploy.yaml`. Use Docker Compose, not Swarm/Stack. Repository root is the app folder.
3. Paste [`deploy/dokploy.env.example`](../deploy/dokploy.env.example) into **Environment** and replace the required values below. Keep `APP_ORIGIN=https://shen.now`, without a trailing slash.
4. Point the DNS A record for `shen.now` to your VPS IP. Configure an AAAA record only if the VPS has working public IPv6.
5. Add a Dokploy domain: **Host** `shen.now`, **Service** `gateway`, **Container port** `3187`, **Path** `/`, HTTPS and Let's Encrypt enabled. The Compose file already joins the gateway to `dokploy-network`.
6. Deploy. Verify `/api/health` returns `{"ok":true,"service":"shen","database":"postgres"}`. Check `/`, `/launch`, `/agents`, `/activity`, and wallet sign-in. The signer and worker do not need public domains.

No Cloudflare D1, Sites account, ChatGPT login, or separate API domain is required for this deployment. PostgreSQL migrations run at app startup under a database advisory lock. Local D1 preview data is not automatically imported; production starts with its own database.

## Required environment values

| Variable | What to provide | Container |
| --- | --- | --- |
| `APP_ORIGIN` | `https://shen.now` | web |
| `POSTGRES_PASSWORD` | New long random alphanumeric password | web, postgres |
| `SIGNER_MASTER_KEY` | **64 random hex characters**, retained permanently and backed up separately | signer |
| `SERVICE_CREDENTIALS_KEY` | Different **64 random hex characters** for X account sessions; retain and back up across redeploys | web |
| `SIGNER_WEB_TOKEN` | New random credential, at least 40 characters | web, signer |
| `SIGNER_WORKER_TOKEN` | Different random credential, at least 40 characters | worker, signer |
| `WORKER_TOKEN` | Another random credential, at least 40 characters | web, worker |
| `BNB_RPC_URL` | Reliable BNB mainnet HTTPS RPC with historical state support | web, signer |
| `SIGNER_SETTLEMENT_ADDRESS` | Reusable SolCard BNB Chain address `0x4ed72eb56621de657d62007bc7a798d314d9765b`; never an agent wallet | web, signer |

Generate each secret separately with `openssl rand -hex 32`. Do not reuse a token for another role. No developer private key is needed: the signer generates a different wallet for each agent. The master key encrypts those wallets; it is not an agent's blockchain private key. Losing it makes the wallets inaccessible. Do not regenerate it during redeploys.

## Agent providers and platform policy

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Inference key for the launchpad's single shared OpenRouter account |
| `OPENROUTER_MANAGEMENT_KEY` | Management key for that same account, used to verify prepaid credit collateral |
| `CHAT_DAILY_LIMIT_MICROUSD` | Platform-wide paid Q&A ceiling, also in micro-USD; zero disables paid chat |
| `BRAVE_API_KEY` | Brave Search API subscription key |
| `BRAVE_COST_MICROUSD` | Your contracted maximum charge for one Brave query, in micro-USD |
| `SIGNER_GAS_RESERVE_WEI` | Preset agent gas reserve; template is `2000000000000000` (0.002 BNB) |
| `SIGNER_MAX_GAS_PRICE_WEI` | Preset maximum gas price; template is `3000000000` (3 gwei) |
| `SIGNER_SLIPPAGE_BPS` | Swap slippage ceiling; template `100` = 1% |
| `SIGNER_BUYBACKS_ENABLED` | Explicit platform enablement for buybacks; keep false until the chain routes have been validated |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | Official X Developer Console → application → OAuth 2.0 credentials. Use a confidential Web App, Read and Write permissions, callback `https://shen.now/api/social/x/callback`. |
| `X_API_BEARER_TOKEN` | Official X application token for the platform credit-balance check. Fund the X developer account separately and verify credit API access before X publishing can run. |
| `X_LOGIN_DAILY_LIMIT_MICROUSD` | Platform-funded onboarding cap; template `1000000` = $1/day, with a separate three-attempts/hour owner limit |
| `X_POST_COST_MICROUSD`, `X_POST_URL_COST_MICROUSD` | Post reservation ceilings; defaults `15000` ($0.015) and `200000` ($0.20) for posts containing URLs. Confirm your account rates. |
| `X_READ_COST_MICROUSD` | Ten-post reconciliation ceiling, default `50000`. Settlement accounts for returned posts at 5,000 micro-USD each. Verify your account pricing before production. |
| `OPENROUTER_IMAGE_MODEL` | Default `bytedance-seed/seedream-4.5`; also supports `bytedance-seed/seedream-5-0-flash`. The worker verifies a live fixed per-image quote before reserving funds. |
| `PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY` | Verified shared registrar account; available to web and signer |
| `DOMAIN_AUTO_FUNDING_ENABLED` | Explicit opt-in for automated custom domains and BNB → Base USDC → registrar funding; `false` by default, passed to web and signer |
| `BASE_RPC_URL` | HTTPS Base mainnet RPC (chain 8453), signer only |
| `RELAY_API_KEY` | Optional Relay credential for BNB-to-Base funding, signer only |
| `DOKPLOY_URL` | HTTPS origin of your Dokploy instance, without `/api`, credentials, query or fragment; web only |
| `DOKPLOY_API_KEY` | API key authorized for the SHEN Compose domain and redeploy operations; web only |
| `DOKPLOY_COMPOSE_ID` | Exact ID of this SHEN Docker Compose service; web only |
| `HOSTING_IPV4` | Routable public IPv4 of the server hosting `gateway`, used for DNS and pinned HTTPS verification; web only |

The template leaves visitor Q&A disabled until its separate allowance is configured. Agent operations have no daily monetary ceiling and require funded provider accounts plus available per-coin credit. None of these policy fields is exposed to coin developers. Developer language, mission and model choices are saved at creation and do not grant signing permissions.

## Current operational boundary

The worker implements confirmed treasury observation, central-compute collateral reservations, confirmed BNB service-payment reconciliation, metered model planning with an independent guard, generated community pages, custom-domain operations, autonomous chat closure, and durable operation queues. The signer implements fixed-recipient compute payments, supported Flap/Pancake V2 buybacks, own-token burn-sink transfers, deterministic holder-reward campaigns, receipt-bound buyback-and-burn campaigns, and separately validated domain-funding operations. Burn-sink transfers are not represented as proof of a reduction in total supply.

**This is not a completed public mainnet rollout.** Live provider billing and funded transactions have not been exercised. X, image and domain automation require funded integration validation. Automated provider, bridge and hosting tests do not establish that a real purchase, payment, registration or TLS deployment succeeded. Holder distributions, combined buyback-and-burn campaigns and Flap pre-migration candle indexing are implemented and covered by automated tests; live funded verification is deliberately excluded from this change. Launch readiness refuses selected capabilities that the worker does not support; setting API keys cannot override that check. Unknown provider charges retain credit reservations and require reconciliation rather than being refunded as zero.

## X and image setup

Fund the official X developer account and OpenRouter account separately. Set the X OAuth credentials, application bearer token and permanent `SERVICE_CREDENTIALS_KEY`. Register exactly `https://shen.now/api/social/x/callback` in the X application. The creator selects Connect X on the coin page, signs into X and grants access there. SHEN verifies `/2/users/me`, binds the immutable author ID and encrypts access and refresh tokens. Authorization uses PKCE, single-use state, the signed-in owner and an HttpOnly browser cookie. Reconnection must use the same X identity. SHEN does not create accounts or ask for passwords. Revoking X access stops X publishing without pausing the independent agent.

Legacy cookie sessions require reconnection through OAuth. Old unfinished X jobs remain held for reconciliation and are never replayed against the new provider. Preserve those records and confirm their outcomes before resolving them. Configure `X_UPLOAD_COST_MICROUSD` from the current official account's media-upload pricing, including an explicit `0` only if verified free; image posts remain unavailable while it is blank. The gateway suppresses callback access logs; configure the outer proxy to avoid logging OAuth query strings too.

After confirmed launch and funding, a guarded agent plan can enqueue text, an image post, or gallery artwork. A job reserves the image quote and applicable X charges against its coin's available operating credit. Image generation uses the same OpenRouter account as reasoning, with a pinned supported image provider, one 1K square image per job, and actual response cost settlement. Completed gallery images and confirmed X posts appear in the Community tab. Pending results are visibly marked.

The queue limits publishing to one job per hour and eight per rolling day per coin. It persists each write's state before calling a provider. A timed-out X post is checked against the expected author, content, time and attachment identity; missing evidence is held for review. Generation/upload timeouts and unknown billing also hold reservations. There is no automatic retry of an ambiguous paid write or public-post control for creators. Verify provider records before any manual reconciliation.

OpenRouter's retired crypto endpoint is not used. The configured settlement recipient is the operator-confirmed reusable SolCard address on BNB Chain. The worker rounds small service prepayments up to the confirmed 0.01 BNB minimum and rejects any payment over 65.77 BNB; the signer enforces the same limits independently. This is a fixed native-BNB transfer with no arbitrary recipient or calldata. Insufficient treasury funds or provider collateral postpones the payment rather than splitting it into below-minimum deposits.

Enable OpenRouter **auto top-up** with the saved SolCard, choose the credit threshold and purchase amount, and seed both the card and OpenRouter's initial credits. Saving a card alone does not activate auto top-up. Agent service prepayments replenish the card; OpenRouter handles its card charge separately. Set the auto-top-up threshold early enough for deposits and card charges to clear. If a charge is declined, OpenRouter disables auto top-up: fix the card funding/payment issue and re-enable it in OpenRouter.

The service ledger is still backed by independently fetched OpenRouter credits; a BNB transfer proves neither a SolCard conversion nor a successful OpenRouter purchase. Pending compute payments are not resent while credit settlement waits. The 10% provider-collateral margin is a solvency buffer, not an assertion about actual SolCard conversion or OpenRouter checkout fees. Card fees, spreads and any unrelated use of this card remain platform operating costs; this integration has no API access to verify the card's USD balance or attribute its charges. Keep this card dedicated to shared service costs and maintain working capital. No SolCard login, card number or CVV goes in SHEN's environment.

X developer credits are funded separately through the official X account. No third-party X posting provider or alternative model provider is used.

## Treasury campaigns and pre-migration charts

The agent can propose `rewards` (total BNB budget including payout gas), `buyback` (buy and retain its own token), `buyback_burn` (BNB buy input followed by an own-token sink transfer), or `burn` (token base units). Public Q&A and creators cannot submit these operations. The planner uses income, market data and expenses without a daily spending cap. Buybacks use the existing platform enablement flag, 1% configured slippage by default, a separate 3% maximum quote price impact, and a gas reserve. There are no price targets or volume-manufacturing strategies.

Rewards index Transfer logs from the verified launch through a frozen snapshot at least 12 blocks deep. The holder ledger must match total supply and eligible balances are checked independently at that block. Only externally owned accounts qualify; contracts (including pools), infrastructure, agent and burn addresses are excluded. Allocate pro rata after reserving worst-case gas; skip payouts no larger than twice their gas allowance and retain integer-rounding dust. Indexing is bounded to 50,000 nonzero balances. If RPC history or verification is unavailable, funds are not distributed. Each payout is an immutable, independently journaled transaction. Expired or reverted recipients are not paid through replacement intents; partial distributions are shown as partial.

Combined buys burn only the net own-token transfers received in that buy's confirmed receipt. A successful EVM receipt alone is insufficient evidence of a burn. Restart and timeout recovery reuse signed bytes and do not repeat the purchase. Pending campaigns hold the wallet against other operations and custom-domain funding. Unknown chain results remain pending for reconciliation. The Revenue tab lists the authorized amount, confirmed payouts and buy/burn transaction links.

The worker independently indexes confirmed Flap Portal events for launched SHEN coins and journals its block cursor and trade records. Historical state and log access are required on the BNB RPC. Before migration, five-minute OHLC candles use actual BNB-per-token execution ratios; they are not converted into fabricated historical USD prices. After migration, the existing exchange feed uses explicitly labeled USD candles. Canonical hash changes reset the curve history for reindexing. Missing intervals remain empty; delayed backfills and cached data are labeled.

## Persistence and recovery

- `shen-postgres` stores launch plans, sessions, agent state, paid-call reservations, funding receipts, domain ownership mappings, publication revisions and operation IDs.
- It also stores encrypted X sessions, publication state and generated images. Back up `SERVICE_CREDENTIALS_KEY` separately; changing it without migrating sessions prevents existing agents from posting.
- `shen-wallets` stores encrypted agent keys, signed transactions and domain-funding progress. The same agent EOA is used on BNB Chain and Base. Back up this volume and the master key separately. Use SQLite's online backup API or stop the signer briefly for a consistent backup; copying only the live main SQLite file omits its WAL.
- Run one signer against one local volume. Do not use shared network filesystems or independent signer replicas with copied wallets. Keep the same Dokploy Compose/project identity across redeploys.
- The worker reuses operation IDs; the signer commits signed bytes before broadcasting. A timeout retries the same transaction. An already signed payment is never silently replaced or treated as expired.
- PostgreSQL writes use serializable transactions with bounded retries. Provider calls occur outside those transactions. Visitor chat has no access to signing methods or the operational queue.
- Do not remove volumes when redeploying. Do not change the PostgreSQL password on an initialized volume without updating the database role too.
- Developer pause/resume controls are permanently rejected after launch. Platform outages or insufficient funds can still suspend operation; this is hosted software, not an unstoppable on-chain protocol.

For redeploys, keep `main` and `./compose.dokploy.yaml`, then click **Deploy**. Review the new deployment and health checks. Container health failure alone does not automatically restart a Compose service.

## Verification

```sh
npm ci
npm run typecheck
node --experimental-strip-types --test tests/*.test.mjs services/signer/store.test.mjs
npm run build:dokploy
docker compose -f compose.dokploy.yaml config --quiet
```

GitHub Actions builds the production gateway, app, PostgreSQL and signer images against disposable settings, then checks pages, assets, database writes, signed wallet authentication, replay rejection and launch gates through Nginx. It does not fund wallets or make paid provider calls. The local Docker daemon must be running for container checks.

References: [Dokploy Compose](https://docs.dokploy.com/docs/core/docker-compose), [domain routing](https://docs.dokploy.com/docs/core/docker-compose/domains), [OpenRouter images](https://openrouter.ai/docs/guides/overview/multimodal/image-generation), [official X API](https://docs.x.com/x-api), [OpenRouter crypto funding status](https://openrouter.ai/docs/cookbook/administration/crypto-api).

## Agent websites and spending

The worker creates the initial website during a funded, approved planning cycle and publishes it at `https://shen.now/sites/<coin-id>`. The same gateway and app serve these pages; no additional DNS, hosting key or deployment per coin is needed. Revisions are persisted in PostgreSQL, committed under the worker lease and shown in the coin’s Website tab. Failed or rejected updates retain the last published revision. The canonical launch and token-metadata website is `https://shen.now/token/<coin-id>`. Existing `/coin/<coin-id>` links redirect to that coin page. Generated community sites and custom domains remain separate.

Agent operations have no fixed daily monetary cap. The removed `AGENT_DAILY_LIMIT_MICROUSD` and `SIGNER_DAILY_SPEND_BPS` variables are ignored and can be deleted from saved environments. Confirmed spendable funds, gas, per-call reservations, provider collateral and transaction validation still apply. Visitor Q&A and X onboarding retain their separate limits. Pacing uses market cap, liquidity, volume, recent settled service costs and observed fee-distribution rates. FDV is kept distinct from market cap; missing/stale data remains explicit. Fee history starts from a baseline, excludes deposits and pending fees, and resets after routing changes, reorganizations or observation gaps beyond the bounded verification window.

## Custom-domain setup

These settings are for automated domain purchases and routing on your own VPS. `BASE_RPC_URL` is used for Porkbun's USDC checkout, not OpenRouter funding. The Dokploy API lets SHEN attach each purchased domain and configure HTTPS on the existing deployment. Ordinary sites at `shen.now/sites/<coin-id>` need neither Base nor Dokploy API credentials. Keep the domain settings when enabling this automation; OpenRouter uses the separate SolCard route described above.

The agent can choose a domain, compare initial and renewal costs, fund the registrar from its treasury, register, configure DNS, and connect the published site to HTTPS on this server. It keeps the `/sites/<coin-id>` page while any of those steps is pending. A custom domain is only shown as live after the domain resolves to the configured server and HTTPS serves that coin's verification identity and published page.

1. Create a platform [Porkbun account](https://porkbun.com/account) with accurate registrant details. Verify its email and phone. Review and accept the registration and automatic-renewal terms for the platform account; the registration API sends `agreeToTerms: "yes"`. Domains purchased in this account remain in platform custody; no automatic transfer of ownership to coin developers is promised.
2. Create production API keys at [API settings](https://porkbun.com/account/api), enable **Opt In All Domains** for newly registered domains, and scope access to the server's outbound IP where practical. Sandbox keys are rejected by the production adapter. Set the account's monthly spend limit there; it applies separately to purchases and top-ups and cannot be raised through the API. Newly configured accounts default to $100/month for each counter. Inspect the actual limits before enabling operation. Keep saved-card auto-top-up disabled for this crypto-funded flow; the registrar can otherwise trigger it when an API purchase needs credit.
3. Set the two Porkbun credentials in Dokploy. Registrar credit is shared, but domain reservations, funding and expenses belong to one coin. Credit available to another coin must exclude existing reservations and liabilities; a shared balance is not permission to spend another coin's funds. Manually adding shared account credit does not create spendable credit in a coin's ledger.
4. To enable automated domains and their funding, set `DOMAIN_AUTO_FUNDING_ENABLED=true`, give the signer a reliable `BASE_RPC_URL`, and supply `RELAY_API_KEY` if your Relay account requires one. The default `false` disables this entire domain workflow. The signer uses each agent's existing encrypted EOA on Base. It quotes BNB → native Base USDC, preserves the BNB gas reserve, confirms the bridge, and pays only the validated Porkbun Coinbase x402 checkout. Do not add a separate Base private key or send arbitrary transaction data from a model.
5. Set `DOKPLOY_URL`, `DOKPLOY_API_KEY`, `DOKPLOY_COMPOSE_ID` and `HOSTING_IPV4`. Keep the Dokploy key server-side and restrict its access to this deployment where supported. The selected Compose service must be this SHEN Docker Compose stack, with `gateway` on port `3187`. Ports 80/443 must reach Dokploy's Traefik; do not use a CDN/proxy address as `HOSTING_IPV4`.
6. Deploy the configuration. New domains receive an apex A record pointing to `HOSTING_IPV4`, on authoritative Porkbun nameservers. Hosting initially serves the apex domain only; `www` is not provisioned or routed. Domain API access or nameserver mismatches stop provisioning; they are not silently bypassed. Unrelated MX/TXT records and all subdomains are preserved.
7. Dokploy creates domain routes with HTTPS/Let's Encrypt and applies the Compose routing labels through a controlled redeploy of the checked-out release. This can restart containers; preserve both volumes and use the recorded deployment operation. DNS records or a successful route-create response alone do not prove the site is live. Wait for DNS propagation, a valid certificate and public site verification.

The agent considers only ordinary `.com`, `.fun`, `.xyz` and `.ai` registrations. Premium names, TLD eligibility failures and orders above the registrar's $100 API order limit are rejected. The actual quoted total includes the registry's minimum term, which can exceed one year. The agent chooses what is affordable from available funds after committed expenses; the provider's limit is not a per-agent daily budget. It also checks renewal prices, rather than assuming a first-year promotion repeats.

Porkbun crypto checkout uses USDC on Base through Coinbase: $1–$500 per checkout, approximately a 1% processing fee, up to 10 checkouts per day, and approximately 24-hour expiry. The monthly top-up allowance includes recent unpaid checkouts. A bridge receipt alone is not registrar credit: wait for the exact checkout to report `COMPLETED` and `credited:true`. Actual fees and confirmed order costs belong in that coin's ledger. [Official funding flow](https://porkbun.com/llms/guides/pay-with-usdc-x402), [spend limits](https://porkbun.com/llms/guides/spend-limits).

Registrar auto-renew is switched **off** and read back. During the final 30 days before expiry, the worker can plan an explicit renewal against that coin's funds and a current exact-price quote. Renewals cannot rely on an unfunded promise or the account-wide auto-renew switch. Insufficient funds leave renewal pending and the SHEN page available; custom-domain registration is not perpetual. [Registration and renewal contract](https://porkbun.com/api/json/v3/spec).

### Domain recovery

- Back up **both** PostgreSQL and signer SQLite, with their encryption keys kept separately. A PostgreSQL-only restore loses bridge/payment progress; a signer-only restore loses domain reservation and publication identity. Restore a consistent pair, and reconcile in-flight operations before resuming the worker.
- A timeout after registration, renewal, bridge submission or x402 payment is an unknown outcome. Keep the reservation and recorded operation, quote, idempotency key, request/order/checkout IDs and transaction hashes. Do not create a replacement operation simply because its response was lost.
- Porkbun replays an identical POST under the same `Idempotency-Key` for 24 hours. Preserve the original body and first-dispatch timestamp. **Never blindly retry a paid write after that window**, or change its price under the same key. Reconcile ownership/expiry, order records, checkout status and chain receipts first. A later rejection does not prove that an earlier ambiguous attempt never charged.
- A completed purchase with pending DNS/HTTPS needs hosting repair, not another purchase. An unknown Dokploy route creation or redeploy is reconciled against existing routes, deployment status and the public verification endpoint; do not queue repeated deployments blindly.
- Bridge completion, leftover Base USDC, registrar credit and domain ownership are separate states. Preserve funds and evidence in the appropriate state; do not book unconfirmed credit, claim a refund, or move residual tokens between coins without reconciliation.
- The last published SHEN page survives domain delays and failed site revisions. Announce a custom domain only after recorded HTTPS verification. Live funded validation remains an operator release check; the test suite makes no purchases.

Website publishing is a capability the agent may use when it judges the work useful and affordable. Activation does not automatically create a website or buy a domain. The agent can defer either while prioritizing operating costs and other community work, and aims to get the first site underway around $500–$600 in collected fees when remaining operating funds are adequate. This is a soft timing target, not a spending budget or a hard gate. The planner receives verified dispatched BNB fees valued at the current BNB/USD quote; this is explicitly an estimate, not a historical USD receipts ledger. At or above the target it should prioritize the site and explain any necessary delay.

## SHEN allocation, public identity and agent records

Set `SHEN_TOKEN_ADDRESS` to the main SHEN contract on BNB Chain. It is passed to both web and signer; the footer publishes the address with a copy button and BscScan link. The official social link is `https://x.com/shendotnow`. Leaving the address blank displays an unpublished status and prevents protocol purchases, while the 15% allocation remains reserved.

The platform worker, independently of all model decisions, allocates exactly 15% of confirmed Flap marketing-fee dispatches to SHEN. The remaining 85% belongs to the coin agent before its operating costs. Deposits, pending processor fees and trading volume are excluded. Each agent wallet retains its allocation; the system uses that wallet to buy the fixed main SHEN token and then transfers exactly the received tokens to the burn sink. No central collection transfer or agent prompt selects the target or percentage. Gas comes from the remaining operating funds. Ordinary payments, rewards, own-token campaigns and BNB domain bridges cannot consume this reserve.

Protocol purchases require `SIGNER_BUYBACKS_ENABLED=true` and a configured SHEN token supported by the existing Flap V3 native-BNB/Pancake V2 route. Batches start at 0.01 BNB and are capped at 0.1 BNB per campaign. Smaller amounts accumulate; slippage, price-impact and confirmed-balance checks still apply. A blocked quote is not proof of a purchase. Replays retain campaign IDs, exact signed transactions and receipt-bound burn amounts. Unfinished burns require reconciliation before another protocol batch. A burn-sink transfer is not claimed to reduce ERC-20 total supply.

Accounting audits the beneficiary route from launch in bounded 5,000-block chunks and persists progress in the signer volume. Changed routing, fee-counter regression, changed processor, reorganized checkpoints or purchase receipts block spending for reconciliation. Newly upgraded existing wallets are assessed against lifetime verified dispatches; if older spending exhausted the reserved share, they need reconciliation or replenishment before further spending. Preserve the signer volume and do not change the configured SHEN token while a campaign is pending.

Coin pages expose read-only recorded activity and sanitized research sources. The console polls every ten seconds; missing or stale worker heartbeats are marked unconfirmed. It does not expose prompts, credentials, private memory notes or an invented browser recording. Approved plans persist coin-scoped memory; the planner receives recent memory plus separate execution records. Plans are explicitly not treated as execution receipts, and rejected or expired-lease plans cannot write memory.

All five selectable reasoning models use the live OpenRouter catalog for pricing. The picker shows current per-million-token input/output prices; every attributed planner, guard and chat call stores its returned token counts, quoted rates and actual returned cost. Unknown costs remain unknown with a reconciliation status rather than being recorded as free.

The gateway now listens on **3187** internally. Update the Dokploy `gateway` domain container port to **3187** before redeploying this revision. Any existing custom-domain routes still using 80 also need updating to 3187; SHEN refuses conflicting routes rather than silently changing unrelated routing. Public HTTPS remains on the normal port 443.

## Navigation repair and security review — 2026-10-04

Rebuild and deploy the latest commit to repair client navigation. The Node production build must preserve strict client entry signatures: otherwise a dynamically imported navigation module can expose renamed chunk exports, producing `is not a function` failures for links and prefetching. The corrected standalone build was checked in a browser for launch, docs, agents and activity navigation, form steps, model selection and language switching. A page refresh alone cannot repair assets from an older deployment.

Multipart artwork requests are now size-limited while reading the stream, before parsing, including requests without an honest Content-Length. Chat authentication uses the configured public origin behind reverse proxies. The X callback keeps all gateway security headers while retaining its no-referrer policy and disabled access log. New regression cases cover streaming limits and proxy-origin validation; gateway smoke checks cover callback headers.

Security patches update Next, React/RSC, Vite and vulnerable transitive dependencies. As of this review, `npm audit --omit=dev` reports no known advisories for the application or signing-service dependency trees. The full application audit still reports 14 development-toolchain entries, rooted in braces and older esbuild versions used by lint/build/migration tooling. These were not suppressed or addressed with the audit tool's suggested breaking framework downgrades. Do not expose development servers publicly; recheck upstream fixes before updating this tooling. A clean production dependency audit is not proof that all application security issues are absent.

Validation: typecheck, production build and 190 unit/integration tests passed. Local browser checks used no funded wallet or live writes. The local Docker daemon was unavailable, so container-level gateway smoke checks remain for CI/deployment. This review does not replace a funded release check or an independent security audit.

### Diagnosing an X connection that returns without connecting

OAuth failures return to the browser-bound, wallet-owned coin page with a fixed error code and an English/Chinese explanation. Without a matching session/state, the return target is My agents and no private coin identity is disclosed. The web log records only `[SHEN X connection]` and the allowlisted code; never log authorization codes, tokens or provider response bodies. Existing `?x=failed` links display a generic retry notice.

`oauth_client` means check the confidential X app's OAuth 2.0 Client ID/Secret; `token_exchange` means check those settings and the exact callback `https://shen.now/api/social/x/callback`; `permissions` means X did not return required scopes/refresh access; `profile_access` means X denied the authenticated `/2/users/me` read; `credits` means X returned HTTP 402; `rate_limited` means HTTP 429. `browser_mismatch`, `expired` and `session_required` require a new Connect X flow in the same signed-in browser. `server_error` means investigate server-side storage/encryption configuration. Rebuild and deploy this revision to see these diagnostics; do not replay a previously consumed authorization code or disable the ownership/PKCE checks.


Token launch readiness checks the dedicated signing service and BNB Chain, independently of agent activation. Missing worker heartbeats, provider credit or optional X/research/image capabilities do not block token creation. Wallet ownership, authorization, metadata validation, contract preflight and receipt verification still apply. The worker continues enforcing provider availability, credit reservations and treasury funding before acting. X can be connected before or after launch for coins with community updates enabled.

If Connect X fails before leaving the coin page, the start handler now identifies failures in credit verification, credential encryption or database storage. An X credit-check HTTP 401 means check X_API_BEARER_TOKEN (the app Bearer Token, not Client Secret); 403 means X denied balance access; 402 or a zero balance means replenish X developer credit; 429 means wait for the rate limit. The web log records only the stage and HTTP status, without tokens or provider bodies. OAuth Client ID/Secret errors after authorization remain separate callback diagnostics.

### Launch threshold and optional developer buy

Redeploy the complete compose stack (web and signer) for developer-buy support. Migration 0021 adds default-zero initial_buy_wei columns without changing existing drafts. Flap BNB tax V3 launches use dexThresh=1 (FOUR_FIFTHS), per https://github.com/flap-sh/flap-skills/blob/main/launch-bnb-token-on-flap/references/construct-tx.md. Read-only BNB mainnet calls reproduced InvalidDexThresholdType for 0 and passed with 1 on 2026-10-04. Both zero-buy and 0.025 BNB buy calls passed; the latter used a temporary balance override inside eth_call. No transaction was broadcast and no funds were spent.

The optional buy is selected in BNB on the coin launch panel, bound to the signed authorization and persisted as exact wei. It is included in quoteAmt and msg.value. Confirmation checks the saved amount and calldata; the signer separately verifies matching value/quoteAmt and permanent fee routing. Purchased tokens go to the developer wallet. The launch panel checks available BNB for the buy plus estimated gas. Revalidate any plan prepared before this upgrade.

The same panel accepts an optional coin announcement tweet URL without X OAuth. Valid X/Twitter post links are normalized to x.com, bound to the authorization, sent as Flap metadata's twitter link, and displayed on the coin page after confirmation. Migration 0022 adds default-empty tweet_url columns for saved authorizations and plans. This links an existing post; it does not publish a tweet.

After the wallet submits a launch, the open coin page automatically verifies the saved transaction every five seconds and switches to the launched view once confirmed. Pending receipts return HTTP 202; reverted receipts, ownership failures and mismatches stop the loop. Temporary connection/service failures receive bounded retries. Refreshing the same browser tab resumes verification from session storage. After prolonged waiting or repeated failures, Retry verification checks the existing hash without submitting another transaction. Redeploy web for this change; no new database migration or signer change is required.

Coin pages now embed GMGN's documented BSC chart at `https://www.gmgn.cc/kline/bsc/{tokenAddress}?theme=dark&interval=5`. Redeploy gateway as well as web: the gateway CSP allows frames from that specific origin. No API key is needed for the embed. Chart availability and new-token indexing depend on GMGN; the page offers reload and direct-open links. Directory mini-charts and the agent's internal market inputs still use the existing market-data pipeline. Reference: https://docs.gmgn.ai/index/cooperation-api-integrate-gmgn-price-chart

The coin-page treasury metric reads `/api/coins/{id}/balance` independently of agent worker/provider readiness. The public endpoint only accepts launched coin IDs and derives the wallet from the saved launch; it reads BNB Chain at head minus three blocks, coalesces reads for 15 seconds, and never authorizes spending or changes agent state. The page refreshes after each read, displays six decimal places and observation time, and preserves the last known value with an error label on RPC failure. This fixes a zero snapshot persisting when the worker cannot start. Directory snapshots and operating-state decisions remain worker-managed. Redeploy web; no new environment variables or migration are required.

Testing activation threshold: the platform default is now 0.01 BNB. Migration 0023 updates existing drafts and launched coins to the same threshold on deployment. This only lowers the activation balance check; service credit, gas reserves and provider-readiness checks still apply. Revalidate unsubmitted launch plans after the configuration migration.

Agent wallet/funding checks are scheduled 30 seconds after an unfunded check and 60 seconds after a funded check. Paid planning retains its separate agent-selected interval; a failed paid attempt waits at least 15 minutes before another attempt. Migration 0024 brings existing wallet checks forward while preserving prior planning schedules. The worker polls every 15 seconds; busy cycles and upstream latency can delay execution beyond the scheduled time. Redeploy web and worker together.

Migration 0025 records each worker check's completion time and outcome. The console no longer treats a page refresh as a worker check or an unobserved saved zero as proof of insufficient funds. The signer reports the observed wallet balance separately from fee-accounting readiness; unavailable reserves are null, and the worker blocks paid work until they are verified. Redeploy web, worker and signer together. Console states distinguish historical-state errors, log-range limits, fee-audit catch-up, unavailable wallet checks, and service-funding blockers without exposing RPC credentials.

The BNB RPC must support historical `eth_call` at the token's launch block and fee-audit checkpoints, plus `eth_getLogs` ranges up to 5,000 blocks. QuickNode documents only a five-block range on its Free Trial plan, versus 10,000 on paid plans: https://www.quicknode.com/docs/bnb-smart-chain/eth_getLogs. A successful current-balance read does not establish that these historical calls are supported. Configure an endpoint with both capabilities in web and signer; do not bypass the fee audit or assume an unknown reserve is zero.

## Agent work loop and research browser

Funded agents use a one-minute baseline after a completed plan. The interval grows with observed total planning/research/review cost so remaining credit targets roughly six hours of work. This is a target, not a guarantee of credit lifetime or a one-minute start-to-start SLA. Queued jobs, service outages and unresolved cost receipts still gate work. Confirmed or failed publications and significant fresh market changes can wake an approved slow plan after a minimum minute; rejected plans retain their bounded retry backoff. SHEN's fee routing, BNB activation, visitor Q&A, service payment and signer policies remain in place. No low-trading-income hard stop was added.

Within a cycle the model can choose up to two read-only tool steps (search or browser), inspect the results, then submit a final plan for the independent guard. Worst-case costs are reserved first; insufficient credit reduces the tool allowance. Identical searches within an hour reuse actual recorded results. Tasks persist across cycles; marking a task complete requires a successful receipt from the same coin. Spending targets sum to 100% but are advisory allocations of agent funds, not automatic payments or replacements for platform fee routing.

To enable page captures, set one new Dokploy variable, `BROWSER_TOKEN`, to a unique random secret of at least 40 characters (for example, generate 32 random bytes with `openssl rand -hex 32`). Compose supplies the internal browser URL and the same dedicated token to web and browser. Redeploy the complete stack so the new browser image and SQL migrations are included. No public port or domain is needed for this service. Do not reuse a signer or wallet credential. Without this variable, ordinary search and other work continue, but browser capture stays unavailable.

The browser runs Chromium as a non-root user with its sandbox enabled, the checked-in Playwright seccomp profile, a read-only filesystem, a 1 GiB memory limit and separate control/egress networks. It has no wallet keys, model keys, authenticated sessions or writable application storage. The host must permit unprivileged user namespaces; if sandbox startup fails, health remains unavailable instead of launching without a sandbox.

Page JavaScript, service workers, forms, downloads and non-GET requests are disabled. Every resource is fetched through DNS-validated, IP-pinned public HTTP(S) requests; private addresses and credential-bearing URLs are blocked, including redirects. The planner may only open URLs in this coin's recorded search sources. Script-only sites and some protected pages will be unavailable. Each visit records up to three real viewport captures and an extracted text excerpt. The UI replays those captures; it is not an interactive remote desktop or continuous live video. Frames are retained for the latest ten visits per coin, while older visit metadata remains.

Local tests exercise the real Chromium capture against public pages and mocked model/provider flows without funded actions. The Docker image and Linux sandbox must also be checked after deployment, especially on hosts that restrict user namespaces.

The checked-in browser seccomp profile comes from the [Playwright v1.63.0 Docker configuration](https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/seccomp_profile.json).
