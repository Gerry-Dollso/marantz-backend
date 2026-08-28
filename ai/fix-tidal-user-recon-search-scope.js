'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

const oldScopes = "const DEFAULT_SCOPES = ['recommendations.read', 'user.read', 'collection.read'];";
const newScopes = "const DEFAULT_SCOPES = ['recommendations.read', 'user.read', 'collection.read', 'search.read'];";
const oldReturn = `    const query = 'Interpol';
    const encodedQuery = encodeURIComponent(query);
    const encodedCountry = encodeURIComponent(countryCode);
    return {
      query,
      results: await inspectSearch(
        'results',
        '/searchResults/' + encodedQuery + '?countryCode=' + encodedCountry + '&include=artists,albums,tracks'
      ),
      suggestions: await inspectSearch(
        'suggestions',
        '/searchSuggestions/' + encodedQuery + '?countryCode=' + encodedCountry + '&include=directHits'
      )
    };`;
const newReturn = `    const encodedCountry = encodeURIComponent(countryCode);
    async function runQuery(query) {
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
    }

    return {
      interpol: await runQuery('Interpol'),
      documentedControl: await runQuery('hello')
    };`;

if (!source.includes(oldScopes)) {
  throw new Error('Guard failed: expected pre-search scope list not found');
}
if (!source.includes(oldReturn)) {
  throw new Error('Guard failed: expected initial search probe body not found');
}

source = source.replace(oldScopes, newScopes);
source = source.replace(oldReturn, newReturn);
fs.writeFileSync(target, source);
console.log('Extended: added search.read and documented search control query');
