'use strict';

const http = require('http');

const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 8080;

const SYSTEM = (
  'You classify spoken commands for a Marantz home audio system. ' +
  'Infer an intent only when the speaker clearly wants the system to change state now. ' +
  'Use these meanings exactly: ' +
  'power_on means turn the Marantz or receiver on; power_off means turn it off, put it in standby, or put the receiver to sleep; ' +
  'volume_up means make the current audio louder or increase its level; volume_down means make it quieter or reduce its level. ' +
  'Natural complaints that the sound is fierce, blasting, excessive, or too loud mean volume_down; complaints that it is faint, barely audible, or too quiet mean volume_up; ' +
  'mute means silence or cut the current audio, including requests for no sound temporarily; ' +
  'unmute means restore sound after mute, including requests to hear the sound again or have the sound/audio back; ' +
  'source_phono means select PHONO, the turntable, or record player; source_cd means select CD, compact disc, or the disc player; ' +
  'source_tidal means select TIDAL or HEOS as the source; source_tv means select the TV source; ' +
  'source_aux means select AUX or the projector source; ' +
  'play means start or resume current playback, continue/carry on with the current music, or keep current playback going; ' +
  'pause means pause, hold, or temporarily stop current playback; ' +
  'next means advance from the current track to the next track, including requests to skip, discard, or get rid of the current song; ' +
  'previous means go back to the previous track. ' +
  'A command may be short or elliptical and does not need a full sentence when its requested action is still clear. ' +
  "Polite requests such as 'could you', 'would you', or asking to have something changed now are commands when they clearly request an immediate action. " +
  'Direct requests and clear complaints about current audio can imply an action. ' +
  'Questions, suggestions, and requests for an opinion or information are unknown unless they explicitly and unambiguously instruct the system to change state now. ' +
  'Do not turn a question about whether something is loud or quiet into a volume command. ' +
  'Negated commands that tell the system not to do something are unknown; never infer the opposite action from a negation. ' +
  'Observations, compliments, hypothetical or future/deferred statements, and unsupported requests must be unknown. ' +
  'A phrase beginning with play is not automatically the playback-control intent: play is only for starting, resuming, continuing, or keeping current playback going, not for selecting arbitrary media by name. ' +
  'When uncertain, choose unknown. ' +
  'Reply with only one exact intent token from: power_on, power_off, volume_up, volume_down, mute, unmute, ' +
  'source_phono, source_cd, source_tidal, source_tv, source_aux, play, pause, next, previous, unknown.'
);

const ALLOWED = new Set([
  'power_on', 'power_off', 'volume_up', 'volume_down', 'mute', 'unmute',
  'source_phono', 'source_cd', 'source_tidal', 'source_tv', 'source_aux',
  'play', 'pause', 'next', 'previous', 'unknown'
]);

const NEGATION_RE = /\b(?:don't|dont|do not|didn't|didnt|did not|never|not)\b/i;
const AVOIDANCE_RE = /(?:\brather\b.*\b(?:didn't|didnt|did not)\b|\b(?:avoid|avoiding)\b|\bstay away from\b|\bbest not\b|\bleave\b.*\b(?:alone|where it is|running|playing|switched on)\b|\bkeep\b.*\b(?:muted|running|playing)\b|\b(?:don't|dont|do not)\s+want\b)/i;
const FUTURE_RE = /\b(?:later|tomorrow|tonight|next week|this evening|sometime|in a while|in\s+(?:(?:a|one)\s+)?(?:few\s+)?(?:seconds?|minutes?|hours?)|in\s+\d+\s+(?:seconds?|minutes?|hours?)|at\s+(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+o['’]?clock)|once\b|after\b|when\b|before\s+(?:(?:the|this|that|a|an)\s+\w+\s+(?:starts?|begins?|finishes?|ends?|arrives?|leaves?|rings?|happens?)|(?:i|we|you|he|she|they)\s+\w+))/i;
const HYPOTHETICAL_RE = /^(?:if\b|suppose\b|imagine\b|assuming\b|what if\b|were\s+\w+\s+to\b)/i;
const REPORTED_SPEECH_RE = /^(?:(?:he|she|they|someone|somebody)\b.*\b(?:said|asked|told|shouted|yelled)\b|(?:the|a)\s+(?:message|instructions?|note|text)\b.*\b(?:says?|said|tells?|asks?)\b|i\s+(?:heard|was told)\b.*\b(?:say|said|ask|asked|tell|told)\b)/i;
const QUESTION_START_RE = /^(?:is|are|am|was|were|did|does|do|has|have|had|which|what|why|when|where|who|how|should|could|would|can|may)\b/i;
const POLITE_COMMAND_START_RE = /^(?:(?:could|would|can|will)\s+you\b|(?:can|could|may)\s+i\s+(?:have|get)\b|please\b)/i;
const OBSERVATION_START_RE = /^(?:the|this|that|it|my|your|our|we|we're|we are|i|i'm|i am|playback|sound|audio|music|receiver|amp|amplifier|television|projector|aux|phono|cd|tidal|heos)\b/i;
const OBSERVATION_ACTION_RE = /\b(?:icon|showing|shows|uses|looks|seems|currently|already|at present|right now|remains|feeds|coming through|source is|input is|current source|current input|is the current source|is the current input|has stopped|has started|has paused|is stopped|is paused|is playing|is connected to|connected to|is for|was the previous|is the next|was the next|is the previous|is selected|selected right now|what we're listening to|what we are listening to|stopped on its own|came back by itself|came back on its own|stayed on|nearly over|listening quite|hear(?:ing)?\s+the\s+music\s+clearly)\b/i;
const UNRELATED_DEVICE_RE = /^(?:the\s+)?(?:doorbell|alarm|telephone|phone|kettle|fan|vacuum|hoover|washing machine|dryer|lamp|light)\b.*\b(?:loud|quiet|noisy|faint|volume|turn(?:ing)?\s+(?:up|down))\b/i;
const AUDIO_RESTORE_RE = /\b(?:sound|audio)\b.*\b(?:back|again|restore|return|hear)\b|\b(?:back|again|restore|return|hear)\b.*\b(?:sound|audio|it)\b/i;
const DEVICE_POWER_RE = /\b(?:marantz|receiver|amp|amplifier|system|power)\b/i;

function normaliseText(command) {
  return String(command || '').trim().replace(/\s+/g, ' ');
}

function safetyGate(command) {
  const text = normaliseText(command);
  if (!text) return 'empty';
  if (REPORTED_SPEECH_RE.test(text)) return 'reported_speech';
  if (HYPOTHETICAL_RE.test(text)) return 'hypothetical';
  if (NEGATION_RE.test(text) || AVOIDANCE_RE.test(text)) return 'negation';
  if (FUTURE_RE.test(text)) return 'future';
  if (QUESTION_START_RE.test(text) && !POLITE_COMMAND_START_RE.test(text)) return 'question';
  if (text.endsWith('?') && !POLITE_COMMAND_START_RE.test(text)) return 'question';
  if (UNRELATED_DEVICE_RE.test(text)) return 'unrelated';
  if (OBSERVATION_START_RE.test(text) && OBSERVATION_ACTION_RE.test(text)) return 'observation';
  return null;
}

function disambiguate(command, actual) {
  const text = normaliseText(command);
  if (actual === 'power_on' && AUDIO_RESTORE_RE.test(text) && !DEVICE_POWER_RE.test(text)) {
    return { intent: 'unmute', correction: 'audio_restore' };
  }
  return { intent: actual, correction: null };
}

function postJson(path, payload, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = http.request({
      host: SERVER_HOST,
      port: SERVER_PORT,
      path,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`Invalid AI response: ${error.message}`));
        }
      });
    });

    request.on('timeout', () => request.destroy(new Error('AI request timeout')));
    request.on('error', reject);
    request.end(body);
  });
}

async function classifyIntent(command) {
  const text = normaliseText(command);
  const gate = safetyGate(text);
  if (gate) {
    return { intent: 'unknown', raw: `safety:${gate}`, gate, correction: null, aiUsed: false };
  }

  const response = await postJson('/v1/chat/completions', {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: text }
    ],
    temperature: 0,
    max_tokens: 20
  });

  const raw = String(response?.choices?.[0]?.message?.content || '').trim();
  const initial = ALLOWED.has(raw) ? raw : 'unknown';
  const corrected = disambiguate(text, initial);

  return {
    intent: corrected.intent,
    raw,
    gate: null,
    correction: corrected.correction,
    aiUsed: true
  };
}

module.exports = {
  classifyIntent,
  safetyGate,
  ALLOWED
};
