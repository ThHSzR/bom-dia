import { clockParts, dueDay } from './core.js';

export function inspectSchedule(now, config, state, runtime = {}) {
  const { day, minute } = clockParts(now, config.timeZone);
  const previous = state.history.find(item => item.day === day);
  const scheduled = config.time.split(':').map(Number);
  const elapsedMinutes = minute - (scheduled[0] * 60 + scheduled[1]);
  const retrySeconds = Math.max(0, Math.ceil(((runtime.retryAt ?? 0) - now.getTime()) / 1000));
  let reason;
  if (runtime.stopping) reason = 'encerrando';
  else if (runtime.pairing) reason = 'vinculacao_sem_envio';
  else if (!runtime.online) reason = 'aguardando_conexao';
  else if (runtime.busy) reason = 'envio_em_andamento';
  else if (retrySeconds > 0) reason = 'aguardando_nova_tentativa';
  else if (runtime.manualTest) reason = runtime.testStarted ? 'teste_ja_iniciado' : 'teste_manual_liberado';
  else if (!config.enabled) reason = 'agenda_desativada';
  else if (previous) reason = 'dia_ja_reservado';
  else if (elapsedMinutes < 0) reason = 'antes_do_horario';
  else if (dueDay(now, config, state)) reason = 'envio_liberado';
  else reason = 'janela_encerrada';
  return { day, scheduledTime: config.time, timeZone: config.timeZone,
    enabled: config.enabled, online: Boolean(runtime.online), elapsedMinutes,
    catchUpMinutes: config.catchUpMinutes, previousStatus: previous?.status ?? null,
    retrySeconds, reason, ready: reason === 'envio_liberado' || reason === 'teste_manual_liberado' };
}

export function localTimestamp(date, timeZone) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date);
}

export function formatLogLine(line) {
  try {
    // svlogd pode acrescentar o proprio timestamp antes do JSON.
    const start = line.indexOf('{');
    if (start < 0) return line;
    const { at, atLocal, event, ...fields } = JSON.parse(line.slice(start));
    if (!event) return line;
    if (event === 'verificacao_horario') {
      const reasons = { encerrando: 'encerrando', vinculacao_sem_envio: 'vinculando, sem envio',
        aguardando_conexao: 'aguardando conexao', envio_em_andamento: 'envio em andamento',
        aguardando_nova_tentativa: 'aguardando nova tentativa', teste_ja_iniciado: 'teste ja iniciado',
        teste_manual_liberado: 'teste manual liberado', agenda_desativada: 'agenda desativada',
        dia_ja_reservado: 'hoje ja tem envio/tentativa registrada', antes_do_horario: 'aguardando horario',
        envio_liberado: 'hora de enviar', janela_encerrada: 'janela de hoje encerrada' };
      return `[${atLocal ?? at}] HORARIO | programado=${fields.scheduledTime} (${fields.timeZone})` +
        ` | ${reasons[fields.reason] ?? fields.reason} | conexao=${fields.online ? 'online' : 'offline'}` +
        (fields.previousStatus ? ` | registro=${fields.previousStatus}` : '') +
        (fields.retrySeconds > 0 ? ` | nova tentativa em ${fields.retrySeconds}s` : '');
    }
    return `[${atLocal ?? at ?? '?'}] ${event} | ` + Object.entries(fields)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(' ');
  } catch { return line; }
}
