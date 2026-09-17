import { loadState } from './core.js';
const state = await loadState();
console.log('Envios agendados:');
console.table(state.history.slice(-30).map(x => ({ dia: x.day, status: x.status, confirmacao: x.confirmation ?? 'nao monitorada', arquivo: x.file,
  ciclo: x.cycle, frase: x.caption ?? '(versao anterior)', cicloFrase: x.captionCycle ?? '-', id: x.messageId ?? x.id })));
console.log('Historico completo: data/state.json. submitted nao confirma entrega ao destinatario.');
if (state.testHistory?.length) {
  console.log('Testes manuais (nao contam no limite diario):');
  console.table(state.testHistory.slice(-30).map(x => ({ dia: x.day, status: x.status, confirmacao: x.confirmation ?? 'nao monitorada',
    arquivo: x.file, frase: x.caption, id: x.messageId ?? x.id })));
}
