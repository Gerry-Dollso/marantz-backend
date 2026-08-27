'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const serverPath = path.join(root, 'server.js');
let server = fs.readFileSync(serverPath, 'utf8');

if (server.includes("'/api/tidal/tracks/play-all?'")) {
  throw new Error('Favourite Tracks play-all route already appears to be applied');
}

const anchor = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/playlist/play?')) {\n`;
const index = server.indexOf(anchor);
if (index < 0) {
  throw new Error('Expected TIDAL playlist play route anchor not found');
}

const route = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/tracks/play-all?')) {\n` +
`    try {\n` +
`      const url = new URL(req.url, 'http://localhost');\n` +
`      const shuffle = url.searchParams.get('shuffle') === '1';\n` +
`      const cid = 'My Music-Tracks';\n` +
`      const cacheKey = cid + '|all';\n\n` +
`      const cachedResult = await tidalBrowseCache.get(\n` +
`        cacheKey,\n` +
`        async () => {\n` +
`          const pageSize = 50;\n` +
`          const allItems = [];\n` +
`          let start = 0;\n` +
`          let total = null;\n\n` +
`          while (total === null || start < total) {\n` +
`            const response = await heosBrowse(\n` +
`              'heos://browse/browse?sid=10&cid=' + encodeURIComponent(cid) +\n` +
`              '&range=' + start + ',' + (start + pageSize - 1)\n` +
`            );\n` +
`            const payload = Array.isArray(response.payload) ? response.payload : [];\n` +
`            allItems.push(...payload);\n` +
`            const message = response.heos?.message || '';\n` +
`            const countMatch = message.match(/(?:^|&)count=(\\d+)/);\n` +
`            if (countMatch) total = Number(countMatch[1]);\n` +
`            if (!payload.length) break;\n` +
`            start += payload.length;\n` +
`            if (total === null && payload.length < pageSize) break;\n` +
`          }\n\n` +
`          return {\n` +
`            items: allItems.map(mapBrowseItem),\n` +
`            count: allItems.length\n` +
`          };\n` +
`        },\n` +
`        { refreshAfterMs: 15000, maxStaleMs: 12 * 60 * 60 * 1000 }\n` +
`      );\n\n` +
`      const tracks = (cachedResult.value.items || []).filter(\n` +
`        item => item.playable && item.mid\n` +
`      );\n` +
`      if (!tracks.length) {\n` +
`        throw new Error('Favourite Tracks contains no playable tracks');\n` +
`      }\n\n` +
`      const queueTracks = tracks.slice();\n` +
`      if (shuffle) {\n` +
`        for (let i = queueTracks.length - 1; i > 0; i -= 1) {\n` +
`          const j = Math.floor(Math.random() * (i + 1));\n` +
`          [queueTracks[i], queueTracks[j]] = [queueTracks[j], queueTracks[i]];\n` +
`        }\n` +
`      }\n\n` +
`      await heosBrowse(\n` +
`        'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +\n` +
`        '&sid=10&cid=' + encodeURIComponent(cid) +\n` +
`        '&mid=' + encodeURIComponent(queueTracks[0].mid) +\n` +
`        '&aid=4'\n` +
`      );\n\n` +
`      for (const track of queueTracks.slice(1)) {\n` +
`        await heosBrowse(\n` +
`          'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +\n` +
`          '&sid=10&cid=' + encodeURIComponent(cid) +\n` +
`          '&mid=' + encodeURIComponent(track.mid) +\n` +
`          '&aid=3'\n` +
`        );\n` +
`      }\n\n` +
`      await heosBrowse(\n` +
`        'heos://player/set_play_mode?pid=' + encodeURIComponent(PLAYER_ID) +\n` +
`        '&shuffle=off'\n` +
`      );\n\n` +
`      return sendJson(res, 200, {\n` +
`        ok: true,\n` +
`        queued: queueTracks.length,\n` +
`        shuffle,\n` +
`        firstMid: String(queueTracks[0].mid),\n` +
`        sourceCached: cachedResult.cached\n` +
`      });\n` +
`    } catch (error) {\n` +
`      return sendJson(res, 500, { error: error.message });\n` +
`    }\n` +
`  }\n\n`;

server = server.slice(0, index) + route + server.slice(index);

const backup = serverPath + '.before-tidal-favourite-tracks-play-all';
if (!fs.existsSync(backup)) fs.copyFileSync(serverPath, backup);
fs.writeFileSync(serverPath, server);

console.log('Applied guarded full Favourite Tracks playback migration');
console.log('Backup:', backup);
