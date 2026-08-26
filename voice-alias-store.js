'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function normalise(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createVoiceAliasStore(filePath = null) {
  const statePath = filePath || process.env.MARANTZ_VOICE_ALIASES || path.join(
    os.homedir(),
    '.local',
    'state',
    'marantz-backend',
    'voice-aliases.json'
  );

  let state = {
    version: 2,
    artists: {},
    titles: {}
  };

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        state = {
          version: 2,
          artists: parsed.artists && typeof parsed.artists === 'object'
            ? parsed.artists
            : {},
          titles: parsed.titles && typeof parsed.titles === 'object'
            ? parsed.titles
            : {}
        };
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('VOICE ALIAS LOAD ERROR:', error.message);
      }
    }
  }

  function save() {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const tempPath = statePath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2) + '\n');
    fs.renameSync(tempPath, statePath);
  }

  function getArtist(heard) {
    const key = normalise(heard);
    if (!key) return null;

    const exactEntry = state.artists[key];
    if (exactEntry && exactEntry.name && exactEntry.cid) {
      return {
        heard: key,
        name: String(exactEntry.name),
        cid: String(exactEntry.cid),
        confirmations: Number(exactEntry.confirmations) || 1,
        updatedAt: Number(exactEntry.updatedAt) || 0
      };
    }

    // If Whisper now transcribes the real canonical artist name, reuse a
    // previously confirmed target rather than forcing another search. Only do
    // this when every confirmed entry for that canonical name agrees on one
    // artist CID; ambiguous canonical-name collisions still fail closed.
    const canonicalMatches = Object.values(state.artists)
      .filter(entry => (
        entry &&
        entry.name &&
        entry.cid &&
        normalise(entry.name) === key
      ));

    if (!canonicalMatches.length) return null;

    const cids = new Set(canonicalMatches.map(entry => String(entry.cid)));
    if (cids.size !== 1) return null;

    const newest = canonicalMatches.reduce((best, entry) => (
      (Number(entry.updatedAt) || 0) > (Number(best.updatedAt) || 0)
        ? entry
        : best
    ));

    return {
      heard: key,
      name: String(newest.name),
      cid: String(newest.cid),
      confirmations: canonicalMatches.reduce(
        (total, entry) => total + (Number(entry.confirmations) || 1),
        0
      ),
      updatedAt: Math.max(
        ...canonicalMatches.map(entry => Number(entry.updatedAt) || 0)
      )
    };
  }

  function learnArtist(heard, name, cid) {
    const key = normalise(heard);
    const cleanName = String(name || '').trim();
    const cleanCid = String(cid || '').trim();

    if (!key) throw new Error('Missing heard artist');
    if (!cleanName) throw new Error('Missing selected artist name');
    if (!/^LIBARTIST-\d+$/.test(cleanCid)) {
      throw new Error('Invalid selected artist cid');
    }

    const previous = state.artists[key];
    const sameTarget =
      previous &&
      String(previous.name) === cleanName &&
      String(previous.cid) === cleanCid;

    const entry = {
      name: cleanName,
      cid: cleanCid,
      confirmations: sameTarget
        ? (Number(previous.confirmations) || 1) + 1
        : 1,
      updatedAt: Date.now()
    };

    state.artists[key] = entry;
    save();

    return {
      heard: key,
      ...entry
    };
  }

  function getTitle(artist, heard) {
    const artistKey = normalise(artist);
    const heardKey = normalise(heard);
    if (!artistKey || !heardKey) return null;

    const artistTitles = state.titles[artistKey];
    const entry = artistTitles && artistTitles[heardKey];
    if (!entry || !entry.type || !entry.name) return null;

    return {
      artist: artistKey,
      heard: heardKey,
      type: String(entry.type),
      name: String(entry.name),
      cid: String(entry.cid || ''),
      mid: String(entry.mid || ''),
      confirmations: Number(entry.confirmations) || 1,
      updatedAt: Number(entry.updatedAt) || 0
    };
  }

  function learnTitle(artist, heard, type, name, cid, mid = '') {
    const artistKey = normalise(artist);
    const heardKey = normalise(heard);
    const cleanType = String(type || '').trim().toLowerCase();
    const cleanName = String(name || '').trim();
    const cleanCid = String(cid || '').trim();
    const cleanMid = String(mid || '').trim();

    if (!artistKey) throw new Error('Missing title artist');
    if (!heardKey) throw new Error('Missing heard title');
    if (!['album', 'track'].includes(cleanType)) {
      throw new Error('Invalid selected title type');
    }
    if (!cleanName) throw new Error('Missing selected title name');
    if (!/^LIBALBUM-\d+$/.test(cleanCid)) {
      throw new Error('Invalid selected title cid');
    }
    if (cleanType === 'track' && !/^\d+$/.test(cleanMid)) {
      throw new Error('Invalid selected track mid');
    }

    if (!state.titles[artistKey]) {
      state.titles[artistKey] = {};
    }

    const previous = state.titles[artistKey][heardKey];
    const sameTarget =
      previous &&
      String(previous.type) === cleanType &&
      String(previous.name) === cleanName &&
      String(previous.cid) === cleanCid &&
      String(previous.mid || '') === cleanMid;

    const entry = {
      type: cleanType,
      name: cleanName,
      cid: cleanCid,
      mid: cleanType === 'track' ? cleanMid : '',
      confirmations: sameTarget
        ? (Number(previous.confirmations) || 1) + 1
        : 1,
      updatedAt: Date.now()
    };

    state.titles[artistKey][heardKey] = entry;
    save();

    return {
      artist: artistKey,
      heard: heardKey,
      ...entry
    };
  }

  function getStatePath() {
    return statePath;
  }

  load();

  return {
    getArtist,
    learnArtist,
    getTitle,
    learnTitle,
    getStatePath
  };
}

module.exports = {
  createVoiceAliasStore,
  normalise
};
