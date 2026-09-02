from pathlib import Path

path = Path('server.js')
text = path.read_text()

old_resolution_error = """        } catch (error) {
          if (!tidalQueueBuildIsCurrent(queueGeneration)) break;
          skippedCount += 1;
          console.warn(
            'TIDAL RESOLVED PLAYLIST RESOLUTION SKIP:',
"""
new_resolution_error = """        } catch (error) {
          if (!tidalQueueBuildIsCurrent(queueGeneration)) break;
          if (startTrackId && index === 0) {
            return sendJson(res, 409, {
              ok: false,
              error: 'Selected Play From Here track could not be resolved safely'
            });
          }
          skippedCount += 1;
          console.warn(
            'TIDAL RESOLVED PLAYLIST RESOLUTION SKIP:',
"""

old_unresolved = """        if (
          resolution.status !== 'resolved' ||
          !resolution.cid ||
          !resolution.mid
        ) {
          skippedCount += 1;
          logUnresolvedSkip(index, target, resolution);
          continue;
        }
"""
new_unresolved = """        if (
          resolution.status !== 'resolved' ||
          !resolution.cid ||
          !resolution.mid
        ) {
          if (startTrackId && index === 0) {
            return sendJson(res, 409, {
              ok: false,
              error: 'Selected Play From Here track could not be resolved safely'
            });
          }
          skippedCount += 1;
          logUnresolvedSkip(index, target, resolution);
          continue;
        }
"""

old_queue_error = """        } catch (error) {
          if (!tidalQueueBuildIsCurrent(queueGeneration)) break;
          skippedCount += 1;
          logQueueSkip(index, target, resolution, error);
          continue;
        }
"""
new_queue_error = """        } catch (error) {
          if (!tidalQueueBuildIsCurrent(queueGeneration)) break;
          if (startTrackId && index === 0) {
            return sendJson(res, 502, {
              ok: false,
              error: 'Selected Play From Here track could not be queued'
            });
          }
          skippedCount += 1;
          logQueueSkip(index, target, resolution, error);
          continue;
        }
"""

for old, new, label in [
    (old_resolution_error, new_resolution_error, 'resolution error anchor'),
    (old_unresolved, new_unresolved, 'unresolved result anchor'),
    (old_queue_error, new_queue_error, 'queue error anchor'),
]:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label} count was {count}, expected 1')
    text = text.replace(old, new, 1)

path.write_text(text)
print('Inserted strict selected-first Play From Here handling into server.js')
