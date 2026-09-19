import { open, mkdir, readFile, rename, unlink, readdir, stat } from 'node:fs/promises';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const paths = {
  config: path.join(ROOT, 'config.json'), gifs: path.join(ROOT, 'gifs'),
  data: path.join(ROOT, 'data'), auth: path.join(ROOT, 'data/auth'),
  state: path.join(ROOT, 'data/state.json'), logs: path.join(ROOT, 'logs'),
  cache: path.join(ROOT, 'data/media')
};

export async function atomicWrite(file, text) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(text); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temp, file);
    // fsync do diretorio torna o rename duravel no Linux/Termux.
    if (process.platform !== 'win32') {
      const dir = await open(path.dirname(file), 'r');
      try { await dir.sync(); } finally { await dir.close(); }
    }
  } finally { await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}

export async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; }
}

export function validateConfig(c) {
  if (typeof c.enabled !== 'boolean') throw Error('enabled deve ser true ou false.');
  for (const key of ['ownerNumber', 'recipientNumber']) {
    if (typeof c[key] !== 'string' || !/^[1-9]\d{7,14}$/.test(c[key]))
      throw Error(key + ': informe DDI + DDD + numero, somente digitos, entre aspas.');
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.time)) throw Error('time deve ser HH:MM, de 00:00 a 23:59.');
  if (typeof c.timeZone !== 'string') throw Error('timeZone deve ser um fuso IANA.');
  new Intl.DateTimeFormat('en', { timeZone: c.timeZone }).format();
  if (!Number.isInteger(c.catchUpMinutes) || c.catchUpMinutes < 0 || c.catchUpMinutes > 720)
    throw Error('catchUpMinutes deve ser inteiro entre 0 e 720.');
  if (typeof c.caption !== 'string' || !c.caption.trim() || c.caption.length > 1000)
    throw Error('caption deve conter de 1 a 1000 caracteres.');
  if (c.captionMode !== undefined && !['random', 'fixed'].includes(c.captionMode))
    throw Error('captionMode deve ser random ou fixed.');
  if (!Number.isInteger(c.maxVideoSeconds) || c.maxVideoSeconds < 1 || c.maxVideoSeconds > 30)
    throw Error('maxVideoSeconds deve ser inteiro entre 1 e 30.');
  if (c.sundayAudio !== undefined) {
    if (!c.sundayAudio || typeof c.sundayAudio !== 'object' || Array.isArray(c.sundayAudio))
      throw Error('sundayAudio deve ser um objeto ou deve ser removido.');
    if (typeof c.sundayAudio.enabled !== 'boolean') throw Error('sundayAudio.enabled deve ser true ou false.');
    if (c.sundayAudio.file !== null && c.sundayAudio.file !== undefined &&
        (typeof c.sundayAudio.file !== 'string' || !c.sundayAudio.file.trim()))
      throw Error('sundayAudio.file deve ser um caminho local nao vazio, null, ou omitido.');
    if (c.sundayAudio.enabled && (typeof c.sundayAudio.file !== 'string' || !c.sundayAudio.file.trim()))
      throw Error('sundayAudio.file deve ser informado quando sundayAudio.enabled for true.');
  }
  return c;
}
export async function loadConfig() { return validateConfig(await readJSON(paths.config)); }
export function emptyState() { return { version: 1, cycle: 1, used: [], lastHash: null, history: [] }; }
export function validateState(s) {
  if (!s || s.version !== 1 || !Number.isInteger(s.cycle) || s.cycle < 1 ||
      !Array.isArray(s.used) || !s.used.every(x => typeof x === 'string') ||
      !Array.isArray(s.history) || !s.history.every(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.day) &&
        ['attempting', 'submitted', 'uncertain'].includes(x.status) && typeof x.id === 'string'))
    throw Error('Historico invalido. Restaure data/state.json do backup; nao apague para tentar de novo.');
  if (s.captionRotation !== undefined) {
    const r = s.captionRotation;
    if (!r || !Number.isInteger(r.cycle) || r.cycle < 1 || !Array.isArray(r.used) ||
        !r.used.every(x => typeof x === 'string') || !(r.lastHash === null || typeof r.lastHash === 'string'))
      throw Error('Historico de frases invalido. Restaure o backup sem apagar o historico de envios.');
  }
  if (s.testHistory !== undefined && (!Array.isArray(s.testHistory) || !s.testHistory.every(x =>
      x && /^\d{4}-\d{2}-\d{2}$/.test(x.day) && typeof x.id === 'string' &&
      ['attempting', 'submitted', 'uncertain'].includes(x.status))))
    throw Error('Historico de testes invalido. Restaure o backup.');
  return s;
}
export async function loadState() { return validateState(await readJSON(paths.state, emptyState())); }
export async function saveState(s) { await atomicWrite(paths.state, JSON.stringify(s, null, 2) + '\n'); }

export function clockParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}
export function isSunday(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date) === 'Sun';
}
export function shouldSendSundayAudio(date, config, { manualTest = false } = {}) {
  return !manualTest && Boolean(config.sundayAudio?.enabled) && isSunday(date, config.timeZone);
}
export function dueDay(date, config, state) {
  const { day, minute } = clockParts(date, config.timeZone);
  const [h, m] = config.time.split(':').map(Number);
  const elapsed = minute - (h * 60 + m);
  // Nao recupera dias anteriores, nem reenvia em horario de verao repetido.
  if (!config.enabled || elapsed < 0 || elapsed > config.catchUpMinutes ||
      state.history.some(x => x.day === day)) return null;
  return day;
}
export async function listGifs(dir = paths.gifs) {
  const files = [];
  const seen = new Set();
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !/\.gif$/i.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if ((await stat(file)).size > 25 * 1024 * 1024) throw Error('GIF excede 25 MB: ' + entry.name);
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    const hash = digest.digest('hex');
    if (!seen.has(hash)) { files.push({ name: entry.name, file, hash }); seen.add(hash); }
  }
  if (!files.length) throw Error('Coloque pelo menos um arquivo .gif na pasta gifs/.');
  return files;
}
export function chooseGif(files, state, pick = randomInt) {
  let pool = files.filter(x => !state.used.includes(x.hash));
  const reset = pool.length === 0;
  if (reset) pool = files;
  const different = pool.filter(x => x.hash !== state.lastHash);
  if (different.length) pool = different;
  return { gif: pool[pick(pool.length)], reset };
}
export function reserve(state, selection, day, recipient, id, manualTest = false) {
  if (!manualTest && state.history.some(x => x.day === day)) throw Error('Dia ja reservado.');
  const next = structuredClone(state);
  if (selection.reset) { next.used = []; next.cycle++; }
  next.used.push(selection.gif.hash);
  next.lastHash = selection.gif.hash;
  const caption = selection.caption;
  if (caption && !caption.fixed) {
    next.captionRotation ??= { cycle: 1, used: [], lastHash: null };
    if (caption.reset) { next.captionRotation.used = []; next.captionRotation.cycle++; }
    next.captionRotation.used.push(caption.hash);
    next.captionRotation.lastHash = caption.hash;
  }
  const history = manualTest ? (next.testHistory ??= []) : next.history;
  history.push({ day, id, recipient, mode: manualTest ? 'test' : 'scheduled', file: selection.gif.name, hash: selection.gif.hash,
    ...(caption ? { caption: caption.text, captionHash: caption.hash,
      captionCycle: caption.fixed ? null : next.captionRotation.cycle } : {}),
    ...(selection.sundayAudio ? { sundayAudio: selection.sundayAudio } : {}),
    cycle: next.cycle, status: 'attempting', attemptedAt: new Date().toISOString() });
  return next;
}

// A reserva e persistida ANTES de chamar qualquer envio. Falhas ambiguas consomem o dia.
export async function dispatch({ state, selection, day, recipient, id, persist, send, manualTest = false }) {
  const next = reserve(state, selection, day, recipient, id, manualTest);
  await persist(next);
  Object.assign(state, next);
  const record = (manualTest ? state.testHistory : state.history).at(-1);
  try {
    const message = await send();
    if (!message?.key?.id) throw Error('Baileys retornou sem identificador de mensagem.');
    if (message.confirmation) {
      record.confirmation = message.confirmation;
      record.confirmationError = message.confirmationError;
      record.confirmationCheckedAt = message.confirmationCheckedAt;
    }
    if (message.sundayAudio) record.sundayAudio = { ...(record.sundayAudio ?? {}), ...message.sundayAudio };
    if (message.confirmation === 'unconfirmed' || message.confirmation === 'rejected')
      throw Error(message.confirmationError ?? 'Sem confirmacao do WhatsApp dentro da janela de espera.');
    record.status = 'submitted';
    record.messageId = message.key.id;
    record.submittedAt = new Date().toISOString();
  } catch (e) {
    record.status = 'uncertain';
    record.error = String(e.message).slice(0, 500);
  }
  await persist(state);
  return record;
}
