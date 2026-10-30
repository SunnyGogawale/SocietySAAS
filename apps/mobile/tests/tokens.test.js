import assert from 'node:assert/strict';
import test from 'node:test';
import tokens from '@societysaas/design-tokens';

test('shared tokens provide the agreed enterprise palette and spacing scale', () => {
  assert.equal(tokens.colors.navy900, '#16243b');
  assert.equal(tokens.colors.background, '#f4f6fa');
  assert.equal(tokens.spacing[4], 16);
  assert.ok(tokens.typography.fontFamily);
});
