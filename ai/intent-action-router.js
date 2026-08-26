'use strict';

const http = require('http');

const INTENT_ACTIONS = Object.freeze({
  power_on: { control: 'power', value: 'on' },
  power_off: { control: 'power', value: 'standby' },
  volume_up: { control: 'volume', value: 'up' },
  volume_down: { control: 'volume', value: 'down' },
  mute: { control: 'mute', value: 'on' },
  unmute: { control: 'mute', value: 'off' },
  source_phono: { control: 'source', value: 'phono' },
  source_cd: { control: 'source', value: 'cd' },
  source_tidal: { control: 'source', value: 'tidal' },
  source_tv: { control: 'source', value: 'tv' },
  source_aux: { control: 'source', value: 'aux' },
  play: { control: 'transport', value: 'play' },
  pause: { control: 'transport', value: 'pause' },
  next: { control: 'transport', value: 'next' },
  previous: { control: 'transport', value: 'previous' }
});

// Measured from the live SR8015 on 26 Aug 2026. These are the receiver's
// actual SI? responses, not display labels or inferred source names.
const SOURCE_EXPECTED_INPUTS = Object.freeze({
  phono: 'SI8K',
  cd: 'SICD',
  tidal: 'SINET',
  tv: 'SITV',
  aux: 'SIAUX1'
});

function resolveIntentAction(intent) {
  if (!intent || intent === 'unknown') return null;
  return INTENT_ACTIONS[intent] || null;
}

function readBackendStatus(timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      host: '127.0.0.1',
      port: 3100,
      path: '/api/status',
      timeout: timeoutMs
    }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`Invalid backend status response: ${error.message}`));
        }
      });
    });

    request.on('timeout', () => request.destroy(new Error('Backend status timeout')));
    request.on('error', reject);
  });
}

async function verifySourceSelection(source, options = {}) {
  const expected = SOURCE_EXPECTED_INPUTS[source];
  if (!expected) {
    throw new Error(`No verified AVR input mapping for source: ${source}`);
  }

  const readStatus = options.readStatus || readBackendStatus;
  const deadline = Date.now() + (options.timeoutMs || 6500);
  let lastInput = '';

  while (Date.now() < deadline) {
    try {
      const status = await readStatus();
      lastInput = String(status?.avr?.input || '');
      if (lastInput === expected) {
        return {
          source,
          expectedInput: expected,
          actualInput: lastInput
        };
      }
    } catch {
      // Retry briefly while the receiver applies Smart Select/source change.
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(
    `Receiver did not confirm source ${source}: expected ${expected}, got ${lastInput || 'no input response'}`
  );
}

async function executeIntent(intent, controls, options = {}) {
  const action = resolveIntentAction(intent);
  if (!action) {
    return {
      ok: false,
      executed: false,
      intent: intent || 'unknown',
      reason: 'unknown-intent'
    };
  }

  if (!controls || typeof controls !== 'object') {
    throw new Error('Missing intent control handlers');
  }

  let result;
  let verification = null;

  switch (action.control) {
    case 'power':
      if (typeof controls.power !== 'function') throw new Error('Missing power control handler');
      result = await controls.power(action.value);
      break;
    case 'volume':
      if (typeof controls.volume !== 'function') throw new Error('Missing volume control handler');
      result = await controls.volume(action.value);
      break;
    case 'mute':
      if (typeof controls.mute !== 'function') throw new Error('Missing mute control handler');
      result = await controls.mute(action.value);
      break;
    case 'source':
      if (typeof controls.source !== 'function') throw new Error('Missing source control handler');
      result = await controls.source(action.value);
      if (options.verifySources !== false) {
        verification = await verifySourceSelection(action.value, options);
      }
      break;
    case 'transport':
      if (typeof controls.transport !== 'function') throw new Error('Missing transport control handler');
      result = await controls.transport(action.value);
      break;
    default:
      throw new Error(`Unsupported intent action: ${action.control}`);
  }

  return {
    ok: true,
    executed: true,
    intent,
    action,
    result,
    ...(verification ? { verification } : {})
  };
}

module.exports = {
  INTENT_ACTIONS,
  SOURCE_EXPECTED_INPUTS,
  resolveIntentAction,
  verifySourceSelection,
  executeIntent
};
