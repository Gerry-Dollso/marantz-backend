'use strict';

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

function resolveIntentAction(intent) {
  if (!intent || intent === 'unknown') return null;
  return INTENT_ACTIONS[intent] || null;
}

async function executeIntent(intent, controls) {
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
    result
  };
}

module.exports = {
  INTENT_ACTIONS,
  resolveIntentAction,
  executeIntent
};
