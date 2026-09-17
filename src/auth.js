import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import { atomicWrite } from './core.js';

// Adaptador local para um bot pequeno. Escritas serializadas e atomicas;
// JSON corrompido causa erro, nunca um novo login silencioso.
export async function localAuth(dir) {
  const file = path.join(dir, 'session.json');
  let saved;
  try { saved = JSON.parse(await readFile(file, 'utf8'), BufferJSON.reviver); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (saved && (!saved.creds || !saved.keys)) throw Error('Sessao invalida. Restaure o backup ou vincule novamente.');
  const creds = saved?.creds ?? initAuthCreds();
  const keyData = saved?.keys ?? {};
  let queue = Promise.resolve();
  function saveCreds() {
    const snapshot = JSON.stringify({ creds, keys: keyData }, BufferJSON.replacer);
    queue = queue.then(() => atomicWrite(file, snapshot));
    return queue;
  }
  return {
    state: { creds, keys: {
      async get(type, ids) {
        await queue;
        const result = {};
        for (const id of ids) {
          let value = keyData[type]?.[id];
          if (value && type === 'app-state-sync-key') value = proto.Message.AppStateSyncKeyData.fromObject(value);
          result[id] = value;
        }
        return result;
      },
      async set(update) {
        for (const [type, values] of Object.entries(update)) {
          keyData[type] ??= Object.create(null);
          for (const [id, value] of Object.entries(values)) {
            if (value == null) delete keyData[type][id];
            else Object.defineProperty(keyData[type], id, { value, enumerable: true, writable: true, configurable: true });
          }
        }
        await saveCreds();
      }
    } }, saveCreds, flush: () => queue
  };
}
