import net from 'node:net';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { paths } from './core.js';

export async function instanceLock() {
  // Porta apenas local, sem comandos nem dados: o SO libera a trava ate em SIGKILL.
  const server = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', e => reject(Error(e.code === 'EADDRINUSE'
      ? 'Outra instancia esta ativa (porta local 39471 ocupada). Pare o servico antes de vincular ou verificar.' : e.message)));
    server.listen({ host: '127.0.0.1', port: 39471, exclusive: true }, resolve);
  });
  return server;
}
export function log(event, fields = {}) {
  mkdirSync(paths.logs, { recursive: true, mode: 0o700 });
  const file = path.join(paths.logs, 'bot.jsonl');
  if (existsSync(file) && statSync(file).size > 5 * 1024 * 1024) {
    if (existsSync(file + '.3')) unlinkSync(file + '.3');
    for (let n = 2; n >= 1; n--) if (existsSync(file + '.' + n)) renameSync(file + '.' + n, file + '.' + (n + 1));
    renameSync(file, file + '.1');
  }
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...fields });
  appendFileSync(file, line + '\n', { mode: 0o600 });
  console.log(line);
}
