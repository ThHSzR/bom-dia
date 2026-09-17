import { loadState } from './core.js';
const state = await loadState();
console.table(state.history.slice(-30).map(x => ({ dia: x.day, status: x.status, arquivo: x.file,
  ciclo: x.cycle, frase: x.caption ?? '(versao anterior)', cicloFrase: x.captionCycle ?? '-', id: x.messageId ?? x.id })));
console.log('Historico completo: data/state.json. submitted nao confirma entrega ao destinatario.');
