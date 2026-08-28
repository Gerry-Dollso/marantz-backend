'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

const oldBlock = `    async function runQuery(query) {
      const encodedQuery = encodeURIComponent(query);
      return {
        results: await inspectSearch(
          'results',
          '/searchResults/' + encodedQuery + '?countryCode=' + encodedCountry + '&include=artists,albums,tracks,topHits'
        ),
        suggestions: await inspectSearch(
          'suggestions',
          '/searchSuggestions/' + encodedQuery + '?countryCode=' + encodedCountry + '&include=directHits'
        )
      };
    }`;

const newBlock = `    async function runQuery(query) {
      const encodedQuery = encodeURIComponent(query);
      const base = '/searchResults/' + encodedQuery + '/relationships/';
      return {
        artists: await inspectSearch(
          'artists',
          base + 'artists?countryCode=' + encodedCountry + '&include=artists.profileArt'
        ),
        albums: await inspectSearch(
          'albums',
          base + 'albums?countryCode=' + encodedCountry + '&include=albums.coverArt,albums.artists'
        ),
        tracks: await inspectSearch(
          'tracks',
          base + 'tracks?countryCode=' + encodedCountry + '&include=tracks.artists,tracks.albums,tracks.albums.coverArt'
        ),
        topHits: await inspectSearch(
          'topHits',
          base + 'topHits?countryCode=' + encodedCountry + '&include=topHits'
        ),
        suggestions: await inspectSearch(
          'suggestions',
          '/searchSuggestions/' + encodedQuery + '/relationships/directHits?countryCode=' + encodedCountry + '&include=directHits'
        )
      };
    }`;

if (!source.includes(oldBlock)) {
  throw new Error('Guard failed: expected current search probe block not found');
}
if (source.includes("/relationships/artists?countryCode=' + encodedCountry")) {
  throw new Error('Guard failed: relationship-endpoint search probe already present');
}

source = source.replace(oldBlock, newBlock);
fs.writeFileSync(target, source);
console.log('Extended: switched TIDAL search reconnaissance to documented relationship endpoints');
