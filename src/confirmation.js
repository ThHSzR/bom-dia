import { proto } from '@whiskeysockets/baileys';

// Registrar ANTES de sendMessage para nao perder recibos que chegam antes do retorno.
// SERVER_ACK confirma o servidor; DELIVERY_ACK/READ confirmam o destinatario.
export function observeConfirmation(socket, id, timeoutMs = 90_000, onProgress = () => {}) {
  const Status = proto.WebMessageInfo.Status;
  let confirmation = 'unconfirmed', error, timer, resolveWait, settled = false, result;
  function finish() {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    socket.ev.off('messages.update', onUpdate);
    socket.ev.off('connection.update', onConnection);
    socket.ws.off('CB:ack,class:message', onAck);
    result = { confirmation, ...(error ? { confirmationError: error } : {}),
      confirmationCheckedAt: new Date().toISOString() };
    resolveWait?.(result);
  }
  function record(status, code) {
    if (settled) return;
    onProgress({ status: Status[status] ?? status, ...(code ? { code: String(code) } : {}) });
    if (status === Status.ERROR) {
      confirmation = 'rejected'; error = String(code ?? 'erro sem codigo');
      // O Baileys pode recuperar alguns erros com o mesmo ID. Aguarda a janela.
    } else if (status >= Status.DELIVERY_ACK) {
      confirmation = 'delivered'; error = undefined; finish();
    } else if (status === Status.SERVER_ACK) {
      confirmation = 'server_ack'; error = undefined;
    }
  }
  function onAck(node) {
    if (node.attrs?.id !== id) return;
    record(node.attrs.error ? Status.ERROR : Status.SERVER_ACK, node.attrs.error);
  }
  function onUpdate(updates) {
    for (const { key, update } of updates) {
      if (key.id === id && key.fromMe !== false && typeof update.status === 'number')
        record(update.status, update.messageStubParameters?.join(', '));
    }
  }
  function onConnection(update) {
    if (update.connection === 'close') {
      error ??= 'Conexao fechada antes da confirmacao de entrega';
      finish();
    }
  }
  socket.ev.on('messages.update', onUpdate);
  socket.ev.on('connection.update', onConnection);
  socket.ws.on('CB:ack,class:message', onAck);
  let waiting;
  return {
    wait() {
      if (settled) return Promise.resolve(result);
      waiting ??= new Promise(resolve => {
        resolveWait = resolve;
        timer = setTimeout(finish, timeoutMs);
      });
      return waiting;
    },
    cancel: finish
  };
}

export function confirmationMessage(record) {
  switch (record?.confirmation) {
    case 'delivered': return 'Entrega confirmada pelo WhatsApp do destinatario.';
    case 'server_ack': return 'Servidor confirmou recebimento; entrega ao destinatario ainda nao confirmada.';
    case 'rejected': return 'WhatsApp informou erro: ' + (record.confirmationError ?? 'sem codigo') + '. Entrega nao confirmada.';
    default: return 'Sem confirmacao do WhatsApp. Confira os logs e a conversa antes de repetir.';
  }
}
