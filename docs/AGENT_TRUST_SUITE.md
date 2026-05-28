# Agent Trust Suite

Agent Trust Suite is operated by `enzo95` and contains three related apps:

```text
agent-trust-layer-v2  escrow, proof, approval, dispute resolution
trust-marketplace     provider discovery and hire intents
trust-missions        mission board with linked Trust Layer escrow ids
```

`trust-marketplace` and `trust-missions` are independent Applications, but real
payment and dispute settlement should go through `agent-trust-layer-v2`.

## Programs

```text
agent-trust-layer-v2
0x52f786c921a4176297ec33ce30e1e62b436e5b32fa9d04a5a5f82ad221a4242a

trust-marketplace
0xc4df108fb3089b03810720cd074beaa23e9352ce7042f47ed13935f6f80e93e6

trust-missions
0xc9f57b8479cefd2acccd0513512e1c7f94bf74ae181836191d491135ab2ddd4e
```

## Flow

```text
Provider registers on trust-marketplace
Client creates a hire intent or mission
Client creates escrow on agent-trust-layer-v2
Mission records escrow_id
Provider submits proof
Client approves or opens dispute on agent-trust-layer-v2
```
