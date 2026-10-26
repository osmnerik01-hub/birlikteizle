import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

// One application process owns this database and its in-memory SSE connections.
export function openStorage(directory) {
  const db = new DatabaseSync(path.join(directory, 'birlikte.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
  const upsert = db.prepare('INSERT INTO rooms (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');
  const erase = db.prepare('DELETE FROM rooms WHERE id=?');
  return {
    load() {
      return new Map(db.prepare('SELECT id, payload FROM rooms').all().map(row => {
        const room = JSON.parse(row.payload);
        room.members = new Map(room.members.map(([hash, member]) => [hash, { ...member, streams: new Set() }]));
        // A restart pauses the video at its last saved position.
        room.playback.playing = false;
        room.playback.updatedAt = Date.now();
        return [row.id, room];
      }));
    },
    save(room) {
      const members = [...room.members].map(([hash, { streams, ...member }]) => [hash, member]);
      upsert.run(room.id, JSON.stringify({ ...room, members }));
    },
    health() { db.prepare('SELECT 1').get(); },
    delete(id) { erase.run(id); },
    close() { db.close(); }
  };
}
