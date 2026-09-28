import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, emptyState, reserve, dispatch } from '../src/core.js';

const base = {
  enabled: true,
  ownerNumber: '5511999999999',
  time: '07:15',
  timeZone: 'America/Sao_Paulo',
  catchUpMinutes: 120,
  caption: 'Bom dia!',
  maxVideoSeconds: 12
};
const selection = { gif: { name: 'a.gif', hash: 'a' }, reset: false };

test('recipientNumbers aceita varios contatos e normaliza o primeiro para compatibilidade', () => {
  const config = validateConfig({ ...base, recipientNumbers: ['5511988888888', '5511977777777'] });
  assert.deepEqual(config.recipientNumbers, ['5511988888888', '5511977777777']);
  assert.equal(config.recipientNumber, '5511988888888');
});

test('recipientNumber antigo continua funcionando', () => {
  const config = validateConfig({ ...base, recipientNumber: '5511988888888' });
  assert.deepEqual(config.recipientNumbers, ['5511988888888']);
  assert.equal(config.recipientNumber, '5511988888888');
});

test('lista de destinatarios rejeita vazios, numeros invalidos e duplicados', () => {
  for (const recipientNumbers of [[], ['123@g.us'], ['5511988888888', '5511988888888']])
    assert.throws(() => validateConfig({ ...base, recipientNumbers }));
});

test('reserva diaria registra todos os destinatarios sem perder o campo legado', () => {
  const recipients = ['5511988888888', '5511977777777'];
  const state = reserve(emptyState(), selection, '2026-09-28', recipients, 'ID');
  assert.equal(state.history[0].recipient, recipients[0]);
  assert.deepEqual(state.history[0].recipients, recipients);
});

test('dispatch persiste o resultado individual de cada destinatario', async () => {
  const recipients = ['5511988888888', '5511977777777'];
  const state = emptyState();
  const deliveries = recipients.map((recipient, index) => ({
    recipient, messageId: 'MSG-' + index, confirmation: 'delivered',
    confirmationCheckedAt: new Date().toISOString()
  }));
  const record = await dispatch({ state, selection, day: '2026-09-28', recipient: recipients,
    id: 'MSG-0', persist: async () => {}, send: async () => ({
      key: { id: 'MSG-0' }, confirmation: 'delivered', deliveries
    }) });
  assert.equal(record.status, 'submitted');
  assert.deepEqual(record.deliveries, deliveries);
});
