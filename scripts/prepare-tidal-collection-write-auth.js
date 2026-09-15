'use strict';

const fs = require('fs');
const path = require('path');

const checkOnly = process.argv.includes('--check');
const target = path.resolve(__dirname, '..', 'tidal-user-auth-recon.js');
const source = fs.readFileSync(target, 'utf8');

const oldScopes = "const DEFAULT_SCOPES = ['recommendations.read', 'user.read', 'collection.read', 'search.read'];";
const newScopes = "const DEFAULT_SCOPES = ['recommendations.read', 'user.read', 'collection.read', 'collection.write', 'search.read'];";

if (source.includes(newScopes)) {
  console.log(checkOnly ? 'OK: collection.write scope already present' : 'No change: collection.write scope already present');
  process.exit(0);
}

const occurrences = source.split(oldScopes).length - 1;
if (occurrences !== 1) {
  throw new Error(`Expected exactly one DEFAULT_SCOPES anchor, found ${occurrences}`);
}

if (checkOnly) {
  console.log('OK: guarded collection.write scope patch can be applied cleanly');
  process.exit(0);
}

fs.writeFileSync(target, source.replace(oldScopes, newScopes));
console.log('Updated tidal-user-auth-recon.js to request collection.write on next authorization');
