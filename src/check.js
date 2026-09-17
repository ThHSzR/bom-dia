import { loadConfig, loadState, listGifs, chooseGif, clockParts } from './core.js';
import { prepareMedia } from './media.js';
import { instanceLock } from './runtime.js';
process.umask(0o077);
const lock = await instanceLock();
try {
  const config = await loadConfig();
  const state = await loadState();
  const files = await listGifs();
  const selected = chooseGif(files, state);
  await prepareMedia(selected.gif, config);
  console.log(JSON.stringify({ ok: true, enabled: config.enabled, time: config.time,
    timeZone: config.timeZone, localNow: clockParts(new Date(), config.timeZone),
    recipientEnding: config.recipientNumber.slice(-4), uniqueGifs: files.length,
    conversionTest: selected.gif.name, historyDays: state.history.length }, null, 2));
  console.log('Nenhuma conexao com WhatsApp, envio ou alteracao do historico. Conversao local OK.');
} finally { lock.close(); }
