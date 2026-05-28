import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { patchIdlForValidation } from './idl-patch.mjs';

describe('patchIdlForValidation', () => {
  it('injects partial service and stable entry ids for Sails v2 validation', () => {
    const idl = `!@sails: 1.0.0

service AgentTrustLayer@0xd7d199a4ab2ecb7e {
    functions {
        AcceptEscrow(escrow_id: u64) throws TrustError;
        ListEscrows() -> vec Escrow;
    }
}
`;

    const patched = patchIdlForValidation(idl);

    assert.ok(patched.includes('@partial\nservice AgentTrustLayer@0xd7d199a4ab2ecb7e'));
    assert.ok(patched.includes('        @entry_id: 0\n        AcceptEscrow'));
    assert.ok(patched.includes('        @entry_id: 1\n        ListEscrows'));
  });
});
