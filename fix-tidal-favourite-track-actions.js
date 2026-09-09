'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const target = path.join(__dirname, 'server.js');
const expectedBlobSha = '25cb82a45c45c74790a30c38a7e07317ba047eb2';

function gitBlobSha(content) {
  const body = Buffer.from(content, 'utf8');
  const header = Buffer.from(`blob ${body.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(Buffer.concat([header, body])).digest('hex');
}

function replaceExactlyOnce(source, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error('Expected track-action block was not found');
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error('Expected track-action block is not unique');
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const before = `      await heosBrowse(\n        'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +\n        '&sid=10&cid=' + encodeURIComponent(cid) +\n        '&mid=' + encodeURIComponent(mid) +\n        '&aid=' + aid\n      );`;

const after = `      const heosCid = cid === 'My Music-Tracks'\n        ? encodeURIComponent(cid).replace(/%20/g, ' ')\n        : encodeURIComponent(cid);\n\n      await heosBrowse(\n        'heos://browse/add_to_queue?pid=' + encodeURIComponent(PLAYER_ID) +\n        '&sid=10&cid=' + heosCid +\n        '&mid=' + encodeURIComponent(mid) +\n        '&aid=' + aid\n      );`;

const source = fs.readFileSync(target, 'utf8');
const actualBlobSha = gitBlobSha(source);
if (actualBlobSha !== expectedBlobSha) {
  throw new Error(`server.js guard failed: expected ${expectedBlobSha}, got ${actualBlobSha}`);
}

const updated = replaceExactlyOnce(source, before, after);
const temp = target + '.tmp-favourite-track-actions';
fs.writeFileSync(temp, updated, 'utf8');
fs.renameSync(temp, target);
console.log('server.js:', gitBlobSha(updated));
console.log('Favourite Tracks ordinary action CID fix applied.');
