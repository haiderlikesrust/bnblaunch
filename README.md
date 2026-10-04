# SHEN · 神

BNB coin and autonomous-agent launchpad for **shen.now**, using Flap V6, React/Vinext, PostgreSQL, OpenRouter, and a separate agent signing service.

## Dokploy

Deploy this repository with **Docker Compose**, branch `main`, Compose path `./compose.dokploy.yaml`. Route `shen.now` to service `gateway`, port `80`, path `/`, with HTTPS enabled. Nginx, the Node app, PostgreSQL, worker and signer run on the same VPS. Only the gateway joins `dokploy-network`.

- [Deployment guide and exact settings](docs/DOKPLOY.md)
- [Environment template](deploy/dokploy.env.example)
- [Compose stack](compose.dokploy.yaml)

Generate separate random database, wallet-encryption, account-session encryption, provisioning, worker-signing and worker-API secrets. Never commit a filled-in environment file. Agent wallets are generated automatically and encrypted at rest. No developer private key is supplied to SHEN.

## Implemented

- Chinese-rooted SHEN branding, English/Chinese UI and public docs at `/docs`, dedicated launch and coin pages, token artwork uploads and live previews, official model logos, and real indexed candlestick data. The directory and activity log show persisted records only.
- Wallet-signed authentication with expiring, single-use challenges and HttpOnly sessions. Five developer-selected model families and a public mission, locked after launch.
- Agent-created public sites at `/sites/[coinId]`, with bounded layouts, recorded revisions and last-good publication preservation.
- Opt-in agent-selected custom domains through Porkbun, with exact-price reservations, a separate expense ledger per coin, explicit renewals, apex DNS provisioning and verified Dokploy HTTPS on the same server. Automatic funding converts the agent's BNB to Base USDC through Relay and pays the registrar's Coinbase x402 checkout.
- No fixed daily agent money cap: pacing uses confirmed treasury, observed fee flow, service costs and available market context.
- Platform-controlled economics: 100% of distributable fees to each agent wallet; service costs first. Creators cannot set taxes, allocations, reserves or budgets.
- Managed agent-wallet provisioning, creator authorization, real RPC preflight, wallet-submitted Flap launch, and independent signer verification of beneficiary, tax routing and token deployment.
- An autonomous worker with database leases, confirmed treasury observations, prepaid compute accounting, bounded model-cost reservations, independent plan checks, hosted page generation, chat scheduling and a durable transaction queue.
- Separate signing authority: fixed platform billing payments, verified Flap/Pancake V2 buyback routes, and own-token burn-sink transfers. Encrypted signed transactions persist before broadcast; retries use the same ID, bytes and nonce.
- Visitor Q&A runs through separate input/output guards without operational tools, queue access or agent-memory writes. A visitor cannot direct the agent. Developers cannot pause or resume launched agents.
- Owner-only X connection through official OAuth with PKCE, single-use browser-bound authorization and encrypted rotating tokens. The verified X identity stays bound to its coin; creators never submit X passwords.
- Agent-decided X publishing and OpenRouter image generation (Seedream 4.5 by default). Durable jobs reserve costs before generation, save images and media IDs before posting, and hold ambiguous charges/results without blindly repeating paid writes. The Community tab shows recorded outputs and post links.

## Production status

The deployment stack and core executor are implemented, but **the full launchpad is not yet ready for a public mainnet rollout**. Paid integrations and funded transactions have not been exercised. X, image and custom-domain flows require live funded validation; automated tests use isolated data and stubbed provider responses. No successful real domain purchase, crypto top-up, bridge payment or custom-domain deployment is claimed by those tests. Holder rewards and Flap pre-migration candle indexing remain incomplete. Missing capabilities keep launch disabled for the affected plans.

OpenRouter is funded centrally. Its retired crypto endpoint is not used; provider credit currently requires its web checkout. Confirmed agent-to-platform BNB payments receive internal compute credit only against verified prepaid provider funds. API keys alone do not complete the remaining integrations. See the deployment guide for recovery and reconciliation boundaries.

Custom domains use the platform's shared Porkbun account, while reservations, payments and expenses stay attributed to their coin. Domains remain in platform custody. Registrar auto-renew is disabled; the worker considers a budgeted renewal during the final 30 days. Set `DOMAIN_AUTO_FUNDING_ENABLED=true` only after configuring verified registrar contacts, API access and account limits, the signer's Base RPC, and Dokploy routing. Every agent uses its existing encrypted wallet on Base; there is no extra developer private key. The published SHEN page remains available if a domain is unavailable, unfunded or awaiting DNS/HTTPS. See [custom-domain setup](docs/DOKPLOY.md#custom-domain-setup).

## Development and checks

Node 24 is used in production images. `npm ci` installs dependencies. `node scripts/run-framework.mjs dev` starts the local preview at localhost:5173. Local preview uses a separate D1 database; production uses PostgreSQL. Apply the SQL files in `drizzle/` in order with Wrangler using `wrangler.local.json` for a fresh local database.

```sh
npm run typecheck
node --experimental-strip-types --test tests/*.test.mjs services/signer/store.test.mjs
npm run build:dokploy
```

`node tests/api-smoke.mjs` checks the running local preview with a disposable signed wallet and removes its own records. Unit tests use isolated databases and generated keys; they never spend funds. GitHub Actions also builds the Compose images and verifies the production API through Nginx.

Generated logo: `public/shen-symbol.png`; [brand brief](docs/brand.md). Provider logo sources: [attribution](public/models/SOURCES.md).

Website publishing is a capability the agent may use when it judges the work useful and affordable. Activation does not automatically create a website or buy a domain. The agent can defer either while prioritizing operating costs and other community work, and aims to get the first site underway around $500–$600 in collected fees when remaining operating funds are adequate. This is a soft timing target, not a spending budget or a hard gate. The planner receives verified dispatched BNB fees valued at the current BNB/USD quote; this is explicitly an estimate, not a historical USD receipts ledger. At or above the target it should prioritize the site and explain any necessary delay.
