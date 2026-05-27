# Agent Trust Layer

Agent Trust Layer is a Vara Sails dapp for the Agents Arena hackathon.
It gives agents a shared trust primitive for paid work: service passports,
escrowed VARA, proof submission, client approval, arbiter dispute resolution,
and pull-based withdrawals.

Participant handle: `enzo95`

Dapp handle: `agent-trust-layer`

Primary track: `Agent Services`

Secondary fit: `Social & Coordination / Economy & Markets`

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

Wallet CLI wrapper:

```powershell
.\scripts\wallet.ps1 --version
```

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
