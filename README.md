# Agent Trust Layer

Agent Trust Layer is a Vara Sails dapp for the Agents Arena hackathon.
It gives agents a shared trust primitive for paid work: service passports,
escrowed VARA, proof submission, client approval, arbiter dispute resolution,
and pull-based withdrawals.

Participant handle: `enzo95`

Dapp handle: `agent-trust-layer`

Submitted V2 handle: `agent-trust-layer-v2`

Suite handles: `trust-marketplace`, `trust-missions`

Primary track: `Agent Services`

Secondary fit: `Social & Coordination / Economy & Markets`

Current mainnet program:

```text
0x52f786c921a4176297ec33ce30e1e62b436e5b32fa9d04a5a5f82ad221a4242a
```

The current deployment embeds a Sails v2-parseable IDL, so `vara-wallet discover`
works directly against the program without an external `--idl` file.

Agent Trust Suite also includes two submitted companion applications:

```text
trust-marketplace
0xc4df108fb3089b03810720cd074beaa23e9352ce7042f47ed13935f6f80e93e6

trust-missions
0xc9f57b8479cefd2acccd0513512e1c7f94bf74ae181836191d491135ab2ddd4e
```

`trust-marketplace` is the provider discovery layer. `trust-missions` is the
mission coordination layer. Both route payment and dispute settlement back to
`agent-trust-layer-v2`.

## Why It Exists

The current agent network has oracles, games, bounties, analytics, and service
apps, but paid cooperation still needs a neutral settlement layer. Agent Trust
Layer lets one agent hire another, lock payment, submit proof, approve work, or
escalate to an arbiter.

This is designed for real hackathon scoring:

- Incoming usage: other apps can create escrows and register services.
- Outgoing integration: bounty, mission, marketplace, oracle, and reputation
  agents can route work through this contract.
- Real VARA flow: every escrow is funded with attached value.
- Post-season utility: disputes, milestone escrow, and service passports remain
  useful after the Season 1 metrics freeze.

## Contract Surface

Service passport registry:

- `RegisterService(handle, metadata_uri, price, sla_blocks, tags)`
- `GetService(owner)`
- `ListServices()`

Escrow lifecycle:

- `CreateEscrow(provider, arbiter, terms_hash, deadline_block)`
- `AcceptEscrow(escrow_id)`
- `SubmitWork(escrow_id, proof_uri)`
- `ApproveWork(escrow_id)`
- `OpenDispute(escrow_id, dispute_uri)`
- `ResolveDispute(escrow_id, provider_award, client_award, ruling_uri)`
- `CancelExpired(escrow_id)`
- `WithdrawClaim()`

Queries:

- `GetEscrow(escrow_id)`
- `ListEscrows()`
- `Claimable(owner)`

## Local Build

Use the helper scripts on Windows because the workspace path contains spaces,
which breaks the MinGW `dlltool` path used by the Gear/Sails build unless
`CARGO_TARGET_DIR` points outside the workspace.

```powershell
.\scripts\test.ps1
.\scripts\build.ps1
```

Release artifacts are produced under:

```text
C:\tmp\agent-trust-layer-target\wasm32-gear\release\agent_trust_layer.opt.wasm
C:\tmp\agent-trust-layer-target\wasm32-gear\release\agent_trust_layer.idl
```

The build script also copies the IDL to:

```text
artifacts\agent_trust_layer.idl
```

## Hackathon Onboarding Checklist

Official onboarding requires a deployed Sails program with IDL, Registry entry,
Board identity card, at least one meaningful cross-agent interaction, and a
verified X post.

1. Create/register the operator participant `enzo95`.
2. Claim the 100 VARA starter grant from the hackathon page.
3. Deploy `agent_trust_layer.opt.wasm` to Vara mainnet.
4. Publish `skills.md` and `artifacts/agent_trust_layer.idl` to stable GitHub
   raw URLs.
5. Register application handle `agent-trust-layer`.
6. Submit application for review after the metadata preflight passes.
7. Post Board identity and Chat intro mentioning target integration partners.

## Cross-Agent Proof

Agent Trust Layer completed AAN Mission Control M4 by calling TheBookDex and
submitting proof back to Mission Control.

- Mission Control: `aan-missions`
- TheBookDex: `thebookdex`
- Claim tx: `0x975b4d7811418cab10a50dbe1cbbb5656ca25bf8bcb2ee152c653cc10b1064e1`
- TheBookDex `Orderbook/SignalCollab` tx:
  `0xb7114fedf27b0ea7c49108d55e48881611df7c49b1feb66bb62e70b516c0a94f`
- Mission proof tx:
  `0x8ba071d5051dc4f120270e3ec46db9dc18d1e1ec1f177ec14a65a21b66c0da29`
- Mission proof id: `3`
- Chat proof message id: `2729`
- Board proof announcement id: `287`

## Agent Runtime

The runtime is supervised by default: it polls Application and Participant
mentions, persists cursors, and lets the operator post explicit replies.
Auto-reply mode answers from the Application identity for any external author
who mentions the app or participant handle. It still skips self-authored
messages, requires a direct mention, rate-limits replies, and can be restricted
with `--allowlist`.

The runtime can also watch direct on-chain usage. With `--watch-chain`, it polls
`AgentTrustLayer/ListServices` and `AgentTrustLayer/ListEscrows`, stores a
baseline, and posts an Application acknowledgement only when it sees a new
service passport or escrow after that baseline.

```powershell
.\scripts\runtime.ps1 poll --peek
.\scripts\runtime.ps1 loop --interval 30
.\scripts\runtime.ps1 loop --interval 30 --auto-reply --watch-chain
.\scripts\runtime.ps1 reply --to 2729 --body "Thanks. Call RegisterService first."
```

The runtime state is stored in `onboarding/runtime-state.json`.

Latest integration call-to-action:

- Chat message id: `2731`
- Board announcement id: `289`
- Mentioned targets: `aan-missions`, `thebookdex`, `varacore-app`,
  `varamind`, `a2a-radar-core`

Wallet CLI wrapper:

```powershell
.\scripts\wallet.ps1 --version
```

## Real User Integration Kit

The integration kit is for external agents using their own wallets. It defaults
to dry-run and requires `--execute --ack-real-user` before any on-chain write.
This is intentional: Agent Trust Layer should earn real integrations, not
self-funded loops.

```powershell
npm.cmd run kit:help
npm.cmd run kit:campaign

node .\scripts\integration-kit.mjs register-service `
  --handle your-agent `
  --metadata-uri https://example.com/service.json `
  --price-raw 1000000000000 `
  --sla-blocks 1200 `
  --tags mission,escrow,provider

node .\scripts\integration-kit.mjs create-escrow `
  --provider 0x... `
  --arbiter 0x... `
  --terms-hash ipfs://your-real-terms `
  --deadline-block 33340000 `
  --value 0.1
```

Full guide: [docs/INTEGRATION_KIT.md](docs/INTEGRATION_KIT.md)

Real-user campaign plan: [docs/REAL_USER_CAMPAIGN.md](docs/REAL_USER_CAMPAIGN.md)

Live campaign receipts:

- Chat CTA message id: `2768`
- Board announcement id: `306`
- Rule: external wallets and real workflows only, no self-funded loops.

Deploy shape after the wallet is funded:

```powershell
.\scripts\wallet.ps1 --account enzo95 --network mainnet program upload `
  C:\tmp\agent-trust-layer-target\wasm32-gear\release\agent_trust_layer.opt.wasm `
  --idl C:\tmp\agent-trust-layer-target\wasm32-gear\release\agent_trust_layer.idl `
  --init Create `
  --args "[]"
```

## License

MIT
