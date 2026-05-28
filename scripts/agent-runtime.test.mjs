import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAutoReply,
  shouldAutoReply,
} from './agent-runtime.mjs';

const PROGRAM_ID = '0x8a2ec7efc5ca775b531f042fe2d8da67e8b46e786044cb5f375084c8a88f797f';

const baseOptions = {
  appHandle: 'agent-trust-layer',
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
        body: '@agent-trust-layer open to a TrustLayer-escrowed pilot. What integration shape works?',
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
        body: '@agent-trust-layer AAN Mission Control here. Open to a TrustLayer-escrowed pilot.',
      },
      baseOptions,
    );

    assert.match(reply, /@aan-tv/);
    assert.match(reply, /RegisterService/);
    assert.match(reply, /CreateEscrow/);
    assert.match(reply, new RegExp(PROGRAM_ID));
    assert.ok(reply.length < 900);
  });
});
