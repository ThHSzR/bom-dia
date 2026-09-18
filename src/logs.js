import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { paths } from './core.js';
import { formatLogLine } from './observability.js';

const service = process.argv.includes('--service');
if (service && !process.env.PREFIX) throw Error('logs:service deve ser usado dentro do Termux.');
const file = service ? path.join(process.env.PREFIX, 'var/log/sv/bom-dia/current') : path.join(paths.logs, 'bot.jsonl');
console.log('Acompanhando: ' + file);
console.log('CTRL+C encerra apenas esta visualizacao; o bot continua rodando pelo servico.');
const child = spawn('tail', ['-n', '40', '-F', '-s', '1', file], { stdio: ['ignore', 'pipe', 'pipe'] });
const lines = createInterface({ input: child.stdout });
lines.on('line', line => console.log(formatLogLine(line)));
child.stderr.on('data', data => process.stderr.write(data));
child.on('error', error => {
  console.error('Nao foi possivel acompanhar os logs. Execute no Termux com o comando tail disponivel. ' + error.message);
  process.exitCode = 1;
});
let stopped = false;
function stop() { stopped = true; child.kill('SIGTERM'); lines.close(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('close', code => { lines.close(); process.exitCode = stopped ? 0 : (code ?? 1); });
