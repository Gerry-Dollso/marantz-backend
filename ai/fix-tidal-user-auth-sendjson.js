'use strict';

const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '..', 'tidal-user-auth-recon.js');
const before = fs.readFileSync(target, 'utf8');

const oldBlock = `function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload, null, 2));
}`;

const newBlock = `function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload, null, 2));
  return true;
}`;

if (before.includes(newBlock)) {
  console.log('Already fixed: sendJson returns true');
  process.exit(0);
}

const matches = before.split(oldBlock).length - 1;
if (matches !== 1) {
  throw new Error(`Expected exactly one sendJson block, found ${matches}`);
}

const after = before.replace(oldBlock, newBlock);
fs.writeFileSync(target, after);
console.log('Fixed: sendJson now returns true');
