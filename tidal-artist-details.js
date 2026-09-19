'use strict';

const { createArtistBiography } = require('./artist-biography');
const { createTidalArtistDetailsStore } = require('./tidal-artist-details-store');
const { createTidalArtistTopTracksStore } = require('./tidal-artist-top-tracks-store');
const { createTidalAlbumMetadataStore } = require('./tidal-album-metadata-store');

const ARTIST_DETAILS_TTL_MS = 15 * 60 * 1000;
const MAX_TRACK_PAGES = 50;
const TOP_TRACK_LIMIT = 10;
const RELEASE_PREVIEW_LIMIT = 3;

function createTidalArtistDetails(options = {}) {
  const apiGet = options.apiGet;
  const getAlbumMetadata = options.getAlbumMetadata;
  const heosBrowse = options.heosBrowse;
  const countryCode = String(options.countryCode || 'GB').trim() || 'GB';
  if (typeof apiGet !== 'function') throw new Error('apiGet is required');
  if (typeof getAlbumMetadata !== 'function') throw new Error('getAlbumMetadata is required');
  if (typeof heosBrowse !== 'function') throw new Error('heosBrowse is required');
  const biographyResolver = options.biographyResolver || createArtistBiography();
  const persistentStore = options.persistentStore || createTidalArtistDetailsStore(options.persistentStoreOptions);
  const topTracksStore = options.topTracksStore || createTidalArtistTopTracksStore(options.topTracksStoreOptions);
  const albumMetadataStore = options.albumMetadataStore || createTidalAlbumMetadataStore(options.albumMetadataStoreOptions);

  const cache = new Map();
  const inFlight = new Map();
  const topTracksCache = new Map();
  const topTracksInFlight = new Map();

  function resources(payload, type) {
    return (Array.isArray(payload?.included) ? payload.included : []).filter(item => item && item.type === type);
  }

  function artworkUrl(resource) {
    const files = resource?.attributes?.files;
    if (!Array.isArray(files) || !files.length) return '';
    const sorted = files.slice().sort((a, b) =>
      (Number(b.width) || 0) * (Number(b.height) || 0) - (Number(a.width) || 0) * (Number(a.height) || 0)
    );
    return String(sorted[0]?.href || sorted[0]?.url || '');
  }

  function artworkMap(payload) {
    return new Map(resources(payload, 'artworks').map(item => [String(item.id), artworkUrl(item)]));
  }

  function relatedId(resource, key) {
    const data = resource?.relationships?.[key]?.data;
    const first = Array.isArray(data) ? data[0] : data;
    return first?.id ? String(first.id) : '';
  }

  function mapArtist(resource, art) {
    const a = resource?.attributes || {};
    const artId = relatedId(resource, 'profileArt');
    return {
      id: String(resource?.id || ''), name: String(a.name || ''), fans: Number(a.numberOfFollowers) || 0,
      popularity: Number(a.popularity) || 0, imageUrl: art.get(artId) || '',
      heosCid: resource?.id ? 'LIBARTIST-' + resource.id : ''
    };
  }

  function mapAlbum(resource, art) {
    const a = resource?.attributes || {};
    const artId = relatedId(resource, 'coverArt');
    return {
      id: String(resource?.id || ''), title: String(a.title || ''), releaseDate: String(a.releaseDate || ''),
      albumType: String(a.albumType || ''), version: String(a.version || ''), numberOfItems: Number(a.numberOfItems) || 0,
      popularity: Number(a.popularity) || 0, imageUrl: art.get(artId) || '',
      heosCid: resource?.id ? 'LIBALBUM-' + resource.id : ''
    };
  }

  function mapTrack(resource, payload, art) {
    const a = resource?.attributes || {};
    const albumId = relatedId(resource, 'albums') || relatedId(resource, 'album');
    const album = resources(payload, 'albums').find(item => String(item.id) === albumId);
    const albumArtId = relatedId(album, 'coverArt');
    return {
      id: String(resource?.id || ''), title: String(a.title || ''), popularity: Number(a.popularity) || 0,
      duration: Number(a.duration) || 0, explicit: Boolean(a.explicit), albumId,
      album: String(album?.attributes?.title || ''), imageUrl: art.get(albumArtId) || ''
    };
  }

  async function heosArtistCategory(artistId, category, limit = null) {
    const cid = `LIBARTIST-${category}-${artistId}`;
    const rows = [];
    let start = 0;
    let total = null;
    const requestedLimit = Number.isInteger(limit) && limit > 0 ? limit : null;
    while ((total === null || start < total) && (requestedLimit === null || rows.length < requestedLimit)) {
      const encodedCid = encodeURIComponent(cid).replace(/%20/g, ' ');
      const pageSize = requestedLimit === null ? 50 : Math.min(50, requestedLimit - rows.length);
      const response = await heosBrowse(`heos://browse/browse?sid=10&cid=${encodedCid}&range=${start},${start + pageSize - 1}`);
      const payload = Array.isArray(response.payload) ? response.payload : [];
      rows.push(...payload.slice(0, pageSize));
      const match = String(response.heos?.message || '').match(/(?:^|&)count=(\d+)/);
      if (match) total = Number(match[1]);
      if (payload.length === 0) break;
      start += payload.length;
      if (total === null && payload.length < pageSize) break;
    }
    return { cid, total, rows };
  }

  async function relationship(artistId, name, include, extra = '') {
    return apiGet('/artists/' + encodeURIComponent(artistId) + '/relationships/' + encodeURIComponent(name) + '?' + extra +
      'include=' + encodeURIComponent(include) + '&countryCode=' + encodeURIComponent(countryCode));
  }

  async function getAllTracks(artistId) {
    const byId = new Map();
    let cursor = '';
    for (let page = 0; page < MAX_TRACK_PAGES; page += 1) {
      const suffix = cursor ? '&page%5Bcursor%5D=' + encodeURIComponent(cursor) : '';
      const payload = await apiGet('/artists/' + encodeURIComponent(artistId) + '/relationships/tracks' +
        '?collapseBy=FINGERPRINT&include=' + encodeURIComponent('tracks.albums,tracks.artists,tracks.albums.coverArt') +
        '&countryCode=' + encodeURIComponent(countryCode) + suffix);
      const art = artworkMap(payload);
      for (const track of resources(payload, 'tracks')) {
        const mapped = mapTrack(track, payload, art);
        const previous = byId.get(mapped.id);
        if (!previous || mapped.popularity > previous.popularity) byId.set(mapped.id, mapped);
      }
      cursor = String(payload?.links?.meta?.nextCursor || payload?.meta?.nextCursor || '');
      if (!cursor) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return Array.from(byId.values()).sort((a, b) => b.popularity - a.popularity || a.title.localeCompare(b.title)).slice(0, TOP_TRACK_LIMIT);
  }

  async function enrichHeosAlbums(groups) {
    const ids = [];
    for (const rows of groups) for (const row of rows) {
      const match = String(row?.cid || '').match(/^LIBALBUM-(\d+)$/);
      if (match) ids.push(match[1]);
    }
    const uniqueIds = Array.from(new Set(ids));
    const byId = new Map();
    const missingIds = [];
    for (const id of uniqueIds) {
      const cached = albumMetadataStore.read(id);
      if (cached) byId.set(id, cached);
      else missingIds.push(id);
    }
    if (missingIds.length) {
      const metadata = await getAlbumMetadata(missingIds);
      for (const item of metadata) {
        const id = String(item.id);
        byId.set(id, item);
        try { albumMetadataStore.write(id, item); }
        catch (error) { console.warn('TIDAL album metadata cache write failed:', id, error.message); }
      }
    }
    return groups.map(rows => rows.map(row => {
      const match = String(row?.cid || '').match(/^LIBALBUM-(\d+)$/);
      const item = match ? byId.get(match[1]) : null;
      if (item === undefined || item === null) return row;
      return { ...row, albumId: item.id, name: item.title || row.name, title: item.title || row.title || row.name, artist: item.artist || row.artist, artistId: item.artistId, releaseDate: item.releaseDate, albumType: item.albumType, version: item.version, explicit: item.explicit, numberOfItems: item.numberOfItems, mediaTags: item.mediaTags, imageUrl: item.artwork || row.imageUrl };
    }));
  }

  async function load(artistId) {
    const startedAt = Date.now();
    let stageAt = startedAt;
    const timing = {};
    const mark = name => {
      const now = Date.now();
      timing[name] = now - stageAt;
      stageAt = now;
    };
    const pause = () => new Promise(resolve => setTimeout(resolve, 250));
    const artistPayload = await apiGet('/artists/' + encodeURIComponent(artistId) + '?include=profileArt&countryCode=' + encodeURIComponent(countryCode));
    mark('artistProfileMs');
    await pause();
    const albumsHeos = await heosArtistCategory(artistId, 'Albums', RELEASE_PREVIEW_LIMIT);
    mark('albumsHeosMs');
    const singlesHeos = await heosArtistCategory(artistId, 'EP n Singles', RELEASE_PREVIEW_LIMIT);
    mark('singlesHeosMs');
    const appearsOnHeos = await heosArtistCategory(artistId, 'Other Albums', RELEASE_PREVIEW_LIMIT);
    mark('appearsOnHeosMs');
    await pause();
    const radioPayload = await relationship(artistId, 'radio', 'radio,radio.coverArt,radio.items');
    mark('radioMs');
    await pause();
    const similarPayload = await relationship(artistId, 'similarArtists', 'similarArtists.profileArt');
    mark('similarArtistsMs');

    const artistArt = artworkMap(artistPayload);
    const artistResource = Array.isArray(artistPayload?.data) ? artistPayload.data[0] : artistPayload?.data;
    const artist = mapArtist(artistResource, artistArt);
    const [albums, singles, appearsOn] = await enrichHeosAlbums([albumsHeos.rows, singlesHeos.rows, appearsOnHeos.rows]);
    mark('albumMetadataEnrichmentMs');
    const similarArt = artworkMap(similarPayload);
    const similarArtists = resources(similarPayload, 'artists').map(item => mapArtist(item, similarArt));
    const radioResource = resources(radioPayload, 'playlists')[0] || null;
    const radio = radioResource ? { playlistId: String(radioResource.id || ''), name: String(radioResource.attributes?.name || radioResource.attributes?.title || artist.name || '') } : null;

    timing.totalMs = Date.now() - startedAt;
    console.log('[Artist Details timing]', JSON.stringify({ artistId: String(artistId), artist: artist.name, ...timing }));

    return { artist, topTracks: [], albums, singles, radio, similarArtists, biography: null, appearsOn, source: 'TIDAL + HEOS hybrid' };
  }

  function remember(id, value, createdAt) {
    cache.set(id, { value, createdAt, expiresAt: Date.now() + ARTIST_DETAILS_TTL_MS });
  }

  function startRefresh(id) {
    if (inFlight.has(id)) return inFlight.get(id);
    const promise = (async () => {
      const value = await load(id);
      const createdAt = Date.now();
      remember(id, value, createdAt);
      try { persistentStore.write(id, value, createdAt); }
      catch (error) { console.warn('TIDAL Artist Details persistent cache write failed:', error.message); }
      return { ...value, cached: false, cacheAgeMs: 0, cacheSource: 'refresh' };
    })();
    inFlight.set(id, promise);
    promise.finally(() => { if (inFlight.get(id) === promise) inFlight.delete(id); }).catch(() => {});
    return promise;
  }

  async function getArtistDetails(artistId, options = {}) {
    const id = String(artistId || '').trim();
    if (!/^\d+$/.test(id)) throw new Error('Artist id must contain digits only');
    const forceRefresh = options.forceRefresh === true;
    const cached = cache.get(id);
    if (!forceRefresh && cached && Date.now() < cached.expiresAt) {
      return { ...cached.value, cached: true, cacheAgeMs: Date.now() - cached.createdAt, cacheSource: 'memory' };
    }
    if (!forceRefresh) {
      const disk = persistentStore.read(id);
      if (disk) {
        remember(id, disk.value, disk.createdAt);
        if (!disk.fresh) startRefresh(id).catch(error => console.warn('TIDAL Artist Details background refresh failed:', error.message));
        return { ...disk.value, cached: true, cacheAgeMs: disk.ageMs, cacheSource: disk.fresh ? 'disk' : 'disk-stale', refreshing: !disk.fresh };
      }
      if (inFlight.has(id)) return inFlight.get(id);
    }
    return startRefresh(id);
  }

  function rememberTopTracks(id, value, createdAt) {
    topTracksCache.set(id, { value, createdAt, expiresAt: Date.now() + ARTIST_DETAILS_TTL_MS });
  }

  function startTopTracksRefresh(id) {
    if (topTracksInFlight.has(id)) return topTracksInFlight.get(id);
    const promise = (async () => {
      const value = await getAllTracks(id);
      const createdAt = Date.now();
      rememberTopTracks(id, value, createdAt);
      try { topTracksStore.write(id, value, createdAt); }
      catch (error) { console.warn('TIDAL Artist Top Tracks persistent cache write failed:', error.message); }
      return { tracks: value, cached: false, cacheAgeMs: 0, cacheSource: 'refresh' };
    })();
    topTracksInFlight.set(id, promise);
    promise.finally(() => { if (topTracksInFlight.get(id) === promise) topTracksInFlight.delete(id); }).catch(() => {});
    return promise;
  }

  async function getArtistTopTracks(artistId, options = {}) {
    const id = String(artistId || '').trim();
    if (!/^\d+$/.test(id)) throw new Error('Artist id must contain digits only');
    const forceRefresh = options.forceRefresh === true;
    const cached = topTracksCache.get(id);
    if (!forceRefresh && cached && Date.now() < cached.expiresAt) {
      return { tracks: cached.value, cached: true, cacheAgeMs: Date.now() - cached.createdAt, cacheSource: 'memory' };
    }
    if (!forceRefresh) {
      const disk = topTracksStore.read(id);
      if (disk) {
        rememberTopTracks(id, disk.value, disk.createdAt);
        if (!disk.fresh) startTopTracksRefresh(id).catch(error => console.warn('TIDAL Artist Top Tracks background refresh failed:', error.message));
        return { tracks: disk.value, cached: true, cacheAgeMs: disk.ageMs, cacheSource: disk.fresh ? 'disk' : 'disk-stale', refreshing: !disk.fresh };
      }
      if (topTracksInFlight.has(id)) return topTracksInFlight.get(id);
    }
    return startTopTracksRefresh(id);
  }

  async function getArtistReleases(artistId, category) {
    const id = String(artistId || '').trim();
    if (!/^\d+$/.test(id)) throw new Error('Artist id must contain digits only');
    const categories = { albums: 'Albums', singles: 'EP n Singles', appears: 'Other Albums' };
    const heosCategory = categories[String(category || '').trim()];
    if (!heosCategory) throw new Error('Invalid Artist release category');
    const result = await heosArtistCategory(id, heosCategory);
    const [releases] = await enrichHeosAlbums([result.rows]);
    return { category: String(category), total: Number.isFinite(result.total) ? result.total : releases.length, releases };
  }

  async function getArtistBiography(artistId, options = {}) {
    const id = String(artistId || '').trim();
    if (!/^\d+$/.test(id)) throw new Error('Artist id must contain digits only');
    const details = await getArtistDetails(id);
    const artist = details?.artist || {};
    const name = String(artist.name || '').trim();
    if (!name) return null;
    // Biography identity matching must not depend on the three-item landing previews.
    // Use the full HEOS Albums category as conservative MusicBrainz release evidence;
    // keep the fast 3/3/3 Artist landing unchanged.
    const fullAlbums = await heosArtistCategory(id, 'Albums');
    const albumTitles = (fullAlbums.rows || [])
      .map(item => item.name || item.title)
      .filter(Boolean);
    return biographyResolver.getBiography({ artistId: id, name, albumTitles }, options);
  }

  return { getArtistDetails, getArtistTopTracks, getArtistReleases, getArtistBiography };
}

module.exports = { createTidalArtistDetails };
