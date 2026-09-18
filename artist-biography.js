'use strict';

const { createTidalArtistBiographyStore } = require('./tidal-artist-biography-store');

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MUSICBRAINZ_GAP_MS = 1100;
const TRANSIENT_RETRIES = 2;
const TEASER_MAX_CHARS = 180;
const USER_AGENT = 'MarantzPi/1.0 (personal music display)';

function createArtistBiography(options = {}) {
  const fetchImpl = options.fetch || global.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is required');
  const persistentStore = options.persistentStore || createTidalArtistBiographyStore(options.persistentStoreOptions);

  const cache = new Map();
  const inFlight = new Map();
  let lastMusicBrainzRequestAt = 0;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalise = value => String(value || '')
    .normalize('NFKC')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .trim()
    .toLowerCase();

  function teaser(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= TEASER_MAX_CHARS) return clean;
    const cut = clean.slice(0, TEASER_MAX_CHARS + 1);
    const boundary = cut.lastIndexOf(' ');
    return (boundary > 0 ? cut.slice(0, boundary) : clean.slice(0, TEASER_MAX_CHARS)).trimEnd() + '…';
  }

  function transientStatus(status) {
    return status === 429 || status >= 500;
  }

  async function fetchJson(url, headers = {}) {
    let lastError;
    for (let attempt = 0; attempt <= TRANSIENT_RETRIES; attempt += 1) {
      try {
        const response = await fetchImpl(url, { headers: { Accept: 'application/json', ...headers } });
        if (response.ok) return response.json();
        const error = new Error('HTTP ' + response.status + ' from ' + new URL(url).hostname);
        error.transient = transientStatus(response.status);
        if (!error.transient || attempt === TRANSIENT_RETRIES) throw error;
        lastError = error;
      } catch (error) {
        if (error.transient === false) throw error;
        error.transient = true;
        lastError = error;
        if (attempt === TRANSIENT_RETRIES) throw error;
      }
      await sleep(750 * (attempt + 1));
    }
    throw lastError;
  }

  async function musicBrainzJson(url) {
    const wait = MUSICBRAINZ_GAP_MS - (Date.now() - lastMusicBrainzRequestAt);
    if (wait > 0) await sleep(wait);
    lastMusicBrainzRequestAt = Date.now();
    return fetchJson(url, { 'User-Agent': USER_AGENT });
  }

  const normaliseReleaseTitle = value => normalise(value).replace(/\s*\(remastered\)$/, '').trim();

  function releaseTitleSet(releaseGroups) {
    return new Set((releaseGroups || []).map(item => normaliseReleaseTitle(item?.title)).filter(Boolean));
  }

  function scoreCandidate(candidate, albumTitles, releaseGroups) {
    let score = 0;
    const wanted = new Set((albumTitles || []).map(normaliseReleaseTitle).filter(Boolean));
    const known = releaseTitleSet(releaseGroups);
    for (const title of wanted) if (known.has(title)) score += 1;
    if (candidate?.disambiguation) score += 0.05;
    return score;
  }

  async function resolveMusicBrainz(name, albumTitles) {
    const query = encodeURIComponent('artist:"' + String(name || '').replace(/"/g, '') + '"');
    const search = await musicBrainzJson('https://musicbrainz.org/ws/2/artist/?query=' + query + '&fmt=json&limit=8');
    const wantedName = normalise(name);
    const exact = (search.artists || []).filter(item => normalise(item?.name) === wantedName);
    const aliasMatches = [];
    if (!exact.length) {
      for (const candidate of (search.artists || []).slice(0, 5)) {
        const details = await musicBrainzJson('https://musicbrainz.org/ws/2/artist/' + encodeURIComponent(candidate.id) + '?inc=aliases&fmt=json');
        if ((details.aliases || []).some(alias => normalise(alias?.name) === wantedName)) aliasMatches.push(candidate);
      }
    }
    let nameMatches = exact.length ? exact : aliasMatches;
    if (!nameMatches.length) {
      const broadQuery = encodeURIComponent(String(name || '').replace(/"/g, ''));
      const broadSearch = await musicBrainzJson('https://musicbrainz.org/ws/2/artist/?query=' + broadQuery + '&fmt=json&limit=8');
      const broadExact = (broadSearch.artists || []).filter(item => normalise(item?.name) === wantedName);
      const broadAliasMatches = [];
      if (!broadExact.length) {
        for (const candidate of (broadSearch.artists || []).slice(0, 5)) {
          const details = await musicBrainzJson('https://musicbrainz.org/ws/2/artist/' + encodeURIComponent(candidate.id) + '?inc=aliases&fmt=json');
          if ((details.aliases || []).some(alias => normalise(alias?.name) === wantedName)) broadAliasMatches.push(candidate);
        }
      }
      nameMatches = broadExact.length ? broadExact : broadAliasMatches;
    }
    if (!nameMatches.length) return null;

    const candidates = [];
    for (const candidate of nameMatches.slice(0, 5)) {
      const releases = await musicBrainzJson('https://musicbrainz.org/ws/2/release-group?artist=' + encodeURIComponent(candidate.id) + '&fmt=json&limit=100');
      candidates.push({ candidate, score: scoreCandidate(candidate, albumTitles, releases['release-groups']) });
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const second = candidates[1];
    if (!best || best.score < 1) return null;
    if (second && best.score - second.score < 0.5) return null;
    return best.candidate;
  }

  async function wikipediaFromVerifiedMusicBrainzName(mbid, name) {
    console.warn('Artist biography Wikipedia fallback diagnostic:', { mbid, name });
    const searchUrl = 'https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=' + encodeURIComponent(name) + '&gsrnamespace=0&gsrlimit=5&prop=pageprops&ppprop=wikibase_item&format=json&formatversion=2';
    const search = await fetchJson(searchUrl, { 'User-Agent': USER_AGENT });
    const pages = search?.query?.pages || [];
    for (const page of pages) {
      const qid = page?.pageprops?.wikibase_item;
      if (!/^Q\d+$/.test(String(qid || ''))) continue;
      const entity = await fetchJson('https://www.wikidata.org/wiki/Special:EntityData/' + encodeURIComponent(qid) + '.json');
      const claims = entity?.entities?.[qid]?.claims?.P434 || [];
      const mbids = claims.map(claim => claim?.mainsnak?.datavalue?.value).filter(Boolean);
      if (!mbids.includes(mbid)) continue;
      const title = entity?.entities?.[qid]?.sitelinks?.enwiki?.title;
      if (!title) continue;
      const summary = await fetchJson('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title), { 'User-Agent': USER_AGENT });
      const text = String(summary?.extract || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      return { text, teaser: teaser(text), source: 'Wikipedia', sourceUrl: String(summary?.content_urls?.desktop?.page || ''), musicBrainzId: mbid, wikidataId: qid, wikipediaTitle: title };
    }
    return null;
  }

  async function wikipediaFromMusicBrainz(mbid, name) {
    const relations = await musicBrainzJson('https://musicbrainz.org/ws/2/artist/' + encodeURIComponent(mbid) + '?inc=url-rels&fmt=json');
    const wikidata = (relations.relations || []).find(rel => rel?.type === 'wikidata' && rel?.url?.resource);
    const qid = wikidata?.url?.resource?.match(/(Q\d+)$/)?.[1];
    if (!qid) return wikipediaFromVerifiedMusicBrainzName(mbid, name);

    const entity = await fetchJson('https://www.wikidata.org/wiki/Special:EntityData/' + encodeURIComponent(qid) + '.json');
    const title = entity?.entities?.[qid]?.sitelinks?.enwiki?.title;
    if (!title) return null;

    const summary = await fetchJson('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title), {
      'User-Agent': USER_AGENT
    });
    const text = String(summary?.extract || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return {
      text,
      teaser: teaser(text),
      source: 'Wikipedia',
      sourceUrl: String(summary?.content_urls?.desktop?.page || ''),
      musicBrainzId: mbid,
      wikidataId: qid,
      wikipediaTitle: title
    };
  }

  async function load(input) {
    const name = String(input?.name || '').trim();
    if (!name) return null;
    const candidate = await resolveMusicBrainz(name, input?.albumTitles || []);
    if (!candidate) return null;
    return wikipediaFromMusicBrainz(candidate.id, name);
  }

  function remember(key, value, createdAt) {
    cache.set(key, { value, createdAt, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  function startRefresh(key, artistId, input) {
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = (async () => {
      try {
        const value = await load(input);
        const createdAt = Date.now();
        remember(key, value, createdAt);
        if (/^\d+$/.test(artistId)) {
          try { persistentStore.write(artistId, value, createdAt); }
          catch (error) { console.warn('Artist biography persistent cache write failed:', error.message); }
        }
        return value;
      } catch (error) {
        console.warn('Artist biography lookup failed:', String(input?.name || '').trim(), error.message);
        return null;
      }
    })();
    inFlight.set(key, promise);
    promise.finally(() => { if (inFlight.get(key) === promise) inFlight.delete(key); }).catch(() => {});
    return promise;
  }

  async function getBiography(input, options = {}) {
    const artistId = String(input?.artistId || '').trim();
    const name = String(input?.name || '').trim();
    const key = artistId || normalise(name);
    if (!key || !name) return null;
    const forceRefresh = options.forceRefresh === true;
    const cached = cache.get(key);
    if (!forceRefresh && cached && Date.now() < cached.expiresAt) return cached.value;
    if (!forceRefresh && /^\d+$/.test(artistId)) {
      const disk = persistentStore.read(artistId);
      if (disk) {
        remember(key, disk.value, disk.createdAt);
        if (!disk.fresh) startRefresh(key, artistId, input).catch(error => console.warn('Artist biography background refresh failed:', error.message));
        return disk.value;
      }
    }
    if (!forceRefresh && inFlight.has(key)) return inFlight.get(key);
    return startRefresh(key, artistId, input);
  }

  return { getBiography };
}

module.exports = { createArtistBiography };
