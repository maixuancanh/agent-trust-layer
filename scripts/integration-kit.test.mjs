import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildCampaignMessage,
  buildCreateEscrowArgs,
  buildRegisterServiceArgs,
  buildWalletCommand,
  parseTags,
} from './integration-kit.mjs';

const PROGRAM_ID = '0x52f786c921a4176297ec33ce30e1e62b436e5b32fa9d04a5a5f82ad221a4242a';

describe('integration kit argument builders', () => {
  it('builds RegisterService args from external-agent inputs', () => {
    assert.deepEqual(
      buildRegisterServiceArgs({
        handle: 'aan-mission-provider',
        metadataUri: 'https://example.com/service.json',
        price: '1000000000000',
        slaBlocks: '1200',
        tags: 'mission,escrow,provider',
      }),
      [
        'aan-mission-provider',
        'https://example.com/service.json',
        '1000000000000',
        1200,
        ['mission', 'escrow', 'provider'],
      ],
    );
  });

  it('builds CreateEscrow args and keeps VARA value outside method args', () => {
    assert.deepEqual(
      buildCreateEscrowArgs({
        provider: '0x1111111111111111111111111111111111111111111111111111111111111111',
        arbiter: '0x2222222222222222222222222222222222222222222222222222222222222222',
        termsHash: 'ipfs://terms-real-mission',
        deadlineBlock: '33340000',
      }),
      [
        '0x1111111111111111111111111111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222222222222222222222222222',
        'ipfs://terms-real-mission',
        33340000,
      ],
    );
  });
});

describe('integration kit command builders', () => {
  it('defaults to dry-run so external users must opt into on-chain writes', () => {
    const command = buildWalletCommand({
      method: 'AgentTrustLayer/RegisterService',
      argsFile: 'tmp/register.json',
      programId: PROGRAM_ID,
      execute: false,
    });

    assert.ok(command.includes('--dry-run'));
    assert.ok(command.includes(PROGRAM_ID));
    assert.ok(command.includes('AgentTrustLayer/RegisterService'));
  });

  it('requires an account when execute mode is requested', () => {
    assert.throws(
      () =>
        buildWalletCommand({
          method: 'AgentTrustLayer/RegisterService',
          argsFile: 'tmp/register.json',
          programId: PROGRAM_ID,
          execute: true,
        }),
      /--account is required/,
    );
  });
});

describe('real-user campaign copy', () => {
  it('states that the campaign is for real external wallets, not self-funded loops', () => {
    const message = buildCampaignMessage({ programId: PROGRAM_ID });

    assert.match(message, /real external agents/i);
    assert.match(message, /not self-funded loops/i);
    assert.match(message, /RegisterService/);
    assert.match(message, /CreateEscrow/);
    assert.match(message, new RegExp(PROGRAM_ID));
  });
});

describe('parseTags', () => {
  it('normalizes comma-separated tags', () => {
    assert.deepEqual(parseTags(' Mission, escrow, , Provider '), ['mission', 'escrow', 'provider']);
  });
});
