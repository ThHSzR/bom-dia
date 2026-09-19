import { loadConfig, loadState, listGifs, chooseGif, clockParts } from './core.js';
import { prepareAudio, prepareMedia } from './media.js';
import { instanceLock } from './runtime.js';
import { loadCaptions, chooseCaption } from './captions.js';
process.umask(0o077);
const lock = await instanceLock();
try {
  const config = await loadConfig();
  const state = await loadState();
  const files = await listGifs();
  const selected = chooseGif(files, state);
  const captions = await loadCaptions(config);
  const caption = chooseCaption(captions, state, config);
  await prepareMedia(selected.gif, { ...config, caption: caption.text });
  const sundayAudio = config.sundayAudio?.enabled ? await prepareAudio(config.sundayAudio.file) : null;
  console.log(JSON.stringify({ ok: true, enabled: config.enabled, time: config.time,
    timeZone: config.timeZone, localNow: clockParts(new Date(), config.timeZone),
    recipientEnding: config.recipientNumber.slice(-4), uniqueGifs: files.length,
    conversionTest: selected.gif.name, sundayAudio: sundayAudio ? {
      file: sundayAudio.name, mimetype: sundayAudio.mimetype, size: sundayAudio.size
    } : null, historyDays: state.history.length }, null, 2));
  console.log('Nenhuma conexao com WhatsApp, envio ou alteracao do historico. Conversao local OK.');
  console.log('Previa da legenda (sorteio de teste, nao reserva a proxima):\n' + caption.text);
} finally { lock.close(); }
