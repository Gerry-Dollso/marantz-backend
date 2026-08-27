'use strict';

const {
  parseTidalSemanticRequest
} = require('./tidal-semantic-contract');

async function routeTidalSemanticRequest(command, handlers = {}) {
  const request = parseTidalSemanticRequest(command);

  if (!request) {
    return {
      handled: false,
      request: null,
      result: null
    };
  }

  let handlerName = null;
  let args = [];

  if (request.action === 'play' && request.entity === 'artist') {
    handlerName = 'playArtist';
    args = [request.artist];
  } else if (request.action === 'play' && request.entity === 'album') {
    handlerName = 'playAlbum';
    args = [request.album, request.artist];
  } else if (request.action === 'play' && request.entity === 'track') {
    handlerName = 'playTrack';
    args = [request.track, request.artist];
  } else if (request.action === 'play' && request.entity === 'title') {
    handlerName = 'playTitle';
    args = [request.album, request.artist];
  } else if (request.action === 'show' && request.entity === 'artist') {
    handlerName = 'showArtist';
    args = [request.artist, request.view];
  }

  if (!handlerName) {
    return {
      handled: false,
      request,
      result: null
    };
  }

  const handler = handlers[handlerName];

  if (typeof handler !== 'function') {
    return {
      handled: true,
      request,
      result: {
        ok: false,
        action: 'not-supported-yet',
        semantic: request,
        missingHandler: handlerName
      }
    };
  }

  return {
    handled: true,
    request,
    result: await handler(...args)
  };
}

module.exports = {
  routeTidalSemanticRequest
};
