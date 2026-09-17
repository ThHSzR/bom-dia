import { loadState } from './core.js';
const state = await loadState();
console.table(state.history.slice(-30).map(x => ({ dia: x.day, status: x.status, arquivo: x.file,
  ciclo: x.cycle, id: x.messageId ?? x.id })));
console.log('Historico completo: data/state.json. submitted nao confirma entrega ao destinatario.');
