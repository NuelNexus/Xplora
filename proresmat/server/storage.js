// File-based persistence for the reference server. Production swaps these for MySQL and private object storage.
import { mkdir, readFile, writeFile, rename, unlink, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export function fileStore(dir) {
  const file = join(dir, 'db.json');
  let writing = Promise.resolve();
  return {
    async load() {
      try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    save(db) {
      const json = JSON.stringify(db);
      // Serialise writes and replace atomically so a crash never leaves a half-written file.
      writing = writing.then(async () => {
        await mkdir(dir, { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await writeFile(tmp, json, { mode: 0o600 });
        await rename(tmp, file);
      });
      return writing;
    },
  };
}

// Encrypted document blobs live outside the web root.
export function fileBlobs(dir) {
  const base = join(dir, 'private-blobs');
  const path = (k) => join(base, k.replace(/[^a-f0-9]/g, '') + '.bin');
  return {
    async put(k, bytes) { await mkdir(base, { recursive: true, mode: 0o700 }); await writeFile(path(k), bytes, { mode: 0o600 }); },
    async get(k) { try { return new Uint8Array(await readFile(path(k))); } catch { return null; } },
    async del(k) { try { await unlink(path(k)); } catch { /* already gone */ } },
  };
}

export async function loadOrCreateKey(dir) {
  if (process.env.PRORESMAT_DOC_KEY) {
    if (!/^[0-9a-f]{64}$/i.test(process.env.PRORESMAT_DOC_KEY)) throw new Error('PRORESMAT_DOC_KEY must be 64 hex characters (32 bytes).');
    return process.env.PRORESMAT_DOC_KEY.toLowerCase();
  }
  const file = join(dir, 'document.key');
  try { return (await readFile(file, 'utf8')).trim(); } catch { /* create */ }
  await mkdir(dir, { recursive: true });
  const key = randomBytes(32).toString('hex');
  await writeFile(file, key, { mode: 0o600 });
  await chmod(file, 0o600).catch(() => {});
  return key;
}
