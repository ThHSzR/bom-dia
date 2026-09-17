import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { proto } from '@whiskeysockets/baileys';
import { observeConfirmation, confirmationMessage } from '../src/confirmation.js';
import { dispatch, emptyState } from '../src/core.js';

const S = proto.WebMessageInfo.Status;
const socket = () => ({ ev: new EventEmitter(), ws: new EventEmitter() });
const update = (sock, id, status) => sock.ev.emit('messages.update', [{ key: { id, fromMe: true }, update: { status } }]);
function cleaned(sock) {
  assert.equal(sock.ev.listenerCount('messages.update'), 0);
  assert.equal(sock.ev.listenerCount('connection.update'), 0);
  assert.equal(sock.ws.listenerCount('CB:ack,class:message'), 0);
}

test('teste nao termina ao retornar sendMessage nem com ACK do servidor; espera entrega', async () => {
  const sock = socket(), observer = observeConfirmation(sock, 'ID', 1000), state = emptyState();
  let completed = false;
  const job = dispatch({ state, selection: { gif: { name: 'a.gif', hash: 'a' }, reset: false },
    day: '2026-09-17', recipient: '5511999999999', id: 'ID', manualTest: true,
    persist: async () => {}, send: async () => ({ key: { id: 'ID' }, ...await observer.wait() })
  }).then(result => { completed = true; return result; });
  await nextTurn();
  sock.ws.emit('CB:ack,class:message', { attrs: { id: 'ID' } });
  await nextTurn();
  assert.equal(completed, false);
  assert.equal(state.testHistory[0].status, 'attempting');
  update(sock, 'OTHER', S.DELIVERY_ACK);
  assert.equal(completed, false);
  update(sock, 'ID', S.DELIVERY_ACK);
  const result = await job;
  assert.equal(result.confirmation, 'delivered');
  assert.equal(result.status, 'submitted');
  cleaned(sock);
});

test('recibo recebido antes do retorno do envio nao se perde', async () => {
  const sock = socket(), observer = observeConfirmation(sock, 'ID', 30);
  update(sock, 'ID', S.READ);
  assert.equal((await observer.wait()).confirmation, 'delivered');
  cleaned(sock);
});

test('ACK do servidor sem recibo de entrega nao e anunciado como entregue', async () => {
  const sock = socket(), observer = observeConfirmation(sock, 'ID', 10);
  sock.ws.emit('CB:ack,class:message', { attrs: { id: 'ID' } });
  const result = await observer.wait();
  assert.equal(result.confirmation, 'server_ack');
  assert.match(confirmationMessage(result), /ainda nao confirmada/);
  cleaned(sock);
});

test('timeout sem ACK e falha de servidor ficam incertos no historico', async () => {
  for (const error of [undefined, '479']) {
    const sock = socket(), observer = observeConfirmation(sock, 'ID', 10), state = emptyState();
    if (error) sock.ws.emit('CB:ack,class:message', { attrs: { id: 'ID', error } });
    const result = await dispatch({ state, selection: { gif: { name: 'a.gif', hash: 'a' }, reset: false },
      day: '2026-09-17', recipient: '5511999999999', id: 'ID', manualTest: true, persist: async () => {},
      send: async () => ({ key: { id: 'ID' }, ...await observer.wait() }) });
    assert.equal(result.status, 'uncertain');
    assert.equal(result.confirmation, error ? 'rejected' : 'unconfirmed');
    if (error) assert.equal(result.confirmationError, error);
    cleaned(sock);
  }
});

test('erro recuperado pelo protocolo com mesmo ID aceita recibo posterior', async () => {
  const sock = socket(), observer = observeConfirmation(sock, 'ID', 1000);
  sock.ws.emit('CB:ack,class:message', { attrs: { id: 'ID', error: '463' } });
  update(sock, 'ID', S.DELIVERY_ACK);
  const result = await observer.wait();
  assert.equal(result.confirmation, 'delivered');
  assert.equal(result.confirmationError, undefined);
  cleaned(sock);
});

test('desconexao e cancelamento liberam listeners sem confirmar entrega', async () => {
  for (const cancel of [false, true]) {
    const sock = socket(), observer = observeConfirmation(sock, 'ID', 1000);
    const pending = observer.wait();
    if (cancel) observer.cancel(); else sock.ev.emit('connection.update', { connection: 'close' });
    assert.equal((await pending).confirmation, 'unconfirmed');
    cleaned(sock);
  }
});
