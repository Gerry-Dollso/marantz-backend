'use strict';

const fs = require('fs');

const path = 'tidal-artist-details.js';
const source = fs.readFileSync(path, 'utf8');
const oldBlock = `    const albumTitles = [...(details.albums || []), ...(details.singles || []), ...(details.appearsOn || [])]
      .map(item => item.name || item.title)
      .filter(Boolean);
    return biographyResolver.getBiography({ artistId: id, name, albumTitles }, options);`;
const newBlock = `    // Biography identity matching must not depend on the three-item landing previews.
    // Use the full HEOS Albums category as conservative MusicBrainz release evidence;
    // keep the fast 3/3/3 Artist landing unchanged.
    const fullAlbums = await heosArtistCategory(id, 'Albums');
    const albumTitles = (fullAlbums.rows || [])
      .map(item => item.name || item.title)
      .filter(Boolean);
    return biographyResolver.getBiography({ artistId: id, name, albumTitles }, options);`;

if (!source.includes(oldBlock)) throw new Error('Expected biography albumTitles block not found; refusing to edit');
if (source.includes('Biography identity matching must not depend on the three-item landing previews.')) throw new Error('Biography evidence fix already present; refusing duplicate edit');
const updated = source.replace(oldBlock, newBlock);
if (updated === source) throw new Error('No change made');
fs.writeFileSync(path, updated);
console.log('Updated tidal-artist-details.js biography evidence to use full HEOS Albums category');
