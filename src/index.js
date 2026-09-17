import makeWASocket, { Browsers, DisconnectReason, generateMessageIDV2, proto } from '@whiskeysockets/baileys';
import pino from 'pino';
import qr from 'qrcode-terminal';
import { mkdir, readFile, unlink, access } from 'node:fs/promises';
import path from 'node:path';
import { paths, loadConfig, loadState, saveState, readJSON, atomicWrite, dueDay, listGifs, chooseGif, dispatch } from './core.js';
import { localAuth, hasPairedSession } from './auth.js';
import { prepareMedia } from './media.js';
import { instanceLock, log } from './runtime.js';
import { loadCaptions, chooseCaption } from './captions.js';

process.umask(0o077);
const args = process.argv.slice(2);
if (args.some(x => !['--pair', '--qr'].includes(x)) || args.length > 1) throw Error('Use npm start, npm run pair ou npm run qr.');
const pairing = args.length > 0;
const config = await loadConfig();
const lock = await instanceLock();
await mkdir(paths.data, { recursive: true, mode: 0o700 });
const pausedFile = path.join(paths.data, 'PAUSED');
const messagesFile = path.join(paths.data, 'messages.json');
let socket, reconnectTimer, timer, stopping = false, online = false, backoff = 0;
let job = null, nextTry = 0;
let auth;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true; online = false;
  clearTimeout(reconnectTimer); clearInterval(timer);
  const deadline = setTimeout(() => process.exit(code), 10_000);
  try {
    if (job) await job;
    if (auth) await auth.flush();
    socket?.end(new Error('Encerramento local'));
    lock.close();
  } finally { clearTimeout(deadline); process.exit(code); }
}
async function fatal(error) {
  if (stopping) return;
  const message = String(error?.message ?? error);
  try {
    await atomicWrite(pausedFile, new Date().toISOString() + ' ' + message + '\n');
    log('pausado', { reason: message });
  } catch { console.error('Falha ao salvar pausa:', message); }
  // Nao espera o proprio job (poderia estar chamando fatal).
  stopping = true;
  socket?.end(new Error('Pausa por erro'));
  process.exit(2);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
process.on('uncaughtException', e => void fatal(e));
process.on('unhandledRejection', e => void fatal(e));

try {
  if (!pairing) {
    try { await access(pausedFile); throw Error('Bot pausado. Leia data/PAUSED e o README antes de retomar.'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  auth = await localAuth(paths.auth);
  if (!pairing && !hasPairedSession(auth.state.creds)) throw Error('Vincule primeiro com npm run pair ou npm run qr.');
  const state = await loadState();
  const captions = await loadCaptions(config);
  const messages = await readJSON(messagesFile, {});
  if (!messages || typeof messages !== 'object' || Array.isArray(messages)) throw Error('Cache de mensagens invalido.');
  for (const item of state.history.filter(x => x.status === 'attempting')) item.status = 'uncertain';
  await saveState(state);

  async function tick() {
    if (pairing || !online || stopping || job || Date.now() < nextTry) return;
    const day = dueDay(new Date(), config, state);
    if (!day) return;
    job = (async () => {
      const current = socket;
      let selection, content, jid;
      try {
        selection = chooseGif(await listGifs(), state);
        selection.caption = chooseCaption(captions, state, config);
        content = await prepareMedia(selection.gif, { ...config, caption: selection.caption.text });
        const found = await current.onWhatsApp(config.recipientNumber);
        const target = found?.find(x => x.exists);
        if (!target?.jid || !target.jid.endsWith('@s.whatsapp.net'))
          throw Error('Numero destinatario nao encontrado como contato individual no WhatsApp.');
        jid = target.jid;
      } catch (e) {
        nextTry = Date.now() + 5 * 60_000;
        log('falha_preparacao', { error: e.message, retryInMinutes: 5 });
        return;
      }
      // Uma conversao lenta ou reconexao nao pode atravessar a janela de envio.
      if (!online || current !== socket || stopping || dueDay(new Date(), config, state) !== day) return;
      const id = generateMessageIDV2(current.user?.id);
      const record = await dispatch({ state, selection, day, recipient: config.recipientNumber, id,
        persist: saveState,
        send: async () => {
          const sent = await current.sendMessage(jid, content, { messageId: id });
          if (sent?.message) {
            messages[id] = { at: Date.now(), body: Buffer.from(proto.Message.encode(sent.message).finish()).toString('base64') };
            for (const [key, value] of Object.entries(messages))
              if (value.at < Date.now() - 30 * 86400_000) delete messages[key];
            await atomicWrite(messagesFile, JSON.stringify(messages));
          }
          return sent;
        }
      });
      log(record.status, { day, file: record.file, id, error: record.error });
    })();
    try { await job; } catch (e) { await fatal(e); } finally { job = null; }
  }

  function reconnect() {
    if (stopping || reconnectTimer) return;
    const delay = Math.min(300_000, 2000 * 2 ** Math.min(backoff++, 8)) + Math.floor(Math.random() * 1000);
    log('reconectando', { seconds: Math.ceil(delay / 1000) });
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect().catch(fatal); }, delay);
  }
  async function connect() {
    if (stopping) return;
    await auth.flush();
    let codeRequested = false;
    // Usa a versao de protocolo padrao da release fixada; nao busca versao Web arbitraria.
    const current = makeWASocket({
      auth: auth.state, logger: pino({ level: 'silent' }),
      browser: Browsers.ubuntu('Chrome'), markOnlineOnConnect: false,
      syncFullHistory: false, shouldSyncHistoryMessage: () => false,
      connectTimeoutMs: 60_000, defaultQueryTimeoutMs: 60_000,
      getMessage: async key => messages[key.id]?.body
        ? proto.Message.decode(Buffer.from(messages[key.id].body, 'base64')) : undefined
    });
    socket = current;
    current.ev.on('creds.update', () => { auth.saveCreds().catch(fatal); });
    current.ev.on('connection.update', update => {
      (async () => {
        if (stopping || current !== socket) return;
        if (update.qr && !hasPairedSession(auth.state.creds)) {
          if (!pairing) return fatal(Error('Sessao exige novo vinculo.'));
          if (args[0] === '--qr') qr.generate(update.qr, { small: true });
          else if (!codeRequested) {
            codeRequested = true;
            const code = await current.requestPairingCode(config.ownerNumber);
            console.log('\nCodigo de vinculacao (nao compartilhe): ' + code + '\n');
          }
        }
        if (update.connection === 'open') {
          online = true; backoff = 0;
          log('conectado', { enabled: config.enabled, time: config.time, timeZone: config.timeZone });
          if (pairing) {
            await auth.saveCreds();
            await unlink(pausedFile).catch(e => { if (e.code !== 'ENOENT') throw e; });
            console.log('Sessao salva. Vinculacao concluida; nenhum GIF foi enviado.');
            await stop();
          } else void tick();
        }
        if (update.connection === 'close') {
          online = false;
          const code = update.lastDisconnect?.error?.output?.statusCode;
          const terminal = [DisconnectReason.loggedOut, DisconnectReason.badSession,
            DisconnectReason.connectionReplaced, DisconnectReason.multideviceMismatch, DisconnectReason.forbidden];
          if (terminal.includes(code)) await fatal(Error('Conexao encerrada com codigo ' + code + '. Confira a sessao; veja README.'));
          else reconnect();
        }
      })().catch(fatal);
    });
  }
  timer = setInterval(() => {
    if (new Date().getMinutes() === 0 && new Date().getSeconds() < 20)
      log('ativo', { online, enabled: config.enabled });
    void tick();
  }, 15_000);
  log('iniciado', { mode: pairing ? args[0] : 'agendado' });
  await connect();
} catch (e) { console.error(e.message); await stop(1); }
