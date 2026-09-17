import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCaptions, chooseCaption } from '../src/captions.js';
import { emptyState, validateState, reserve, dispatch, chooseGif } from '../src/core.js';

const gif = { name: 'cafe.gif', hash: 'gif-1' };
const phrases = parseCaptions(['BOM DIA ☕\nQue seu dia seja lindo!', 'Bodia 🌹\nUm abraço!', 'Buntinha 🐣\nBom dia, surpresa!']);
const selection = state => ({ ...chooseGif([gif], state), caption: chooseCaption(phrases, state, {}, () => 0) });

test('colecao tem 40 frases unicas, saudacao, quebra real e um easter egg', async () => {
  const values = JSON.parse(await readFile(new URL('../captions.json', import.meta.url), 'utf8'));
  const parsed = parseCaptions(values);
  assert.equal(parsed.length, 40);
  assert.equal(parsed.filter(x => x.text.startsWith('Buntinha')).length, 1);
  assert.ok(parsed.every(x => x.text.split('\n').length === 2 && !x.text.includes('\\n')));
});

test('frases invalidas sao rejeitadas e duplicatas normalizadas nao pesam no sorteio', () => {
  for (const value of [[], null, ['Boa noite\nOi'], ['Bom dia'], ['Bom dia\n  '], [42], ['Bom dia\n' + 'x'.repeat(1000)]])
    assert.throws(() => parseCaptions(value));
  assert.equal(parseCaptions(['Bom dia\nAbraço', '  Bom dia\r\n Abraço  ']).length, 1);
});

test('ciclo das frases e independente do GIF, persiste apos reinicio e evita repeticao na virada', () => {
  let state = emptyState(); const used = [];
  for (let n = 1; n <= 9; n++) {
    const chosen = selection(state);
    used.push(chosen.caption.hash);
    state = reserve(state, chosen, `2026-09-0${n}`, '5511999999999', String(n));
    state = validateState(JSON.parse(JSON.stringify(state)));
    assert.equal(state.history.at(-1).caption, chosen.caption.text);
  }
  for (let n = 0; n < 9; n += 3) assert.equal(new Set(used.slice(n, n + 3)).size, 3);
  for (let n = 1; n < used.length; n++) assert.notEqual(used[n], used[n - 1]);
  assert.equal(state.cycle, 9);
  assert.equal(state.captionRotation.cycle, 3);
});

test('historico antigo e preservado e previsualizacao nao consome frases', () => {
  const old = reserve(emptyState(), { gif, reset: false }, '2026-09-01', '5511999999999', 'old');
  const original = structuredClone(old);
  const chosen = chooseCaption(phrases, old, {});
  assert.deepEqual(old, original);
  const next = reserve(validateState(old), { ...chooseGif([gif], old), caption: chosen }, '2026-09-02', '5511999999999', 'new');
  assert.deepEqual(next.history[0], original.history[0]);
  assert.equal(next.captionRotation.used.length, 1);
  assert.equal(next.history.length, 2);
  assert.throws(() => validateState({ ...next, captionRotation: null }));
});

test('modo fixo preserva a legenda e nao consome ciclo aleatorio', () => {
  const state = emptyState();
  const caption = chooseCaption([], state, { captionMode: 'fixed', caption: 'Bom dia!\nOi ☕' });
  const next = reserve(state, { gif, reset: false, caption }, '2026-09-01', '5511999999999', 'ID');
  assert.equal(next.history[0].caption, 'Bom dia!\nOi ☕');
  assert.equal(next.history[0].captionCycle, null);
  assert.equal(next.captionRotation, undefined);
});

test('falha ambigua consome frase com GIF na mesma reserva antes de enviar', async () => {
  const state = emptyState(); let disk;
  await dispatch({ state, selection: selection(state), day: '2026-09-01', recipient: '5511999999999', id: 'ID',
    persist: async value => { disk = structuredClone(value); }, send: async () => {
      assert.equal(disk.captionRotation.used.length, 1);
      assert.equal(disk.used.length, 1);
      assert.ok(disk.history[0].caption.includes('\n'));
      throw Error('timeout');
    } });
  assert.equal(disk.history[0].status, 'uncertain');
  assert.notEqual(chooseCaption(phrases, disk, {}).hash, disk.captionRotation.lastHash);
});

test('frases adicionadas entram no ciclo e uma unica frase pode repetir', () => {
  const first = phrases[0];
  const state = { ...emptyState(), captionRotation: { cycle: 1, used: [first.hash], lastHash: first.hash } };
  assert.equal(chooseCaption([first], state, {}).reset, true);
  assert.equal(chooseCaption(phrases.slice(0, 2), state, {}).hash, phrases[1].hash);
});
