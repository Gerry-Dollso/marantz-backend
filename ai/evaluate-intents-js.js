'use strict';

const fs = require('fs');
const path = require('path');
const { classifyIntent } = require('./intent-classifier');

const root = path.resolve(__dirname, '..');
const requested = process.argv[2] || 'ai/intent-safety-blind.json';
const casesPath = path.isAbsolute(requested) ? requested : path.join(root, requested);
const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

(async () => {
  let passed = 0;
  let unsafeFalsePositives = 0;
  let missedCommands = 0;
  let wrongActions = 0;
  const failures = [];
  const gated = {};

  console.log(`Cases: ${cases.length} (${path.basename(casesPath)})`);
  console.log('Mode: production JS classifier dry run; no receiver actions');
  console.log('');

  for (let i = 0; i < cases.length; i += 1) {
    const testCase = cases[i];
    let result;
    try {
      result = await classifyIntent(testCase.command);
    } catch (error) {
      result = { intent: null, raw: '', gate: null, correction: null, error: error.message };
    }

    if (result.gate) gated[result.gate] = (gated[result.gate] || 0) + 1;
    const actual = result.intent;
    const ok = actual === testCase.expected;
    if (ok) passed += 1;

    if (!ok) {
      if (testCase.expected === 'unknown' && actual && actual !== 'unknown') unsafeFalsePositives += 1;
      else if (testCase.expected !== 'unknown' && (!actual || actual === 'unknown')) missedCommands += 1;
      else if (testCase.expected !== 'unknown' && actual && actual !== 'unknown') wrongActions += 1;

      failures.push({
        ...testCase,
        actual,
        raw: result.raw,
        gate: result.gate,
        correction: result.correction,
        error: result.error || null
      });
    }
  }

  const accuracy = cases.length ? 100 * passed / cases.length : 0;
  console.log(`RESULT: ${passed}/${cases.length} = ${accuracy.toFixed(1)}%`);
  console.log('SAFETY GATE:');
  console.log(`- total gated to unknown: ${Object.values(gated).reduce((a, b) => a + b, 0)}`);
  Object.keys(gated).sort().forEach(reason => console.log(`- ${reason}: ${gated[reason]}`));
  console.log('ERROR TYPES:');
  console.log(`- unsafe false positives: ${unsafeFalsePositives}`);
  console.log(`- missed legitimate commands: ${missedCommands}`);
  console.log(`- wrong-action substitutions: ${wrongActions}`);

  if (failures.length) {
    console.log('FAILURES:');
    for (const failure of failures) {
      const category = failure.category || 'uncategorized';
      const gate = failure.gate ? ` gate=${failure.gate}` : '';
      const correction = failure.correction ? ` correction=${failure.correction}` : '';
      const error = failure.error ? ` error=${JSON.stringify(failure.error)}` : '';
      console.log(`- [${category}] expected=${failure.expected} actual=${failure.actual} raw=${JSON.stringify(failure.raw)}${gate}${correction}${error}: ${failure.command}`);
    }
  }

  process.exitCode = failures.length ? 1 : 0;
})().catch(error => {
  console.error(error);
  process.exitCode = 2;
});
