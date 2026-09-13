const fs = require('fs');
const crypto = require('crypto');

const README = 'README.md';
const CHANGELOG = 'CHANGELOG.md';
const EXPECTED = {
  [README]: '090d147fb719403bad25f435c75d578a8f6d1f45',
  [CHANGELOG]: '554b80ee3989dded1bc7c39c4fb7f7a47457f2f6'
};

function gitBlobSha(text) {
  const body = Buffer.from(text, 'utf8');
  return crypto.createHash('sha1').update(Buffer.from(`blob ${body.length}\0`)).update(body).digest('hex');
}
function replaceOnce(text, oldText, newText, label) {
  const first = text.indexOf(oldText);
  if (first < 0 || text.indexOf(oldText, first + oldText.length) >= 0) throw new Error(`Expected exactly one ${label}`);
  return text.slice(0, first) + newText + text.slice(first + oldText.length);
}

let readme = fs.readFileSync(README, 'utf8');
let changelog = fs.readFileSync(CHANGELOG, 'utf8');
for (const [file, expected] of Object.entries(EXPECTED)) {
  const text = file === README ? readme : changelog;
  const actual = gitBlobSha(text);
  if (actual !== expected) throw new Error(`${file} guard failed: expected ${expected}, got ${actual}`);
}

readme = replaceOnce(
  readme,
  '- Reconciliation proved the official 594-track set/order matches the de-duplicated live HEOS My Music-Tracks representation after removing 41 stale/duplicate rows. Official IDs can therefore be used directly as HEOS MIDs for this validated collection.\n',
  '- Reconciliation proved the official 594-track set/order matches the de-duplicated live HEOS My Music-Tracks representation. The official relationship list contained 635 references, of which 41 were stale; independently, the HEOS browse returned 635 rows containing 41 duplicate rows. After omitting the stale official relationships and de-duplicating HEOS by first occurrence, both sides matched exactly at 594 tracks in the same order. Official IDs can therefore be used directly as HEOS MIDs for this validated collection.\n',
  'README reconciliation sentence'
);

changelog = replaceOnce(
  changelog,
  '- Reconciliation established that the 594 live official IDs match the de-duplicated HEOS My Music-Tracks IDs and order after stale/duplicate removal, allowing the validated official IDs to be used directly as HEOS MIDs for this collection.\n',
  '- Reconciliation established that the 594 live official IDs match the de-duplicated HEOS My Music-Tracks IDs and order. The official relationship list contained 635 references with 41 stale relationships; separately, the HEOS browse returned 635 rows with 41 duplicate rows. Omitting the stale official relationships and de-duplicating HEOS by first occurrence produced the same 594 tracks in the same order, allowing the validated official IDs to be used directly as HEOS MIDs for this collection.\n',
  'CHANGELOG reconciliation sentence'
);

fs.writeFileSync(README, readme);
fs.writeFileSync(CHANGELOG, changelog);
console.log(`README.md: ${gitBlobSha(readme)}`);
console.log(`CHANGELOG.md: ${gitBlobSha(changelog)}`);
console.log('Favourite Tracks documentation wording corrected.');
