# Changes by Claude — 2026-10-04

Everything Claude changed in this repository during this session, why, and how it was checked. This is the original session record from base commit `cc168f8`; the review below overrides conflicting descriptions later in this file.

## Review corrections before push

The requested review retained the launch flow, optional influencer, chat readiness, browser recovery and authentication fixes, with these corrections:

- Removed exponential 15-minute to six-hour planning backoff. Funded planning stays at a one-minute baseline, bounded to five minutes when credit is low or failures repeat. Previously saved longer planning waits are shortened once on the next worker check.
- Removed the newly introduced 25% per-operation, 50% daily, one-operation-per-hour and 50% token-burn caps. Existing balance, gas, SHEN allocation, authorized-recipient, transaction review and publication protections remain.
- Ran content and influencer processing alongside planning, with at most one active worker pass for each. Active media reservations no longer prevent independent planning.
- Preserved unverified provider charges as separate reserved liabilities, rather than claiming the maximum allowance was actually spent. Verified expenses alone enter spending totals; the unused allowance is refunded. Planning and other content can use remaining credit. Unknown posts are never blindly resent.
- Kept a slow accepted Higgsfield generation on its original request ID. Unknown custom-reference creation and X upload outcomes are held separately instead of purchasing duplicates. Generation retries use the documented generation idempotency key; this guarantee is not assumed for custom-reference creation.
- Restored the 60-second model-call timeout to fit the worker lease and kept URLs, identifiers and financial values intact when shortening planning context.
- Included the separately authorized, preview-first MARTIAN fee-recovery CLI and tests. No live recovery was executed.

Validation after review: 329 automated tests pass, including SQLite/PostgreSQL lifecycles, planner cadence, independent work during pending media, unknown-charge conservation and recovery replay protection. TypeScript passes. The Dokploy production build passes. Docker sandbox startup and live paid-provider behavior require deployment verification; neither was tested against production here.

## Original session verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Pass |
| `node --experimental-strip-types --test tests/*.test.mjs services/signer/*.test.mjs` | **318 / 318 pass** (baseline before changes: 279 / 279) |
| `npm run build:dokploy` (production build) | Pass. The new routes and UI are present in the bundles, and a grep of the client bundles found no server secrets. |
| ESLint on every modified/new file | 10 errors, all patterns that already existed in the original files (the original versions of those files had 11). |

Not verified: the UI was **not** viewed in a browser. The local dev server depends on the original hosting tool's preview environment (`virtual:sites-connector-preview`), which isn't available on this machine, and Docker Desktop wasn't running to provide PostgreSQL for the production server. Live, funded, paid provider calls (Higgsfield, X, OpenRouter, BNB mainnet) were not made; tests use stubbed providers.

---

## 1. Feature: one-step launch (drafts removed)

Before: the create form saved a private "launch plan" (draft). You then opened the coin page and ran a separate validate → review → sign flow.
Now: you fill in the form and launch immediately. The coin is created when you press **Launch on BNB Chain**, and the wallet launch runs in the same screen.

| File | Change |
| --- | --- |
| `components/create-launch.tsx` | Rewritten as 4 steps: Identity → Agent → Influencer → Launch. The Launch step has the coin tweet URL, developer buy, economics/tax disclosure, a live progress list (connect & sign in → create coin → sign authorization → pin metadata → validate → approve in wallet → confirm), and the predicted token/agent wallet. It signs in inline if needed and switches the wallet to BNB Chain. A retry with unchanged inputs reuses the same coin (fingerprinted in sessionStorage), and a pending transaction resumes confirmation instead of launching again. Navigation is latched after success, so a double click can't create a second coin. The token image is required in step 1. Storage access is guarded. |
| `lib/launch-flow.ts` (new) | Shared client launch sequence: `readyWallet`, `prepareLaunch`, `sendLaunch`, `launchStatus`, `recordSubmission`, plus sessionStorage helpers. |
| `components/flap-launch.tsx` | Rebuilt as a translated **Finish launch** panel for unlaunched coins. It's one click (no separate validate/review), and it auto-resumes a pending transaction found server-side or locally. It accepts a replacement transaction hash if the wallet sped up or re-sent the transaction, and after a final error (reverted or mismatched) it lets you start over instead of staying stuck. |
| `app/api/coins/[id]/launch/route.ts` | New `submitted` action records the wallet's transaction hash before confirmation. GET reports `launched` and a live `pending` submission; reverted or dropped (>15 min) submissions no longer block. `authorize` refuses to prepare a second launch while a submitted one can still land. `confirm` detects replaced transactions (`transaction_replaced`), compares calldata case-insensitively, and moves the influencer from `pending_launch` to `awaiting_x`. |
| `lib/launch-validation.ts` | New `launchTransactionState()`: success / reverted / pending / missing / replaced. |
| `lib/launch-confirmation.ts` | Typed `LaunchConfirmationError` (status, code, final flag); `anySignal`/`timeoutSignal` fallbacks for browsers without `AbortSignal.any`/`timeout`. |
| `app/api/coins/route.ts` | Stores the influencer config; caps unlaunched coins per wallet at 10 per 24 h; "My agents" lists only launched coins and coins that reached a prepared launch (abandoned attempts are hidden); event text updated. |
| `lib/signer.ts` | `launchReadiness` reports "already launched" for launched coins. |
| `components/token-view.tsx` | Passes `t` to the launch panel; "NOT LAUNCHED" label; X connect panel shown only after launch. |
| `lib/ui.ts` | The `draft` state is labelled "Not launched". |
| `components/shen-docs.tsx` | Launch guide rewritten for the one-step flow, with an AI influencer step; FAQ/status wording updated; threshold FAQ now reads the configured value (it was hardcoded "0.1 BNB", the real value is 0.01); influencer capability entry; English buyback note matches the Chinese text. |

## 2. Feature: optional AI influencer (Higgsfield)

Modelled on AgencyPad's influencer section. It's opt-in at launch (Skip / Enable). Creators customise the character; after launch, once the coin's X account is connected, the character posts videos, selfies and photos on that X account by itself.

**How it works**
1. Character design: Higgsfield **Soul 2** draws a full-body master from the brief (palette sampled from the coin logo for "Match the logo"). A **Soul ID** custom reference is trained from that master. With an uploaded reference image, the identity is trained on the reference first and the master is drawn from it.
2. Posts: on an adaptive schedule (`INFLUENCER_DAILY_POSTS`, ±25% jitter), the coin's own model writes the scene, motion and caption in the character's voice. An independent guard model reviews it, and deterministic caption checks enforce the X limit, no links, no @mentions, ≤2 hashtags, and only the coin's own cashtag. Soul 2 then renders the image with the trained identity. Video posts animate it with Kling 3.0 (or Seedance 2.0). The result is uploaded to X (chunked upload for video) and posted.
3. Money: every paid step reserves the coin's service credit up front in `agent_runs` (so platform liability accounting stays correct) and settles exactly once, fenced by row versions. Failed or declined generations aren't charged. Higgsfield submissions retry only with the same `Idempotency-Key`. A lost X reply is reconciled from the timeline and never re-posted; after 3 unmatched reads it settles as published, so credit is never held forever. A floor (`INFLUENCER_CREDIT_FLOOR_MICROUSD`) protects the planner's budget, and the planner tops up service credit for the influencer when the treasury is funded.
4. Safety: the character is always an adult, fictional and AI-generated, never impersonates real people, and gives no financial advice. A reference image needs a rights/consent checkbox and stays private (owner-only).

| File | Change |
| --- | --- |
| `drizzle/0031_ai_influencer.sql` (new) | Tables `influencers`, `influencer_posts`, `influencer_assets`; `prepared_launches.submitted_hash/submitted_at`; `launch_authorizations.metadata_cid`; indexes `events(coin_id,created_at)`, `agent_operations(coin_id,created_at)`. Verified on SQLite and PostgreSQL. |
| `lib/influencer-options.ts` (new) | Character option groups (character, presents as, age, build, hair, outfit, features, accessories, vibe, visual style) with EN/中文 labels; Zod `influencerInput`; brief builder; colour naming. |
| `lib/influencer-policy.ts` (new) | Writing/review rules, script schema, caption checks, prompt builders, platform rates from env. |
| `lib/higgsfield.ts` (new) | Higgsfield API client: submit/poll, Soul ID create/status, presigned upload (credentials never sent to storage), bounded media download with per-hop redirect validation and SSRF-safe URL checks, typed rejected/pending errors, Soul 2 and video model bodies. |
| `lib/influencer-runtime.ts` (new) | The state machine (character + posts), reservations/settlement, X reconciliation, stale-claim recovery, planner funding estimate, and a public status projection with no provider IDs or URLs. |
| `lib/x-official.ts` | Chunked video upload (initialize/append/finalize) and media status polling; empty-body tolerant requests. |
| `app/api/coins/[id]/influencer/route.ts` (new) | GET status (public after launch, owner before); POST reference upload/clear (owner, before launch). |
| `app/api/coins/[id]/influencer/assets/[assetId]/route.ts` (new) | Serves master/post images; the reference image is owner-only. |
| `components/influencer-setup.tsx` (new), `lib/logo-palette.ts` (new) | AgencyPad-style customisation UI (Skip/Enable, Connect X note, reference upload with consent, option chips, notes, live brief); logo colour sampling. |
| `components/influencer-panel.tsx` (new) | Token page "Influencer" tab: status, character master, brief, posts with "View on X". |
| `components/token-view.tsx`, `components/token-card.tsx` | Influencer tab and capability tile; card icon. |
| `lib/model.ts`, `lib/policy.ts` | `influencer` field on coins; `creatorFields` + `influencerNeedsX` (the influencer requires community updates on X). |
| `app/api/internal/worker/route.ts`, `services/worker/index.mjs`, `services/worker/request.mjs` | New worker action `influencer` (failures never stop agent planning; 300 s timeout; health check covers the stage). |
| `lib/runtime.ts` | `influencer-media` capability; influencer reservations don't block planning; funded top-ups include the influencer's next spend without ever blocking planning. |
| `lib/content-runtime.ts` | Content reservations don't wait on influencer holds. |
| `lib/chat-completion.ts` | Influencer calls are labelled; see also §4. |
| `app/api/platform/route.ts` | Publishes `influencer: {available, dailyPosts, videos}`. |
| `app/globals.css` | Styles for the influencer UI and the launch progress list. |
| `cloudflare-env.d.ts`, `compose.dokploy.yaml`, `deploy/dokploy.env.example`, `.env.example`, `README.md` | New `HIGGSFIELD_*` / `INFLUENCER_*` settings documented and passed to the web service. |

## 3. Security fixes

| Severity | Issue | Fix | Files |
| --- | --- | --- | --- |
| High | **Open redirect after sign-in**: `/signin?return_to=/.//evil.com` sent freshly signed-in users to `https://evil.com` (confirmed with Node's URL parser). | Navigate to the absolute same-origin `href`. | `app/signin/page.tsx` |
| High | **Sign-in lockout**: anyone could fill the global cap of 1000 challenges (blocking every login) or a wallet's cap of 5 (blocking one user). | Expired challenges purged; a wallet's oldest pending challenge is evicted instead of refusing; global cap 20000; proper 400/429/401 errors; per-IP gateway rate limit on sign-in POSTs (real client IP behind Dokploy's proxy). | `lib/auth.ts`, `app/api/auth/route.ts`, `deploy/nginx.conf`, `lib/app-error.ts` (new), `lib/server.ts` |
| High | **Prompt-injected treasury drain**: a ranked web page could talk the planner into a whole-treasury payout, a full burn, or a phishing link from the official account; only model judgment stood in the way. | Code-enforced pacing, as shares not fixed sums: one treasury operation per hour; each BNB operation ≤ 25% of available; ≤ 50% per rolling 24 h; a burn ≤ 50% of holdings. X posts may only link to SHEN, X, BscScan or Flap. The limits are shown to the planner in its context. | `lib/runtime-policy.ts`, `lib/runtime.ts`, `lib/content-policy.ts`, `lib/plan-diagnostics.ts` |
| High | **Double launch**: a submitted transaction was saved only in one tab, so a reload or another device could launch a second token (second gas + dev buy). | Server-recorded submissions and an in-flight guard (§1). | launch route, `lib/launch-flow.ts` |
| Medium | **Client-chosen metadata CID**: a creator could self-pin metadata (any website, links or art) and launch with it, bypassing SHEN's metadata. | The metadata route requires a live authorization and binds the CID to it; `prepare` rejects any other CID. | `app/api/coins/[id]/metadata/route.ts`, launch route |
| Medium | **Domain bridge trusted Relay's price**: the only bound on BNB paid for USDC was the agent-chosen `maxBnbWei`. | The signer checks Chainlink BNB/USD before quoting and before signing (≤ fair price + 8% + $1); a stale feed blocks signing. | `services/signer/domain-funding.mjs` |
| Medium | **Platform 401 revoked users' X**: a 401 on the app bearer token was treated as the owner revoking access. | Only user-token 401s revoke. | `lib/x-official.ts` |
| Medium | **Free X-connection abuse**: the paid X credit check ran before any limit, and draft coins cost nothing. | Limits are checked first; per-wallet daily cap of 10; X can be connected only after launch. | `lib/social-onboarding.ts`, `app/api/coins/[id]/social/route.ts` |
| Medium | **Draft spam**: unlimited coins, signer wallets and uploads per wallet. | 10 unlaunched coins per wallet per 24 h. | `app/api/coins/route.ts` |
| Low | AES-GCM tag length not enforced in the signer (truncated tags accepted). | 16-byte tag and 12-byte IV required. | `services/signer/store.mjs` |
| Low | Signer master key stayed in the process environment. | Deleted from `process.env` after loading. | `services/signer/index.mjs` |
| Low | RPC API keys could reach web logs via viem error messages. | Log error names only. | `lib/server.ts` |
| Low | `APP_ORIGIN` with a trailing slash rejected every POST; the SIWE message used a non-checksummed address. | Normalised origin; EIP-55 address. | `lib/auth.ts` |
| Low | A lagging RPC could hand the bridge an already-used nonce ("nonce too low" was then treated as success, hanging forever). | Nonce must exceed every nonce the journal recorded; a consumed nonce fails the job after 10 minutes without moving BNB. | `services/signer/domain-funding.mjs` |

## 4. Bug fixes

| Issue | Fix | Files |
| --- | --- | --- |
| **Publications stuck in `uncertain` forever** (the "old stuck publication" with reserved credit): definite X rejections were treated as uncertain; jobs that failed before posting were never re-selected; a single bad read burned all attempts; nothing ever settled after 3 unmatched reads; claim and `posting_at` were separate writes. The coin could then never publish again. | Every uncertain job now reaches a final state: a known tweet ID completes it; a crash before posting settles the stage's reserved cost; a possible post is matched on the timeline (since posting, or since creation for legacy rows), then settled as published after 3 reads. Definite 4xx responses fail with no post or upload charge. Claim and `posting_at` are one update. Nothing is ever re-posted. **Your existing stuck job will resolve on its own after deploy.** | `lib/content-runtime.ts`, `lib/content-policy.ts`, `lib/x-official.ts` |
| **Planner froze a coin permanently** after any provider error (402/429/5xx/timeout/Brave failure) once credit was reserved. | Settles instead: an HTTP refusal is unbilled, an unanswered call is charged its reserved ceiling, then a 15-minute cooldown. The failing stage is kept in `last_reason`. Planning timeout raised from 60 s to 90 s to fit its 8192-token budget. | `lib/runtime.ts`, `lib/server.ts` (`ProviderHttpError`), `lib/chat-completion.ts`, `lib/plan-diagnostics.ts` |
| **Planner input limit could become impossible to meet** (growing tasks, memories, missions), stopping the agent permanently. | Last-resort shortening of long prose and lists until it fits; financial values preserved. | `lib/planning-context.ts` |
| **Chat stuck on "resting"**: the platform cap default of 0 (needs setting, see Operator actions); every approved plan closed chat (the planner never sees chat); a treasury-threshold gate closed chat after the first top-up; cadence came from 24 h of top-ups (about 3 min/day for well-funded coins); the cap was validated differently in two places. | Planner closures removed (stale ones cleared); prepaid credit gates chat; cadence uses a 7-day funding average; one cap validator; staleness 2 h → 6 h; per-wallet (30) and per-coin (240) daily question caps. | `lib/chat-schedule.ts`, `lib/chat-availability.ts`, `lib/chat-meter.ts`, `app/api/coins/[id]/chat/route.ts`, `lib/runtime.ts`, `lib/runtime-policy.ts` |
| Chat answers had no reasoning budget (could be truncated and billed). | Low reasoning effort on every call where the model supports it. | `lib/chat-completion.ts` |
| **Browser service stuck unhealthy**: a one-shot sandbox probe ran before listening; one failure lasted forever; a missing token was silent. | Listen first, then probe with backoff; exit after 5 failures so Compose restarts it; clear log when the token is missing. | `services/browser/index.mjs` |
| A missing domain-funding receipt pinned the single domain worker to one order for up to 24 h. | Backs off 60 s. | `lib/domain-runtime.ts` |
| Domain orders could stall forever in `queued`/`reserve`, freezing the coin's agent. | 24 h / 48 h deadlines; only an in-flight registrar purchase pauses planning. | `lib/domain-runtime.ts`, `lib/runtime.ts` |
| Expired or superseded domains re-verified forever. | Terminal `expired` / `superseded` states. | `lib/domain-runtime.ts` |
| A domain bridge in `needs_reconciliation` froze the whole wallet (no compute top-ups, so the agent stopped); a receipt search bug parked paid jobs after about 5.5 h. | Other spending waits only while BNB is reserved or moving (unknown states still block by default); the receipt search is bounded by the authorization's lifetime; a 6 h timeout on waiting for a Relay fill. | `services/signer/domain-funding.mjs` |
| X refresh failures always revoked the connection, even for a rate limit or a rejected client secret (the refresh token is still valid then). | Those two cases reset and retry. | `lib/social-config.ts` |
| Rejected plans retried forever (about 12 paid retries/hour). | Exponential backoff after repeated rejections, 15 min → 6 h, reset on approval. | `lib/runtime.ts` |
| Small market moves woke a paid plan every worker pass. | Market wakes at most once per 10 minutes. | `lib/agent-work.ts` |
| The worker handled one coin per cycle. | Cheap checks for several coins share a time-boxed pass. | `app/api/internal/worker/route.ts` |
| The operation queue always took the 20 oldest operations (stuck campaigns starved newer coins). | Unsigned operations first, others rotated randomly. | `app/api/internal/worker/route.ts` |
| Public chart requests made about 4 uncached RPC calls each (shared with the signer's RPC quota). | Latest BNB price cached for 30 s; block-pinned reads stay uncached. | `lib/funding.ts` |
| One zero-amount trade log froze a coin's chart indexing forever. | Invalid trades skipped. | `lib/curve-candles.ts` |
| Public image endpoints decoded base64 per byte (CPU load on the event loop). | Native decoding helper with immutable caching. | `lib/server.ts`, image routes |
| Uppercase salts made a launched token permanently unconfirmable. | Salt normalised. | launch route |
| "Run readiness check" wrote an event on every click. | Skipped when nothing changed. | `lib/agent.ts` |
| Re-signing in with the same wallet remounted the page and wiped an in-progress launch. | Remount only when the wallet changes. | `components/shen-app.tsx` |
| Blocked storage crashed pages, and there was no error boundary. | Storage guarded; `app/error.tsx` (new). | `components/shen-app.tsx`, `app/error.tsx` |
| The "Opening X…" button stayed disabled after pressing Back from x.com. | `pageshow` reset. | `components/social-connection.tsx` |
| `AbortSignal.any` broke balance polling and launch confirmation on older Safari and wallet browsers. | Fallback helpers. | `lib/launch-confirmation.ts`, `components/treasury-balance.tsx` |

## 5. Tests

New: `tests/influencer-runtime.test.mjs` (12 tests: lifecycle with exact settlement, waiting for X, lost-reply reconciliation, no permanent holds, declined content, idempotent retries, reference identity, photo posts, timeouts, platform refusals), `tests/influencer-postgres.test.mjs` (full lifecycle on PostgreSQL), `tests/treasury-limits.test.mjs`, `tests/auth-challenge.test.mjs`; added cases in `tests/content-runtime.test.mjs`, `tests/launch-metadata.test.mjs` and `services/signer/domain-funding.test.mjs`.
Updated to the new intended behavior: `tests/planner.test.mjs` (provider failures settle instead of freezing), `tests/chat-schedule.test.mjs`, `tests/planning-reasoning.test.mjs`, `tests/research.test.mjs`.

## 6. Operator actions before or after deploying

1. **Redeploy all services** (web, worker, signer, browser, gateway). Migration `0031` runs automatically on web start.
2. **Chat "resting"**: set `CHAT_DAILY_LIMIT_MICROUSD` to a positive integer of at least one question's cost (about `230000` with the default models), e.g. `5000000` for $5/day platform-wide. With `0`, chat stays closed by design.
3. **AI influencer**: set `HIGGSFIELD_API_KEY_ID`, `HIGGSFIELD_API_KEY_SECRET`, `HIGGSFIELD_IMAGE_COST_MICROUSD`, `HIGGSFIELD_CHARACTER_COST_MICROUSD` (and optionally `HIGGSFIELD_VIDEO_COST_MICROUSD`, `HIGGSFIELD_VIDEO_MODEL`, `INFLUENCER_*`), set the rates at or above your real Higgsfield cost, and fund the Higgsfield account. It also needs X configured with `X_UPLOAD_COST_MICROUSD` set. Until then, coins can opt in at launch and it shows "Unavailable". The X accounts should be labelled as automated in X settings.
4. **Browser health**: after redeploy, check `docker logs` for "Browser sandbox ready". If it still fails, the logged Chromium message tells you whether host user namespaces or AppArmor are blocking the sandbox.
5. **Stuck publication**: after deploy, the content worker reads the X timeline for it and settles it automatically (no re-post). Check its final state on the coin's Community tab.
6. The gateway now rate-limits POSTs per client IP (sign-in 12/min, other API writes 120/min). Adjust `deploy/nginx.conf` if needed.

## 7. Known limitations (not changed)

- OpenRouter automatic top-ups are still not implemented (agent service credit and the OpenRouter balance remain separate).
- The signer's fee audit still advances about 5,000 blocks per call; at a few hundred coins it can fall behind and pause spending. It needs a background catch-up loop.
- Signer-side per-wallet daily spend caps were not added; the web now enforces pacing (§3).
- Bonding-curve buybacks have no on-chain deadline (`minOut` still bounds the loss).
- `.ai` domains may exceed the $100 per-order cap.
- The local dev server doesn't run outside the original hosting tool's environment.

## 8. Files not created by Claude

These appeared at 09:26–09:27 during this session from another session, and were **not modified** by Claude: `docs/MARTIAN-RECOVERY.md`, `services/signer/recover-martian.mjs`, `services/signer/test-fee-recovery.mjs`, `services/signer/test-fee-recovery.test.mjs`. They're a local admin script that transfers up to 0.03 BNB from the MARTIAN agent wallet to a fixed address "authorized by the operator in this chat"; please confirm you requested it. Their tests pass with the signer changes above.

## Follow-up: activity-based community work

Removed the legacy one-per-hour/eight-per-day publication quota. Publication timing now responds to confirmed fee dispatch, fresh volume trends and available credit; planning/research cadence follows the same activity signal within 1–5 minutes. A proposed publication is queued once for its due time, surfaced in the console, and rescheduled as activity changes. Exact unchanged console summaries are suppressed while every approved plan remains in memory. Text-only gallery work no longer needs an artwork allowance; confirmed zero-charge image failures can try the alternate supported Seedream model within the original reservation, while ambiguous writes remain isolated.

### Creation wizard correction
Identity and Agent step validation now inspect only their respective fields in the shared form; fields from later steps no longer produce “Unrecognized keys” on Continue. Final creation/API validation remains strict. Regression tests cover the reported Identity input, unfinished mission fields, Agent progression and final rejection of unknown/platform fields.

Follow-up validation: 340 automated tests, TypeScript, and the Dokploy production build passed. Live paid image generation and the deployed browser were not exercised.

### Higgsfield single-key authentication
The current official quick start accepts the complete API key as copied. Added `HIGGSFIELD_API_KEY` to the server, Compose and env templates; it takes precedence over legacy ID/secret settings and is sent unchanged after the Key authorization scheme. Existing split credentials remain compatible. Tests cover single-key headers, precedence, malformed-key rejection and legacy behavior.

## Follow-up: agent evolution, coding and quote pairs

Approved plans can maintain a consistent persona and revise sourced website pages, FAQs and search tools using aggregated visitor feedback. Chat, community posts and influencer generation share that persona. The public Code editor shows saved JavaScript/Python workspaces, tests and execution results. Execution requires a separately deployed gVisor runner; generated jobs receive no network, host mounts, wallet keys or provider credentials. Unknown coding charges remain isolated and retries reuse the same job ID. See [agent evolution](docs/AGENT-EVOLUTION.md) and [coding deployment](docs/CODING-SANDBOX.md).

Kling remains the default influencer video model using the coin/character image. Optional motion-transfer configuration requires a source video. Provider/model tariffs are captured at reservation, and confirmed rejected video generation can fall back to a finished still without retaining the unused video allowance.

New coins use 2% buy and sell tax; existing 3% launches remain valid. The launch flow supports eligible Flap crypto, stock-token, pre-IPO and custom-address quote pairs. Non-BNB launches request a separate creator BNB gas deposit after launch confirmation, with durable nonce/receipt recovery. A separate signer pass converts audited earned quote fees through fixed PancakeSwap V2/V3 routes to WBNB and unwraps to BNB. Only confirmed native proceeds enter the protocol split; missing liquidity or gas does not stall unrelated planning. See [quote pairs and gas](docs/QUOTE-PAIRS.md).

Validation: 366 tests, TypeScript and the Dokploy production build passed. Read-only mainnet quotes found routes for USDT, NVDAB, pPOLY, xKLSH and oANTHROPIC; Flap launch simulations accepted 2% BNB, USDT and pPOLY pairs. No mainnet transactions or paid provider calls were made. The gVisor job runtime still requires verification on its deployment host. Redeploy web, signer and worker together, preserving their database volumes; migrations 0032–0034 run on web startup.

## Follow-up: X before launch and pair-picker styling

The final creation step now offers Save & connect X before any launch transaction. The saved coin retains its artwork, mission, quote pair and influencer reference; the OAuth callback returns to that coin's launch review. Developer-buy and announcement-link fields survive the redirect in the same browser. Saved drafts appear in My agents, and a failed read no longer silently creates a duplicate coin. Ownership, consent, browser-bound OAuth, account uniqueness and connection allowances remain enforced; publishing still requires a confirmed launch. The public coin projection now includes the quote and influencer settings needed by the resumed review.

Replaced the native pair dropdown with a dark token-card grid, category controls, search, selected state, bounded styled scrolling and an explicit custom-address check. Availability, retry and gas-deposit states remain visible. Checked search/category/selection behavior and the rendered component in a local browser preview with mocked eligibility responses. API regression tests cover prelaunch authorization, recovery and rejected unauthorized requests; 368 tests and the production build passed. Live X authorization was not performed.

### X connection failures and repeated balance checks

Starting OAuth no longer calls the app-credit endpoint: constructing the authorization redirect requires local state, ownership and consent, not a billing preflight. Existing connection allowances and callback identity verification remain enforced. Worker balance checks coalesce concurrent reads per app credential/server process, cache valid results for 60 seconds, and respect X's rate-limit reset/Retry-After on 429. Expired credit is never substituted for a failed refresh; posting checks remain in place. Recognized X profile problem types now distinguish app enrollment/access, resource permissions and usage caps without exposing provider detail text. Generic 403 responses remain generic; the application does not guess the cause or accept an unverified identity. Validation: 370 automated tests passed, including concurrent reads, cooldown, OAuth independence and safe callback errors.
