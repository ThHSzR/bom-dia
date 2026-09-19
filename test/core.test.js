import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateConfig, emptyState, clockParts, dueDay, chooseGif, reserve, dispatch,
  atomicWrite, readJSON, listGifs, validateState, isSunday, shouldSendSundayAudio } from '../src/core.js';

const c = { enabled: true, ownerNumber: '5511999999999', recipientNumber: '5511988888888',
  time: '07:15', timeZone: 'America/Sao_Paulo', catchUpMinutes: 120, caption: 'Bom dia!', maxVideoSeconds: 12 };
const files = ['a', 'b', 'c'].map(hash => ({ name: hash + '.gif', hash }));
test('configuracao rejeita horario, fuso, grupo, numero e limites invalidos', () => {
  assert.equal(validateConfig(c), c);
  for (const change of [{ time: '24:00' }, { timeZone: 'Nao/Existe' },
    { recipientNumber: '123@g.us' }, { ownerNumber: '+5511999999999' },
    { catchUpMinutes: -1 }, { maxVideoSeconds: 0 }, { caption: '' }, { enabled: 'true' }])
    assert.throws(() => validateConfig({ ...c, ...change }));
  assert.equal(validateConfig({ ...c, sundayAudio: { enabled: false, file: null } }).sundayAudio.enabled, false);
  assert.equal(validateConfig({ ...c, sundayAudio: { enabled: true, file: 'data/private/domingo.mp3' } }).sundayAudio.enabled, true);
  for (const sundayAudio of [{}, null, { enabled: 'true', file: 'a.mp3' }, { enabled: true },
    { enabled: true, file: '' }, { enabled: false, file: '' }])
    assert.throws(() => validateConfig({ ...c, sundayAudio }));
});
test('agenda respeita fuso, horario, janela, desativacao e dia civil', () => {
  const s = emptyState();
  assert.equal(dueDay(new Date('2026-09-17T10:14:59Z'), c, s), null);
  assert.equal(dueDay(new Date('2026-09-17T10:15:00Z'), c, s), '2026-09-17');
  assert.equal(dueDay(new Date('2026-09-17T12:15:59Z'), c, s), '2026-09-17');
  assert.equal(dueDay(new Date('2026-09-17T12:16:00Z'), c, s), null);
  assert.equal(dueDay(new Date('2026-09-17T10:15:00Z'), { ...c, enabled: false }, s), null);
  assert.deepEqual(clockParts(new Date('2026-09-18T01:00:00Z'), c.timeZone), { day: '2026-09-17', minute: 1320 });
});
test('audio de domingo respeita fuso e nao entra no teste manual', () => {
  const config = { ...c, sundayAudio: { enabled: true, file: 'data/private/domingo.mp3' } };
  assert.equal(isSunday(new Date('2026-09-20T03:00:00Z'), 'America/Sao_Paulo'), true);
  assert.equal(shouldSendSundayAudio(new Date('2026-09-20T10:15:00Z'), config), true);
  assert.equal(shouldSendSundayAudio(new Date('2026-09-20T10:15:00Z'), config, { manualTest: true }), false);
  assert.equal(shouldSendSundayAudio(new Date('2026-09-21T10:15:00Z'), config), false);
  assert.equal(shouldSendSundayAudio(new Date('2026-09-20T10:15:00Z'), { ...c, sundayAudio: { enabled: false, file: null } }), false);
});
test('horario repetido no fim do horario de verao nao reenvia', () => {
  const config = { ...c, time: '01:30', timeZone: 'America/New_York' };
  let s = emptyState();
  const day = dueDay(new Date('2026-11-01T05:30:00Z'), config, s);
  assert.equal(day, '2026-11-01');
  s = reserve(s, chooseGif(files, s), day, c.recipientNumber, 'a');
  assert.equal(dueDay(new Date('2026-11-01T06:30:00Z'), config, s), null);
});
test('ciclo sem repeticoes e sem repeticao imediata entre ciclos', () => {
  let s = emptyState();
  const hashes = [];
  for (let n = 1; n <= 9; n++) {
    const choice = chooseGif(files, s, () => 0);
    hashes.push(choice.gif.hash);
    s = reserve(s, choice, '2026-09-' + String(n).padStart(2, '0'), c.recipientNumber, String(n));
  }
  for (let n = 0; n < 9; n += 3) assert.equal(new Set(hashes.slice(n, n + 3)).size, 3);
  for (let n = 1; n < hashes.length; n++) assert.notEqual(hashes[n], hashes[n - 1]);
  assert.equal(s.cycle, 3);
});
test('um unico GIF repete apenas no proximo ciclo; adicoes e remocoes funcionam', () => {
  const s = reserve(emptyState(), { gif: files[0], reset: false }, '2026-09-01', c.recipientNumber, '1');
  assert.equal(chooseGif([files[0]], s).reset, true);
  assert.equal(chooseGif(files.slice(0, 2), s).gif.hash, 'b');
  assert.equal(chooseGif([files[2]], s).gif.hash, 'c');
});
test('reserva persistida antes do envio e restaurada apos reinicio', async () => {
  const state = emptyState(); const order = []; let disk;
  const result = await dispatch({ state, selection: chooseGif(files, state), day: '2026-09-17',
    recipient: c.recipientNumber, id: 'ID', persist: async s => { disk = structuredClone(s); order.push('save'); },
    send: async () => { order.push('send'); assert.equal(disk.history[0].status, 'attempting'); return { key: { id: 'ID' } }; } });
  assert.deepEqual(order, ['save', 'send', 'save']);
  assert.equal(result.status, 'submitted');
  assert.equal(dueDay(new Date('2026-09-17T10:16:00Z'), c, disk), null);
});
test('falha de rede ambigua nao libera o dia para segundo envio', async () => {
  const state = emptyState(); let attempts = 0;
  await dispatch({ state, selection: chooseGif(files, state), day: '2026-09-17',
    recipient: c.recipientNumber, id: 'ID', persist: async () => {},
    send: async () => { attempts++; throw Error('socket closed'); } });
  assert.equal(state.history[0].status, 'uncertain');
  assert.equal(dueDay(new Date('2026-09-17T10:16:00Z'), c, state), null);
  assert.equal(attempts, 1);
});
test('metadados do audio de domingo ficam na mesma reserva diaria', async () => {
  const state = emptyState();
  const selection = { ...chooseGif(files, state), sundayAudio: { file: 'domingo.mp3', mimetype: 'audio/mpeg', size: 1234 } };
  const result = await dispatch({ state, selection, day: '2026-09-20',
    recipient: c.recipientNumber, id: 'ID', persist: async () => {},
    send: async () => ({ key: { id: 'ID' }, confirmation: 'delivered',
      sundayAudio: { ...selection.sundayAudio, id: 'AUDIO', messageId: 'AUDIO', confirmation: 'delivered' } }) });
  assert.equal(result.status, 'submitted');
  assert.deepEqual(state.history[0].sundayAudio, {
    file: 'domingo.mp3', mimetype: 'audio/mpeg', size: 1234, id: 'AUDIO', messageId: 'AUDIO', confirmation: 'delivered'
  });
  assert.equal(dueDay(new Date('2026-09-20T10:16:00Z'), c, state), null);
});
test('falha ao persistir reserva impede envio', async () => {
  const state = emptyState(); let attempts = 0;
  await assert.rejects(dispatch({ state, selection: chooseGif(files, state), day: '2026-09-17',
    recipient: c.recipientNumber, id: 'ID', persist: async () => { throw Error('disk full'); },
    send: async () => { attempts++; } }), /disk full/);
  assert.equal(attempts, 0);
});
test('queda depois do envio mantem reserva duravel, mesmo sem status final', async () => {
  const state = emptyState(); let disk, saves = 0;
  await assert.rejects(dispatch({ state, selection: chooseGif(files, state), day: '2026-09-17',
    recipient: c.recipientNumber, id: 'ID', persist: async s => {
      if (++saves === 2) throw Error('disk full'); disk = structuredClone(s);
    }, send: async () => ({ key: { id: 'ID' } }) }), /disk full/);
  assert.equal(disk.history[0].status, 'attempting');
  assert.equal(dueDay(new Date('2026-09-17T10:16:00Z'), c, disk), null);
});
test('gravacao atomica, JSON corrompido e deduplicacao por conteudo', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bom-dia-test-'));
  try {
    const file = path.join(dir, 'state.json');
    await atomicWrite(file, JSON.stringify(emptyState()));
    assert.deepEqual(validateState(await readJSON(file)), emptyState());
    await atomicWrite(file, '{corrompido');
    await assert.rejects(readJSON(file, emptyState()));
    assert.throws(() => validateState({}));
    await writeFile(path.join(dir, 'um.gif'), 'mesmo conteudo');
    await writeFile(path.join(dir, 'dois.GIF'), 'mesmo conteudo');
    await writeFile(path.join(dir, 'tres.gif'), 'outro conteudo');
    await writeFile(path.join(dir, 'ignorado.mp4'), 'outro arquivo');
    assert.equal((await listGifs(dir)).length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
