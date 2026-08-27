'use strict';

function normaliseText(value) {
  return String(value || '')
    .trim()
    .replace(/[.,!?;:]+/g, '')
    .replace(/\s+/g, ' ');
}

function parseTidalSemanticRequest(command) {
  const text = normaliseText(command);
  const lower = text.toLowerCase();

  if (!lower) return null;

  let match;

  match = lower.match(/^(?:show me|show|open|go to|take me to) (?:the )?(?:artist )?(.+)$/);
  if (match) {
    return {
      action: 'show',
      entity: 'artist',
      view: 'overview',
      artist: text.slice(text.length - match[1].length),
      album: '',
      track: ''
    };
  }

  match = lower.match(/^(?:show me|show|open) (?:the )?(?:albums|records) (?:by|from) (.+)$/);
  if (match) {
    return {
      action: 'show',
      entity: 'artist',
      view: 'albums',
      artist: text.slice(text.length - match[1].length),
      album: '',
      track: ''
    };
  }

  match = lower.match(/^(?:show me|show|open) (?:the )?(?:songs|tracks) (?:by|from) (.+)$/);
  if (match) {
    return {
      action: 'show',
      entity: 'artist',
      view: 'tracks',
      artist: text.slice(text.length - match[1].length),
      album: '',
      track: ''
    };
  }

  match = lower.match(/^(?:show me|show) (?:artists )?(?:similar to|like) (.+)$/);
  if (match) {
    return {
      action: 'show',
      entity: 'artist',
      view: 'similar',
      artist: text.slice(text.length - match[1].length),
      album: '',
      track: ''
    };
  }

  match = lower.match(/^(?:tell me about|show me info(?:rmation)? (?:about|on)|show info(?:rmation)? (?:about|on)) (.+)$/);
  if (match) {
    return {
      action: 'show',
      entity: 'artist',
      view: 'info',
      artist: text.slice(text.length - match[1].length),
      album: '',
      track: ''
    };
  }

  match = lower.match(/^(?:play|put on) (?:songs|tracks|music) (?:by|from) (.+)$/);
  if (match) {
    return {
      action: 'play',
      entity: 'artist',
      view: 'tracks',
      artist: text.slice(text.length - match[1].length),
      album: '',
      track: ''
    };
  }

  match = lower.match(/^(?:play|put on) (?:the )?album (.+?) by (.+)$/);
  if (match) {
    const artist = text.slice(text.length - match[2].length);
    const prefixLength = lower.indexOf(match[1]);
    const album = text.slice(prefixLength, prefixLength + match[1].length);
    return {
      action: 'play',
      entity: 'album',
      view: 'default',
      artist,
      album,
      track: ''
    };
  }

  match = lower.match(/^(?:play|put on) (?:the )?(?:song|track) (.+?) by (.+)$/);
  if (match) {
    const artist = text.slice(text.length - match[2].length);
    const prefixLength = lower.indexOf(match[1]);
    const track = text.slice(prefixLength, prefixLength + match[1].length);
    return {
      action: 'play',
      entity: 'track',
      view: 'default',
      artist,
      album: '',
      track
    };
  }

  match = lower.match(/^(?:play|put on) (.+?) by (.+)$/);
  if (match) {
    const artist = text.slice(text.length - match[2].length);
    const prefixLength = lower.indexOf(match[1]);
    const title = text.slice(prefixLength, prefixLength + match[1].length);
    return {
      action: 'play',
      entity: 'title',
      view: 'default',
      artist,
      album: title,
      track: title
    };
  }

  match = lower.match(/^(?:play|put on) (.+)$/);
  if (match) {
    return {
      action: 'play',
      entity: 'artist',
      view: 'tracks',
      artist: text.slice(text.length - match[1].length),
      album: '',
      track: ''
    };
  }

  return null;
}

module.exports = {
  parseTidalSemanticRequest
};
