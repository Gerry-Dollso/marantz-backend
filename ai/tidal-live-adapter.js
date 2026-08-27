'use strict';

const {
  routeTidalSemanticRequest
} = require('./tidal-semantic-router');

function createTidalLiveAdapter({
  playArtist,
  playTitle,
  setPendingSearch,
  showArtist
}) {
  if (typeof playArtist !== 'function') {
    throw new Error('Missing playArtist handler');
  }

  if (typeof playTitle !== 'function') {
    throw new Error('Missing playTitle handler');
  }

  if (typeof setPendingSearch !== 'function') {
    throw new Error('Missing setPendingSearch handler');
  }

  async function playArtistSafely(artist, command) {
    try {
      return await playArtist(artist);
    } catch (error) {
      if (!/^TIDAL artist not found safely:/.test(String(error.message || ''))) {
        throw error;
      }

      return setPendingSearch({
        query: artist,
        heard: command,
        requestedTitle: '',
        type: 'artist',
        artist: '',
        artistCid: '',
        reason: error.message
      });
    }
  }

  async function playTitleSafely(title, artist, requestedType, command) {
    try {
      return await playTitle(title, artist, requestedType);
    } catch (error) {
      const safeFailure =
        /^TIDAL (?:artist|album|track|title) not found safely:/.test(
          String(error.message || '')
        );

      if (!safeFailure) throw error;

      const context =
        error.tidalVoiceContext &&
        typeof error.tidalVoiceContext === 'object'
          ? error.tidalVoiceContext
          : {};

      return setPendingSearch({
        query: artist,
        heard: command,
        requestedTitle: title,
        type: context.type || (
          /^TIDAL artist not found safely:/.test(String(error.message || ''))
            ? 'artist'
            : 'title'
        ),
        requestedType: requestedType || 'auto',
        artist: context.artist || '',
        artistCid: context.artistCid || '',
        reason: error.message
      });
    }
  }

  return async function handleTidalSemanticCommand(command) {
    const routed = await routeTidalSemanticRequest(command, {
      playArtist: artist => playArtistSafely(artist, command),
      playAlbum: (album, artist) =>
        playTitleSafely(album, artist, 'album', command),
      playTrack: (track, artist) =>
        playTitleSafely(track, artist, 'track', command),
      playTitle: (title, artist) =>
        playTitleSafely(title, artist, 'auto', command),
      showArtist: typeof showArtist === 'function'
        ? (artist, view) => showArtist(artist, view)
        : undefined
    });

    return routed;
  };
}

module.exports = {
  createTidalLiveAdapter
};
