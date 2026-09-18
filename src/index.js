import makeWASocket, { Browsers, DisconnectReason, generateMessageIDV2, proto } from '@whiskeysockets/baileys';
import pino from 'pino';
import qr from 'qrcode-terminal';
import { mkdir, readFile, unlink, access } from 'node:fs/promises';
import path from 'node:path';
import { paths, loadConfig, loadState, saveState, readJSON, atomicWrite, dueDay, listGifs, chooseGif, dispatch } from './core.js';
import { localAuth, hasPairedSession } from './auth.js';
import { prepareMedia } from './media.js';
import { instanceLock, log, configureLogging } from './runtime.js';
import { inspectSchedule } from './observability.js';
import { loadCaptions, chooseCaption } from './captions.js';
import { observeConfirmation, confirmationMessage } from './confirmation.js';

process.umask(0o077);
const args = process.argv.slice(2);
if (args.some(x => !['--pair', '--qr', '--send-test'].includes(x)) || args.length > 1) throw Error('Use npm start, npm run pair, npm run qr ou npm run teste.');
const pairing = args.includes('--pair') || args.includes('--qr');
const manualTest = args.includes('--send-test');
const config = await loadConfig();
configureLogging(config.timeZone);
const lock = await instanceLock();
await mkdir(paths.data, { recursive: true, mode: 0o700 });
const pausedFile = path.join(paths.data, 'PAUSED');
const messagesFile = path.join(paths.data, 'messages.json');
let socket, reconnectTimer, timer, stopping = false, online = false, backoff = 0;
let job = null, nextTry = 0;
let testStarted = false, testTimeout;
let auth;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true; online = false;
  clearTimeout(reconnectTimer); clearInterval(timer);
  clearTimeout(testTimeout);
  const deadline = setTimeout(() => process.exit(code), 10_000);
  try {
    log('encerrando', { exitCode: code });
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
process.on('SIGINT', () => { log('sinal_recebido', { signal: 'SIGINT' }); void stop(); });
process.on('SIGTERM', () => { log('sinal_recebido', { signal: 'SIGTERM' }); void stop(); });
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
  for (const item of [...state.history, ...(state.testHistory ?? [])].filter(x => x.status === 'attempting')) item.status = 'uncertain';
  await saveState(state);
  log('estado_carregado', { scheduledRecords: state.history.length, testRecords: state.testHistory?.length ?? 0,
    gifCycle: state.cycle, captionMode: config.captionMode ?? 'random', availableCaptions: captions.length });

  async function tick() {
    const decision = inspectSchedule(new Date(), config, state, { pairing, online, stopping,
      busy: Boolean(job), retryAt: nextTry, manualTest, testStarted });
    log('verificacao_horario', decision);
    if (!decision.ready) return;
    const day = decision.day;
    if (manualTest) testStarted = true;
    job = (async () => {
      const current = socket;
      let selection, content, jid;
      try {
        log('buscando_gifs');
        const files = await listGifs();
        log('gifs_encontrados', { count: files.length });
        selection = chooseGif(files, state);
        selection.caption = chooseCaption(captions, state, config);
        log('sorteio', { file: selection.gif.name, caption: selection.caption.text,
          newGifCycle: selection.reset, newCaptionCycle: Boolean(selection.caption.reset) });
        log('conversao_iniciada', { file: selection.gif.name });
        content = await prepareMedia(selection.gif, { ...config, caption: selection.caption.text });
        log('conversao_concluida', { file: selection.gif.name });
        log('consultando_destinatario', { numberEnding: config.recipientNumber.slice(-4) });
        const found = await current.onWhatsApp(config.recipientNumber);
        const target = found?.find(x => x.exists);
        if (!target?.jid || !target.jid.endsWith('@s.whatsapp.net'))
          throw Error('Numero destinatario nao encontrado como contato individual no WhatsApp.');
        jid = target.jid;
        log('destinatario_validado', { numberEnding: config.recipientNumber.slice(-4) });
      } catch (e) {
        nextTry = Date.now() + 5 * 60_000;
        log('falha_preparacao', { error: e.message, retryInMinutes: manualTest ? null : 5 });
        return;
      }
      // Uma conversao lenta ou reconexao nao pode atravessar a janela de envio.
      if (!online || current !== socket || stopping || (!manualTest && dueDay(new Date(), config, state) !== day)) {
        log('envio_adiado', { reason: 'conexao_ou_janela_alterada_durante_preparacao', online });
        return;
      }
      if (manualTest) console.log('Enviando teste real: ' + selection.gif.name + '\n' + selection.caption.text);
      const id = generateMessageIDV2(current.user?.id);
      const record = await dispatch({ state, selection, day, recipient: config.recipientNumber, id, manualTest,
        persist: saveState,
        send: async () => {
          log('reserva_salva', { id, day, mode: manualTest ? 'test' : 'scheduled' });
          const observer = observeConfirmation(current, id, 90_000,
            receipt => log('recibo_whatsapp', { id, ...receipt }));
          try {
            log('envio_iniciado', { id, file: selection.gif.name });
            const sent = await current.sendMessage(jid, content, { messageId: id });
            log('baileys_retornou', { id, hasMessageId: Boolean(sent?.key?.id) });
            if (sent?.message) {
              messages[id] = { at: Date.now(), body: Buffer.from(proto.Message.encode(sent.message).finish()).toString('base64') };
              for (const [key, value] of Object.entries(messages))
                if (value.at < Date.now() - 30 * 86400_000) delete messages[key];
              await atomicWrite(messagesFile, JSON.stringify(messages));
            }
            if (!sent?.key?.id) return sent;
            log('aguardando_confirmacao', { id, timeoutSeconds: 90 });
            if (manualTest) console.log('Mensagem preparada. Aguardando confirmacao do WhatsApp por ate 90 segundos...');
            const confirmation = await observer.wait();
            return { ...sent, ...confirmation };
          } finally { observer.cancel(); }
        }
      });
      log(record.status, { day, file: record.file, id, mode: manualTest ? 'test' : 'scheduled',
        confirmation: record.confirmation, confirmationError: record.confirmationError, error: record.error });
      return record;
    })();
    let result;
    try { result = await job; } catch (e) { await fatal(e); } finally { job = null; }
    if (manualTest && !stopping) {
      console.log(confirmationMessage(result));
      console.log('A agenda diaria continua preservada. Reative o servico com sv up bom-dia.');
      await stop(result?.confirmation === 'delivered' ? 0 : 1);
    }
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
    log('conexao_iniciada');
    let codeRequested = false;
    // Usa a versao de protocolo padrao da release fixada; nao busca versao Web arbitraria.
    const current = makeWASocket({
      auth: auth.state, logger: pino({ level: 'warn' }, {
        write(line) {
          const entry = JSON.parse(line);
          // Apenas avisos operacionais; nao grava objetos de sessao, chaves ou mensagens recebidas.
          log('aviso_baileys', { level: entry.level, message: entry.msg, error: entry.err?.message });
        }
      }),
      browser: Browsers.ubuntu('Chrome'), markOnlineOnConnect: false,
      syncFullHistory: false, shouldSyncHistoryMessage: () => false,
      connectTimeoutMs: 60_000, defaultQueryTimeoutMs: 60_000,
      getMessage: async key => messages[key.id]?.body
        ? proto.Message.decode(Buffer.from(messages[key.id].body, 'base64')) : undefined
    });
    socket = current;
    current.ev.on('creds.update', () => { auth.saveCreds().then(() => log('sessao_salva')).catch(fatal); });
    current.ev.on('connection.update', update => {
      (async () => {
        if (stopping || current !== socket) return;
        if (update.connection) log('estado_conexao', { connection: update.connection });
        if (update.receivedPendingNotifications) log('sincronizacao_inicial_concluida');
        if (update.qr && !hasPairedSession(auth.state.creds)) {
          log('vinculacao_necessaria', { method: args[0] === '--qr' ? 'qr' : 'codigo' });
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
          const error = update.lastDisconnect?.error;
          const code = error?.output?.statusCode;
          const reason = String(error?.message ?? error ?? 'erro desconhecido');
          log('desconectado', { code, reason });

          // O proprio Baileys recomenda reconectar em todos os fechamentos,
          // exceto quando a conta foi efetivamente deslogada (401).
          // O codigo 500 tambem pode aparecer em erros de stream/failure e
          // nao prova, sozinho, que a sessao esteja corrompida.
          if (code === DisconnectReason.loggedOut)
            await fatal(Error('WhatsApp informou logout da sessao (codigo 401). Vincule novamente; veja README.'));
          else reconnect();
        }
      })().catch(fatal);
    });
  }
  timer = setInterval(() => { void tick().catch(fatal); }, 15_000);
  log('iniciado', { mode: pairing ? args[0] : manualTest ? 'test' : 'agendado' });
  if (manualTest) {
    console.log('TESTE REAL: envia uma mensagem ao contato configurado, mesmo fora do horario, com enabled=false ou apos o envio diario.');
    testTimeout = setTimeout(() => {
      log('tempo_teste_esgotado');
      console.error('Tempo de teste esgotado. Confira o historico e a conversa antes de repetir.');
      void stop(1);
    }, 5 * 60_000);
  }
  await connect();
} catch (e) { log('falha_inicializacao', { error: e.message }); console.error(e.message); await stop(1); }
