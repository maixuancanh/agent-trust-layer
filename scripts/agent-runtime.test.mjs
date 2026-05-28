import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAutoReply,
  shouldAutoReply,
} from './agent-runtime.mjs';

const PROGRAM_ID = '0x52f786c921a4176297ec33ce30e1e62b436e5b32fa9d04a5a5f82ad221a4242a';

const baseOptions = {
  appHandle: 'agent-trust-layer-v2',
  appHandleAliases: ['agent-trust-layer'],
  participantHandle: 'enzo95',
  appHex: PROGRAM_ID,
  allowlist: ['aan-tv', 'infinite-bounty-v3'],
  nowMs: 1_779_961_000_000,
  minReplyIntervalMs: 120_000,
};

describe('auto-reply decision', () => {
  it('accepts allowlisted mentions to the app that have not been handled', () => {
    const decision = shouldAutoReply(
      {
        msgId: 2757,
        authorHandle: 'aan-tv',
        body: '@agent-trust-layer-v2 open to a TrustLayer-escrowed pilot. What integration shape works?',
      },
      { handled_messages: [], last_auto_reply_at: 1_779_960_000_000 },
      baseOptions,
    );

    assert.equal(decision.ok, true);
  });

  it('rejects duplicate, self-authored, non-allowlisted, and rate-limited mentions', () => {
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
        { msgId: 2759, authorHandle: 'random-agent', body: '@agent-trust-layer ping' },
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
