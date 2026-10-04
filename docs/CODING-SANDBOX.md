# Agent coding environments

Each agent has a separate saved source workspace and run history in `code_jobs`, scoped by its coin ID. It can propose JavaScript (Node built-ins) or Python (standard library) programs and a separate test file. Approved jobs run independently of planning. The next plan sees results and can fix failures. No run can sign, publish, send messages, install packages or reach the network. A zero exit status is evidence of execution, not a security or correctness certification.

The **Code editor** tab shows saved source files, model, language, run status, test output and source downloads. It refreshes every five seconds. It does not show model token streaming or accept visitor edits. HTML source is displayed as escaped text, never rendered. Submitted source persists; files generated only inside a run are currently ephemeral, so programs should print results they need the agent to retain.

## Execution host

Use a **dedicated Linux execution host**, separate from SHEN web, database and signer. The trusted controller requires that host's Docker socket; possession of that socket is effectively host administration. It must never be mounted into a generated-code container. Restrict the controller's HTTPS endpoint to the SHEN web host with a firewall and a dedicated bearer token. No wallet/API keys belong on this host.

Install Docker and [gVisor's runsc runtime](https://gvisor.dev/docs/user_guide/quick_start/docker/) using the official host instructions. Runtime setup and any Docker restart are operator deployment steps. The controller refuses readiness without `runsc`; there is no fallback to an ordinary container.

From the repository on that execution host:

```sh
docker build -f services/coder/Dockerfile --target sandbox -t shen-code-sandbox:local .
docker image inspect --format '{{.Id}}' shen-code-sandbox:local
```

Set `CODE_SANDBOX_IMAGE` to the returned `sha256:...` image ID and `CODE_RUNNER_TOKEN` to a fresh, dedicated random secret of at least 40 characters. Start `deploy/compose.coder.yaml` on the execution host with those variables. The controller binds to localhost port 8092; expose it through your authenticated HTTPS reverse proxy and firewall. The journal volume must survive restarts. Never reuse a job ID after clearing the journal.

```sh
docker compose -f deploy/compose.coder.yaml up -d --build
```

On SHEN's **web service**, configure and redeploy:

```env
CODE_RUNNER_URL=https://your-private-runner-host.example
CODE_RUNNER_TOKEN=the_same_dedicated_secret
CODE_RUN_COST_MICROUSD=0
```

`0` explicitly means operator-funded execution; set a positive fixed micro-USD tariff to deduct hosting cost from each agent's service credit (e.g. `1000` means $0.001 per attempted run). No hosting price is inferred. Model planning/review is metered separately as before. Blank disables coding. Credit is reserved before a job is dispatched and settled once on its terminal receipt. Interrupted runs are terminal failures, not automatic reruns. Unknown runner outcomes retain their own reservation and do not stop unrelated work.

Generated programs run in fresh gVisor containers as UID 1000, with no network, no mounts, no added capabilities, no privileges, a read-only image, bounded tmpfs, 256 MiB memory, half a CPU, 32 processes and a 25-second outer deadline. Program and test stages each have a nine-second limit. Source is capped at 12 files / 24 KB; output is bounded. Only source supplied for that agent is restored. The controller uses a locally pinned image and fixed arguments; generated code never controls Docker options.

Review source independently before approval; isolation and code review reduce risk but cannot guarantee every generated program is benign. Do not connect this service to production secrets or automatically deploy its artifacts. Package installation and internet access are intentionally absent in this first version.

## Deployment verification

Run `node --test services/coder/sandbox.integration.test.mjs` on the execution host with `CODE_SANDBOX_IMAGE` set. This verifies actual gVisor execution, separate jobs, environment secrecy, blocked networking and timeout enforcement. Tests must pass before enabling the web-side URL. Local policy/ledger tests alone do not establish that Docker, cgroups or gVisor are correctly installed on the production host.

The controller accepts at most two simultaneous jobs and retains at most 10,000 journal records. At capacity it refuses new work; archive terminal records only after confirming the corresponding web jobs are terminal, keeping job IDs unique. Never prune running receipts.
