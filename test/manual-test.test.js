import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, reserve, dispatch, dueDay, validateState, chooseGif } from '../src/core.js';
import { parseCaptions, chooseCaption } from '../src/captions.js';

const config = { enabled: true, time: '07:15', timeZone: 'America/Sao_Paulo', catchUpMinutes: 120 };
const gifs = [{ name: 'a.gif', hash: 'a' }, { name: 'b.gif', hash: 'b' }];
const captions = parseCaptions(['Bom dia\nCafe!', 'Bodia\nFlores!']);
const choose = state => ({ ...chooseGif(gifs, state, () => 0), caption: chooseCaption(captions, state, {}, () => 0) });
const day = '2026-09-17';

test('teste real permite segundo envio no dia e preserva registro agendado', async () => {
  const state = reserve(emptyState(), choose(emptyState()), day, '5511999999999', 'daily');
  state.history[0].status = 'submitted';
  const original = structuredClone(state.history);
  let calls = 0;
  await dispatch({ state, selection: choose(state), day, recipient: '5511999999999', id: 'test',
    manualTest: true, persist: async () => {}, send: async () => { calls++; return { key: { id: 'test' } }; } });
  assert.equal(calls, 1);
  assert.deepEqual(state.history, original);
  assert.equal(state.testHistory[0].status, 'submitted');
  assert.equal(state.testHistory[0].mode, 'test');
  assert.notEqual(state.testHistory[0].hash, state.history[0].hash);
  assert.notEqual(state.testHistory[0].captionHash, state.history[0].captionHash);
  assert.equal(dueDay(new Date(day + 'T10:16:00Z'), config, state), null);
});

test('teste antes do horario nao consome envio agendado e sobrevive ao reinicio', () => {
  const state = reserve(emptyState(), choose(emptyState()), day, '5511999999999', 'test', true);
  const restored = validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.history.length, 0);
  assert.equal(restored.testHistory.length, 1);
  assert.equal(dueDay(new Date(day + 'T10:15:00Z'), config, restored), day);
  assert.throws(() => validateState({ ...restored, testHistory: {} }));
});

test('teste ambiguo e registrado uma vez sem modificar agenda', async () => {
  const state = emptyState(); let disk, calls = 0;
  const result = await dispatch({ state, selection: choose(state), day, recipient: '5511999999999', id: 'test',
    manualTest: true, persist: async value => { disk = structuredClone(value); }, send: async () => {
      calls++; assert.equal(disk.testHistory[0].status, 'attempting');
      assert.equal(disk.captionRotation.used.length, 1); throw Error('timeout');
    } });
  assert.equal(calls, 1);
  assert.equal(result.status, 'uncertain');
  assert.equal(disk.history.length, 0);
});

test('falha ao salvar teste impede envio e nao consome sorteios', async () => {
  const state = emptyState(); let calls = 0;
  await assert.rejects(dispatch({ state, selection: choose(state), day, recipient: '5511999999999', id: 'test',
    manualTest: true, persist: async () => { throw Error('disk full'); }, send: async () => { calls++; } }), /disk full/);
  assert.equal(calls, 0);
  assert.deepEqual(state, emptyState());
});
