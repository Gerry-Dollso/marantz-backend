'use strict';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MUSICBRAINZ_GAP_MS = 1100;
const TRANSIENT_RETRIES = 2;
const USER_AGENT = 'MarantzPi/1.0 (personal music display)';

function createArtistBiography(options = {}) {
  const fetchImpl = options.fetch || global.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is required');

  const cache = new Map();
  const inFlight = new Map();
  let lastMusicBrainzRequestAt = 0;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalise = value => String(value || '').trim().toLowerCase();

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

  function releaseTitleSet(releaseGroups) {
    return new Set((releaseGroups || []).map(item => normalise(item?.title)).filter(Boolean));
  }

  function scoreCandidate(candidate, albumTitles, releaseGroups) {
    let score = 0;
    const wanted = new Set((albumTitles || []).map(normalise).filter(Boolean));
    const known = releaseTitleSet(releaseGroups);
    for (const title of wanted) if (known.has(title)) score += 1;
    if (candidate?.disambiguation) score += 0.05;
    return score;
  }

  async function resolveMusicBrainz(name, albumTitles) {
    const query = encodeURIComponent('artist:"' + String(name || '').replace(/"/g, '') + '"');
    const search = await musicBrainzJson('https://musicbrainz.org/ws/2/artist/?query=' + query + '&fmt=json&limit=8');
    const exact = (search.artists || []).filter(item => normalise(item?.name) === normalise(name));
    if (!exact.length) return null;

    const candidates = [];
    for (const candidate of exact.slice(0, 5)) {
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

  async function wikipediaFromMusicBrainz(mbid) {
    const relations = await musicBrainzJson('https://musicbrainz.org/ws/2/artist/' + encodeURIComponent(mbid) + '?inc=url-rels&fmt=json');
    const wikidata = (relations.relations || []).find(rel => rel?.type === 'wikidata' && rel?.url?.resource);
    const qid = wikidata?.url?.resource?.match(/(Q\d+)$/)?.[1];
    if (!qid) return null;

    const entity = await fetchJson('https://www.wikidata.org/wiki/Special:EntityData/' + encodeURIComponent(qid) + '.json');
    const title = entity?.entities?.[qid]?.sitelinks?.enwiki?.title;
    if (!title) return null;

    const summary = await fetchJson('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title), {
      'User-Agent': USER_AGENT
    });
    const text = String(summary?.extract || '').trim();
    if (!text) return null;
    return {
      text,
      teaser: text,
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
    return wikipediaFromMusicBrainz(candidate.id);
  }

  async function getBiography(input, options = {}) {
    const artistId = String(input?.artistId || '').trim();
    const name = String(input?.name || '').trim();
    const key = artistId || normalise(name);
    if (!key || !name) return null;
    const forceRefresh = options.forceRefresh === true;
    const cached = cache.get(key);
    if (!forceRefresh && cached && Date.now() < cached.expiresAt) return cached.value;
    if (!forceRefresh && inFlight.has(key)) return inFlight.get(key);
    const promise = (async () => {
      try {
        const value = await load(input);
        cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
        return value;
      } catch (error) {
        console.warn('Artist biography lookup failed:', name, error.message);
        return null;
      }
    })();
    inFlight.set(key, promise);
    try { return await promise; } finally { if (inFlight.get(key) === promise) inFlight.delete(key); }
  }

  return { getBiography };
}

module.exports = { createArtistBiography };
