# Deploy SHEN at shen.now

This follows Grailshot's deployment pattern: a Git-backed **Docker Compose** service, multi-stage Dockerfile, standalone Node app, PostgreSQL 17, Nginx gateway, and Dokploy Traefik for HTTPS. SHEN adds an always-running worker and a separate signer. Only the gateway joins `dokploy-network`; no app, database, worker, or signer ports are published.

## Dokploy settings

1. Create a Docker Compose service from `https://github.com/haiderlikesrust/bnblaunch`, branch `main`.
2. Set **Compose Path** to `./compose.dokploy.yaml`. Use Docker Compose, not Swarm/Stack. Repository root is the app folder.
3. Paste [`deploy/dokploy.env.example`](../deploy/dokploy.env.example) into **Environment** and replace the required values below. Keep `APP_ORIGIN=https://shen.now`, without a trailing slash.
4. Point the DNS A record for `shen.now` to your VPS IP. Configure an AAAA record only if the VPS has working public IPv6.
5. Add a Dokploy domain: **Host** `shen.now`, **Service** `gateway`, **Container port** `80`, **Path** `/`, HTTPS and Let's Encrypt enabled. The Compose file already joins the gateway to `dokploy-network`.
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
| `SIGNER_SETTLEMENT_ADDRESS` | Your platform's dedicated **public BNB billing address** | web, signer |

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
| `TWITTERAPI_IO_KEY` | Funded TwitterAPI.io provider key; creators connect their own project accounts on coin pages |
| `TWITTERAPI_IO_PROXY` | Residential HTTP(S) proxy URL with authentication, used server-side for X login, media upload and posting |
| `X_LOGIN_DAILY_LIMIT_MICROUSD` | Platform-funded onboarding cap; template `1000000` = $1/day, with a separate three-attempts/hour owner limit |
| `X_POST_COST_MICROUSD`, `X_UPLOAD_COST_MICROUSD` | Contracted cost of posting/uploading; templates `3000` each ($0.003). Update if the provider changes rates. |
| `X_READ_COST_MICROUSD` | Per-reconciliation-read reservation ceiling; template `5000`. Settlement uses the current adapter rate of 150 micro-USD per returned tweet, minimum one. Revalidate this rate before production. |
| `OPENROUTER_IMAGE_MODEL` | Default `bytedance-seed/seedream-4.5`; also supports `bytedance-seed/seedream-5-0-flash`. The worker verifies a live fixed per-image quote before reserving funds. |
| `PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY` | Domain provider account; unattended purchase/DNS is not enabled yet |
| `RELAY_API_KEY` | Relay access, if required for your account; automatic provider funding is not enabled yet |

The template leaves visitor Q&A disabled until its separate allowance is configured. Agent operations have no daily monetary ceiling and require funded provider accounts plus available per-coin credit. None of these policy fields is exposed to coin developers. Developer language, mission and model choices are saved at creation and do not grant signing permissions.

## Current operational boundary

The worker implements confirmed treasury observation, central-compute collateral reservations, confirmed BNB service-payment reconciliation, metered model planning with an independent guard, generated community pages, autonomous chat closure, and a durable transaction queue. The signer implements fixed-recipient compute payments, supported Flap/Pancake V2 buybacks, and transfers of the agent's own token to the burn sink. Burn-sink transfers are not represented as proof of a reduction in total supply.

**This is not a completed public mainnet rollout.** Live provider billing and funded transactions have not been exercised. X account onboarding, image generation and publishing are implemented with fault-tested reservation and recovery paths, but require funded integration validation. Holder distribution, domain purchase/DNS automation, and Flap pre-migration chart indexing remain incomplete. Launch readiness refuses selected capabilities that the worker does not support; setting API keys cannot override that check. Unknown provider charges retain credit reservations and require reconciliation rather than being refunded as zero.

## X and image setup

Fund the platform's TwitterAPI.io and OpenRouter accounts, set the X key/proxy and the separate session encryption key, then configure the X onboarding allowance. For each coin with community updates, its creator connects an existing X account on the private coin page. The form explicitly authorizes one public verification post. SHEN confirms its immutable author ID before binding the account. Passwords and TOTP setup secrets are not persisted. The same X identity can refresh an expired session; it cannot be swapped for another account after binding. SHEN does not create X accounts.

After confirmed launch and funding, a guarded agent plan can enqueue text, an image post, or gallery artwork. A job reserves the image quote and applicable X charges against its coin's available operating credit. Image generation uses the same OpenRouter account as reasoning, with a pinned supported image provider, one 1K square image per job, and actual response cost settlement. Completed gallery images and confirmed X posts appear in the Community tab. Pending results are visibly marked.

The queue limits publishing to one job per hour and eight per rolling day per coin. It persists each write's state before calling a provider. A timed-out X post is checked against the expected author, content, time and attachment identity; missing evidence is held for review. Generation/upload timeouts and unknown billing also hold reservations. There is no automatic retry of an ambiguous paid write or public-post control for creators. Verify provider records before any manual reconciliation.

OpenRouter's previous crypto API now returns 410. Its current credit purchase flow is through its web checkout. Receiving a coin's BNB payment in the platform wallet does **not** mean OpenRouter has been funded; the internal ledger only credits payments against verified existing provider collateral. TwitterAPI.io crypto top-up also requires its provider checkout unless a supported automated flow is added.

## Persistence and recovery

- `shen-postgres` stores launch plans, sessions, agent state, paid-call reservations, funding receipts and operation IDs.
- It also stores encrypted X sessions, publication state and generated images. Back up `SERVICE_CREDENTIALS_KEY` separately; changing it without migrating sessions prevents existing agents from posting.
- `shen-wallets` stores encrypted agent keys and encrypted signed transactions. Back up this volume and the master key separately. Use SQLite's online backup API or stop the signer briefly for a consistent backup; copying only the live main SQLite file omits its WAL.
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

References: [Dokploy Compose](https://docs.dokploy.com/docs/core/docker-compose), [domain routing](https://docs.dokploy.com/docs/core/docker-compose/domains), [OpenRouter images](https://openrouter.ai/docs/guides/overview/multimodal/image-generation), [TwitterAPI.io contracts](https://docs.twitterapi.io/api-reference/openapi.json), [OpenRouter crypto funding status](https://openrouter.ai/docs/cookbook/administration/crypto-api).

## Agent websites and spending

The worker creates the initial website during a funded, approved planning cycle and publishes it at `https://shen.now/sites/<coin-id>`. The same gateway and app serve these pages; no additional DNS, hosting key or deployment per coin is needed. Revisions are persisted in PostgreSQL, committed under the worker lease and shown in the coin’s Website tab. Failed or rejected updates retain the last published revision. Existing `/coin/<coin-id>` links redirect after publication.

Agent operations have no fixed daily monetary cap. The removed `AGENT_DAILY_LIMIT_MICROUSD` and `SIGNER_DAILY_SPEND_BPS` variables are ignored and can be deleted from saved environments. Confirmed spendable funds, gas, per-call reservations, provider collateral and transaction validation still apply. Visitor Q&A and X onboarding retain their separate limits. Pacing uses market cap, liquidity, volume, recent settled service costs and observed fee-distribution rates. FDV is kept distinct from market cap; missing/stale data remains explicit. Fee history starts from a baseline, excludes deposits and pending fees, and resets after routing changes, reorganizations or observation gaps beyond the bounded verification window.

Custom-domain purchase, renewal, automatic registrar funding and domain/HTTPS provisioning remain unimplemented. Porkbun API keys alone do not activate them. The current BNB-only signer cannot execute Base USDC/x402 payments or bridge requests. A shared registrar account can be funded through crypto checkout, but that does not by itself wire domain purchases into the agent.
