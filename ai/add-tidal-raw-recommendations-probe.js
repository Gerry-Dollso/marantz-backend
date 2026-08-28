'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'tidal-user-auth-recon.js');
let source = fs.readFileSync(target, 'utf8');

const apiGetAnchor = `  async function apiGet(path) {\n    await ensureSession();\n\n    const response = await fetch(\`${'${API_BASE}${path}'}\`, {\n      headers: {\n        Authorization: \`Bearer ${'${session.accessToken}'}\`,\n        Accept: 'application/vnd.api+json'\n      }\n    });\n    const payload = await response.json().catch(() => ({}));\n\n    if (!response.ok) {\n      const detail =\n        payload?.errors?.[0]?.detail ||\n        payload?.detail ||\n        \`HTTP ${'${response.status}'}\`;\n      throw new Error(\`${'${response.status}: ${detail}'}\`);\n    }\n\n    return {\n      httpStatus: response.status,\n      ...summarisePayload(payload)\n    };\n  }\n`;

const apiGetReplacement = `${apiGetAnchor}\n  async function apiGetRaw(path) {\n    await ensureSession();\n\n    const response = await fetch(\`${'${API_BASE}${path}'}\`, {\n      headers: {\n        Authorization: \`Bearer ${'${session.accessToken}'}\`,\n        Accept: 'application/vnd.api+json'\n      }\n    });\n    const payload = await response.json().catch(() => ({}));\n\n    if (!response.ok) {\n      const detail =\n        payload?.errors?.[0]?.detail ||\n        payload?.detail ||\n        \`HTTP ${'${response.status}'}\`;\n      throw new Error(\`${'${response.status}: ${detail}'}\`);\n    }\n\n    return payload;\n  }\n\n  async function probeRawRecommendations() {\n    const resources = {\n      dailyMixes: '/userDailyMixes/me?include=items&countryCode=' + encodeURIComponent(countryCode),\n      dailyDiscovery: '/userDiscoveryMixes/me?include=items&countryCode=' + encodeURIComponent(countryCode),\n      newArrivals: '/userNewReleaseMixes/me?include=items&countryCode=' + encodeURIComponent(countryCode)\n    };\n\n    const results = {};\n    for (const [name, resourcePath] of Object.entries(resources)) {\n      results[name] = await apiGetRaw(resourcePath);\n    }\n    return results;\n  }\n`;

if (!source.includes(apiGetAnchor)) {
  throw new Error('Guard failed: apiGet anchor not found exactly; no changes written.');
}
source = source.replace(apiGetAnchor, apiGetReplacement);

const routeAnchor = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-playlists') {\n      try {\n        const personalisedPlaylists = await probePersonalisedPlaylists();\n        return sendJson(res, 200, {\n          ok: true,\n          personalisedPlaylists\n        });\n      } catch (error) {\n        return sendJson(res, 401, {\n          ok: false,\n          error: error.message\n        });\n      }\n    }\n`;

const routeReplacement = `    if (req.method === 'GET' && requestUrl.pathname === '/api/tidal/oauth/probe-recommendations-raw') {\n      try {\n        const recommendations = await probeRawRecommendations();\n        return sendJson(res, 200, { ok: true, recommendations });\n      } catch (error) {\n        return sendJson(res, 401, { ok: false, error: error.message });\n      }\n    }\n\n${routeAnchor}`;

if (!source.includes(routeAnchor)) {
  throw new Error('Guard failed: probe-playlists route anchor not found exactly; no changes written.');
}
source = source.replace(routeAnchor, routeReplacement);

fs.writeFileSync(target, source);
console.log('Added raw authenticated TIDAL recommendation probe without changing existing summarised probe behavior.');
console.log('This migration does not contact HEOS or alter playback.');
