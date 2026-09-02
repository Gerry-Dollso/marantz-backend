from pathlib import Path

path = Path('server.js')
text = path.read_text()

old_params = """      const id = String(url.searchParams.get('id') || '').trim();
      const shuffleValue = String(url.searchParams.get('shuffle') || '0').trim();
"""
new_params = """      const id = String(url.searchParams.get('id') || '').trim();
      const startTrackId = String(url.searchParams.get('start') || '').trim();
      const shuffleValue = String(url.searchParams.get('shuffle') || '0').trim();
"""

old_queue = """      const queueTracks = sourceTracks.slice();
      if (shuffle) {
"""
new_queue = """      let queueTracks = sourceTracks.slice();
      if (startTrackId) {
        if (!/^\\d+$/.test(startTrackId)) {
          return sendJson(res, 400, { ok: false, error: 'Invalid start track id' });
        }
        if (shuffle) {
          return sendJson(res, 400, {
            ok: false,
            error: 'Play From Here cannot be combined with shuffle'
          });
        }
        const startIndex = queueTracks.findIndex(
          track => String(track.id || '') === startTrackId
        );
        if (startIndex < 0) {
          return sendJson(res, 409, {
            ok: false,
            error: 'Selected track is not in this personalised playlist'
          });
        }
        queueTracks = queueTracks.slice(startIndex);
      }
      if (shuffle) {
"""

for old, new, label in [
    (old_params, new_params, 'parameter anchor'),
    (old_queue, new_queue, 'queue anchor'),
]:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label} count was {count}, expected 1')
    text = text.replace(old, new, 1)

path.write_text(text)
print('Inserted guarded personalised Play From Here support into server.js')
