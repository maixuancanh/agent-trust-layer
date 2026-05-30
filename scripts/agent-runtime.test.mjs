import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAutoReply,
  buildOnChainAck,
  detectOnChainChanges,
  shouldAutoReply,
} from './agent-runtime.mjs';

const PROGRAM_ID = '0x52f786c921a4176297ec33ce30e1e62b436e5b32fa9d04a5a5f82ad221a4242a';

const baseOptions = {
  appHandle: 'agent-trust-layer-v2',
  appHandleAliases: ['agent-trust-layer'],
  participantHandle: 'enzo95',
  appHex: PROGRAM_ID,
  allowlist: ['aan-tv', 'infinite-bounty-v3'],
  allowAllExternal: true,
  nowMs: 1_779_961_000_000,
  minReplyIntervalMs: 120_000,
};

describe('auto-reply decision', () => {
  it('accepts external mentions to the app that have not been handled', () => {
    const decision = shouldAutoReply(
      {
        msgId: 2757,
        authorHandle: 'random-agent',
        body: '@agent-trust-layer-v2 open to a TrustLayer-escrowed pilot. What integration shape works?',
      },
      { handled_messages: [], last_auto_reply_at: 1_779_960_000_000 },
      baseOptions,
    );

    assert.equal(decision.ok, true);
  });

  it('rejects duplicate, self-authored, unmentioned, and rate-limited messages', () => {
    assert.equal(
      shouldAutoReply(
        { msgId: 2757, authorHandle: 'aan-tv', body: '@agent-trust-layer ping' },
        { handled_messages: [2757], last_auto_reply_at: 0 },
        baseOptions,
      ).ok,
      false,
    );

    assert.equal(
      shouldAutoReply(
        { msgId: 2758, authorHandle: 'agent-trust-layer', body: '@agent-trust-layer ping' },
        { handled_messages: [], last_auto_reply_at: 0 },
        baseOptions,
      ).ok,
      false,
    );

    assert.equal(
      shouldAutoReply(
        { msgId: 2759, authorHandle: 'random-agent', body: 'generic chat without a direct mention' },
        { handled_messages: [], last_auto_reply_at: 0 },
        baseOptions,
      ).ok,
      false,
    );

    assert.equal(
      shouldAutoReply(
        { msgId: 2760, authorHandle: 'aan-tv', body: '@agent-trust-layer ping' },
        { handled_messages: [], last_auto_reply_at: 1_779_960_950_000 },
        baseOptions,
      ).ok,
      false,
    );
  });

  it('can still restrict replies to an explicit allowlist', () => {
    const restrictedOptions = { ...baseOptions, allowAllExternal: false };

    assert.equal(
      shouldAutoReply(
        { msgId: 2762, authorHandle: 'random-agent', body: '@agent-trust-layer ping' },
        { handled_messages: [], last_auto_reply_at: 0 },
        restrictedOptions,
      ).reason,
      'not_allowlisted',
    );

    assert.equal(
      shouldAutoReply(
        { msgId: 2763, authorHandle: 'aan-tv', body: '@agent-trust-layer ping' },
        { handled_messages: [], last_auto_reply_at: 0 },
        restrictedOptions,
      ).ok,
      true,
    );
  });
});

describe('auto-reply templates', () => {
  it('builds a concrete AAN mission pilot reply', () => {
    const reply = buildAutoReply(
      {
        msgId: 2757,
        authorHandle: 'aan-tv',
        body: '@agent-trust-layer-v2 AAN Mission Control here. Open to a TrustLayer-escrowed pilot.',
      },
      baseOptions,
    );

    assert.match(reply, /@aan-tv/);
    assert.match(reply, /RegisterService/);
    assert.match(reply, /CreateEscrow/);
    assert.match(reply, new RegExp(PROGRAM_ID));
    assert.ok(reply.length < 900);
  });

  it('still accepts mentions to the legacy v1 handle alias', () => {
    const decision = shouldAutoReply(
      {
        msgId: 2761,
        authorHandle: 'aan-tv',
        body: '@agent-trust-layer can we test the V2 escrow?',
      },
      { handled_messages: [], last_auto_reply_at: 1_779_960_000_000 },
      baseOptions,
    );

    assert.equal(decision.ok, true);
  });
});

describe('on-chain watcher', () => {
  it('detects new service passports and escrows after baseline', () => {
    const changes = detectOnChainChanges(
      {
        serviceKeys: ['0xaaa:provider-a', '0xbbb:provider-b'],
        escrowIds: [0, 2],
      },
      {
        seen_service_keys: ['0xaaa:provider-a'],
        seen_escrow_ids: [0],
        onchain_initialized: true,
      },
    );

    assert.deepEqual(changes, [
      { kind: 'service', key: '0xbbb:provider-b' },
      { kind: 'escrow', id: 2 },
    ]);
  });

  it('does not announce historical chain state before baseline is initialized', () => {
    const changes = detectOnChainChanges(
      {
        serviceKeys: ['0xaaa:provider-a'],
        escrowIds: [0],
      },
      {
        seen_service_keys: [],
        seen_escrow_ids: [],
        onchain_initialized: false,
      },
    );

    assert.deepEqual(changes, []);
  });

  it('builds concise acknowledgements for real on-chain usage', () => {
    const serviceAck = buildOnChainAck({ kind: 'service', key: '0xbbb:provider-b' }, baseOptions);
    const escrowAck = buildOnChainAck({ kind: 'escrow', id: 2 }, baseOptions);

    assert.match(serviceAck, /detected new RegisterService/i);
    assert.match(serviceAck, new RegExp(PROGRAM_ID));
    assert.match(escrowAck, /detected new CreateEscrow/i);
    assert.match(escrowAck, /escrow #2/);
  });
});
