import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectSchedule, localTimestamp, formatLogLine } from '../src/observability.js';
import { emptyState, dueDay } from '../src/core.js';

const config = { enabled: true, time: '07:15', timeZone: 'America/Sao_Paulo', catchUpMinutes: 120 };
test('log de horario explica cada bloqueio sem alterar a agenda', () => {
  const state = emptyState(); const now = new Date('2026-09-18T10:15:00Z');
  const cases = [
    [{ stopping: true }, 'encerrando'], [{ pairing: true }, 'vinculacao_sem_envio'],
    [{ online: false }, 'aguardando_conexao'], [{ busy: true }, 'envio_em_andamento'],
    [{ retryAt: now.getTime() + 30_000 }, 'aguardando_nova_tentativa'],
    [{ manualTest: true, testStarted: true }, 'teste_ja_iniciado'],
    [{ manualTest: true }, 'teste_manual_liberado'], [{}, 'envio_liberado']
  ];
  for (const [runtime, reason] of cases) {
    const result = inspectSchedule(now, config, state, { online: true, ...runtime });
    assert.equal(result.reason, reason);
    assert.equal(result.ready, ['teste_manual_liberado', 'envio_liberado'].includes(reason));
  }
  assert.equal(inspectSchedule(now, { ...config, enabled: false }, state, { online: true }).reason, 'agenda_desativada');
  assert.equal(inspectSchedule(now, config, { ...state, history: [{ day: '2026-09-18', status: 'uncertain' }] }, { online: true }).reason, 'dia_ja_reservado');
  assert.deepEqual(state, emptyState());
});

test('checagem detalhada e agenda concordam na janela e no fuso', () => {
  for (const at of ['2026-09-18T10:14:59Z', '2026-09-18T10:15:00Z', '2026-09-18T12:15:59Z', '2026-09-18T12:16:00Z']) {
    const now = new Date(at), state = emptyState();
    const result = inspectSchedule(now, config, state, { online: true });
    assert.equal(result.ready, Boolean(dueDay(now, config, state)));
  }
  assert.equal(inspectSchedule(new Date('2026-09-18T10:00:00Z'), config, emptyState(), { online: true }).reason, 'antes_do_horario');
  assert.equal(inspectSchedule(new Date('2026-09-18T13:00:00Z'), config, emptyState(), { online: true }).reason, 'janela_encerrada');
  assert.equal(localTimestamp(new Date('2026-09-18T19:30:00Z'), config.timeZone), '2026-09-18 16:30:00');
});

test('visualizacao le logs novos, antigos e do supervisor sem quebrar linhas', () => {
  const raw = JSON.stringify({ at: '2026-09-18T19:30:00Z', atLocal: '2026-09-18 16:30:00',
    event: 'sorteio', caption: 'Bom dia\nCafe!' });
  assert.match(formatLogLine(raw), /^\x1b\[33m\[2026-09-18 16:30:00\]\x1b\[0m sorteio/);
  assert.equal(formatLogLine(raw).includes('\n'), false);
  assert.equal(formatLogLine('2026-09-18 19:30:00 ' + raw), formatLogLine(raw));
  assert.match(formatLogLine(JSON.stringify({ at: 'UTC', event: 'antigo' })), /^\x1b\[33m\[UTC\]\x1b\[0m/);
  assert.equal(formatLogLine('erro simples'), 'erro simples');
  assert.equal(formatLogLine('{incompleto'), '{incompleto');
  const decision = inspectSchedule(new Date('2026-09-18T10:00:00Z'), config, emptyState(), { online: true });
  const scheduleLine = formatLogLine(JSON.stringify({ atLocal: '2026-09-18 07:00:00', event: 'verificacao_horario', ...decision }));
  assert.match(scheduleLine, /HORARIO.*programado=07:15.*aguardando horario/);
  assert.match(scheduleLine, /\x1b\[32mconexao=online\x1b\[0m/);

  const offlineLine = formatLogLine(JSON.stringify({ atLocal: '2026-09-18 07:00:00', event: 'verificacao_horario',
    ...inspectSchedule(new Date('2026-09-18T10:00:00Z'), config, emptyState(), { online: false }) }));
  assert.match(offlineLine, /\x1b\[31mconexao=offline\x1b\[0m/);

  const errorLine = formatLogLine(JSON.stringify({ atLocal: '2026-09-18 07:00:00', event: 'falha_preparacao', error: 'boom' }));
  assert.match(errorLine, /^\x1b\[31m.*falha_preparacao.*boom.*\x1b\[0m$/);
});
