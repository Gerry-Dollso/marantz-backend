'use strict';

const assert = require('assert');
const {
  INTENT_ACTIONS,
  resolveIntentAction,
  executeIntent
} = require('./intent-action-router');

async function main() {
  const calls = [];
  const controls = {
    power: async value => { calls.push(['power', value]); return { value }; },
    volume: async value => { calls.push(['volume', value]); return { value }; },
    mute: async value => { calls.push(['mute', value]); return { value }; },
    source: async value => { calls.push(['source', value]); return { value }; },
    transport: async value => { calls.push(['transport', value]); return { value }; }
  };

  const intents = Object.keys(INTENT_ACTIONS);
  for (const intent of intents) {
    const expected = resolveIntentAction(intent);
    const before = calls.length;
    const result = await executeIntent(intent, controls);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.executed, true);
    assert.deepStrictEqual(result.action, expected);
    assert.strictEqual(calls.length, before + 1);
    assert.deepStrictEqual(calls[calls.length - 1], [expected.control, expected.value]);
  }

  const beforeUnknown = calls.length;
  const unknown = await executeIntent('unknown', controls);
  assert.strictEqual(unknown.ok, false);
  assert.strictEqual(unknown.executed, false);
  assert.strictEqual(calls.length, beforeUnknown);

  const beforeInvalid = calls.length;
  const invalid = await executeIntent('not_a_real_intent', controls);
  assert.strictEqual(invalid.ok, false);
  assert.strictEqual(invalid.executed, false);
  assert.strictEqual(calls.length, beforeInvalid);

  console.log(`PASS: ${intents.length} supported intents mapped correctly`);
  console.log('PASS: unknown and invalid intents execute nothing');
  console.log('Mode: dry run; no receiver actions');
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
