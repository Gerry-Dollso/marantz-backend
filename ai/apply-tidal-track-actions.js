'use strict';

// One-shot, guarded migration helper for adding generic TIDAL track queue actions.
// Refuses to edit unless the expected existing playlist endpoint anchor is present.

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let source = fs.readFileSync(serverPath, 'utf8');

if (source.includes("/api/tidal/track/action")) {
  throw new Error('TIDAL track action endpoint already appears to be applied');
}

const anchor = "  if (req.method === 'GET' && req.url.startsWith('/api/tidal/playlist/play?')) {\n";

if (!source.includes(anchor)) {
  throw new Error('Expected playlist endpoint anchor not found; refusing to edit server.js');
}

const endpoint = `  if (req.method === 'GET' && req.url.startsWith('/api/tidal/track/action?')) {\n    try {\n      const url = new URL(req.url, 'http://localhost');\n      const cid = String(url.searchParams.get('cid') || '').trim();\n      const mid = String(url.searchParams.get('mid') || '').trim();\n      const action = String(url.searchParams.get('action') || '').trim();\n\n      if (!cid || !mid) {\n        return sendJson(res, 400, { error: 'Missing cid or mid' });\n      }\n\n      const aidByAction = {\n        'play-now': 1,\n        'play-next': 2,\n        'add-end': 3,\n        'play-only': 4\n      };\n\n      if (action === 'play-from-here') {\n        const pageSize = 50;\n        const tracks = [];\n        let start = 0;\n        let total = null;\n\n        while (total === null || start < total) {\n          const response = await heosBrowse(\n            'heos://browse/browse?sid=10&cid=' + encodeURIComponent(cid) +\n            '&range=' + start + ',' + (start + pageSize - 1)\n          );\n          const payload = Array.isArray(response.payload)\n            ? response.payload\n            : [];\n          tracks.push(...payload.filter(\n            item => item.playable === 'yes' && item.mid\n          ));\n\n          const message = response.heos?.message || '';\n          const countMatch = message.match(/(?:^|&)count=(\\d+)/);\n          if (countMatch) total = Number(countMatch[1]);\n          if (!payload.length) break;\n          start += payload.length;\n          if (total === null && payload.length < pageSize) break;\n        }\n\n        const startIndex = tracks.findIndex(\n          item => String(item.mid) === mid\n        );\n\n        if (startIndex < 0) {\n          return sendJson(res, 404, {\n            error: 'Selected track not found in container'\n          });\n        }\n\n        const remaining = tracks.slice(startIndex);\n\n        await heosBrowse(\n          'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +\n          '&sid=10&cid=' + encodeURIComponent(cid) +\n          '&mid=' + encodeURIComponent(remaining[0].mid) +\n          '&aid=4'\n        );\n\n        for (const track of remaining.slice(1)) {\n          await heosBrowse(\n            'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +\n            '&sid=10&cid=' + encodeURIComponent(cid) +\n            '&mid=' + encodeURIComponent(track.mid) +\n            '&aid=3'\n          );\n        }\n\n        return sendJson(res, 200, {\n          ok: true,\n          action,\n          queued: remaining.length,\n          selectedMid: mid\n        });\n      }\n\n      const aid = aidByAction[action];\n      if (!aid) {\n        return sendJson(res, 400, { error: 'Unknown track action' });\n      }\n\n      await heosBrowse(\n        'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +\n        '&sid=10&cid=' + encodeURIComponent(cid) +\n        '&mid=' + encodeURIComponent(mid) +\n        '&aid=' + aid\n      );\n\n      return sendJson(res, 200, {\n        ok: true,\n        action,\n        selectedMid: mid\n      });\n    } catch (error) {\n      return sendJson(res, 500, { error: error.message });\n    }\n  }\n\n`;

source = source.replace(anchor, endpoint + anchor);

const backupPath = serverPath + '.before-tidal-track-actions';
if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(serverPath, backupPath);
}

fs.writeFileSync(serverPath, source);
console.log('Applied guarded TIDAL track action endpoint to server.js');
console.log('Backup:', backupPath);
