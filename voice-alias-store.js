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
    version: 1,
    artists: {}
  };

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        state = {
          version: 1,
          artists: parsed.artists && typeof parsed.artists === 'object'
            ? parsed.artists
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

    const entry = state.artists[key];
    if (!entry || !entry.name || !entry.cid) return null;

    return {
      heard: key,
      name: String(entry.name),
      cid: String(entry.cid),
      confirmations: Number(entry.confirmations) || 1,
      updatedAt: Number(entry.updatedAt) || 0
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

  function getStatePath() {
    return statePath;
  }

  load();

  return {
    getArtist,
    learnArtist,
    getStatePath
  };
}

module.exports = {
  createVoiceAliasStore,
  normalise
};
