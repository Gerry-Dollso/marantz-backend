'use strict';

function createTidalBrowseCache(options = {}) {
  const maxEntries = Math.max(1, Number(options.maxEntries) || 64);
  const entries = new Map();
  const inFlight = new Map();

  function touch(key, entry) {
    entries.delete(key);
    entries.set(key, entry);
  }

  function trim() {
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      entries.delete(oldestKey);
    }
  }

  function store(key, value) {
    const entry = {
      value,
      storedAt: Date.now()
    };
    touch(key, entry);
    trim();
    return entry;
  }

  function startRefresh(key, loader) {
    if (inFlight.has(key)) return inFlight.get(key);

    const refresh = Promise.resolve()
      .then(loader)
      .then(value => {
        store(key, value);
        return value;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, refresh);
    return refresh;
  }

  async function get(key, loader, policy = {}) {
    const refreshAfterMs = Math.max(
      0,
      Number(policy.refreshAfterMs) || 0
    );
    const maxStaleMs = Math.max(
      refreshAfterMs,
      Number(policy.maxStaleMs) || 0
    );

    const cached = entries.get(key);

    if (!cached) {
      const value = await startRefresh(key, loader);
      return {
        value,
        cached: false,
        cacheAgeMs: 0,
        refreshing: false
      };
    }

    touch(key, cached);
    const age = Math.max(0, Date.now() - cached.storedAt);

    if (maxStaleMs > 0 && age > maxStaleMs) {
      try {
        const value = await startRefresh(key, loader);
        return {
          value,
          cached: false,
          cacheAgeMs: 0,
          refreshing: false
        };
      } catch (error) {
        // Prefer the last known browse result if HEOS is temporarily unavailable.
        return {
          value: cached.value,
          cached: true,
          cacheAgeMs: age,
          refreshing: false,
          refreshError: error.message
        };
      }
    }

    let refreshing = false;
    if (age >= refreshAfterMs) {
      refreshing = true;
      startRefresh(key, loader).catch(error => {
        console.warn(
          'TIDAL browse cache refresh failed:',
          key,
          error.message
        );
      });
    }

    return {
      value: cached.value,
      cached: true,
      cacheAgeMs: age,
      refreshing
    };
  }

  function stats() {
    return {
      entries: entries.size,
      inFlight: inFlight.size,
      maxEntries
    };
  }

  return {
    get,
    stats
  };
}

module.exports = {
  createTidalBrowseCache
};
