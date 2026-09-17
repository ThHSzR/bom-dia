import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { generateWAMessageContent, proto } from '@whiskeysockets/baileys';
import { localAuth, hasPairedSession } from '../src/auth.js';
import { prepareMedia } from '../src/media.js';
const exec = promisify(execFile);

test('reinicio aceita pareamento salvo antes de registered mudar para true', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bom-dia-pairing-'));
  try {
    const auth = await localAuth(dir);
    assert.equal(hasPairedSession(auth.state.creds), false);
    // Pedir um codigo ainda nao e concluir a vinculacao.
    auth.state.creds.me = { id: '5511999999999@s.whatsapp.net', name: '~' };
    await auth.saveCreds();
    assert.equal(hasPairedSession((await localAuth(dir)).state.creds), false);
    // configureSuccessfulPairing adiciona account, mas nao altera registered.
    auth.state.creds.account = { deviceSignature: Buffer.alloc(64, 1) };
    await auth.saveCreds();
    const restored = await localAuth(dir);
    assert.equal(restored.state.creds.registered, false);
    assert.equal(hasPairedSession(restored.state.creds), true);
    assert.equal(hasPairedSession({ registered: true }), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('sessao e chaves Signal persistem, incluindo escritas concorrentes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bom-dia-auth-'));
  try {
    const auth = await localAuth(dir);
    auth.state.creds.registered = true;
    await Promise.all([
      auth.saveCreds(),
      auth.state.keys.set({ session: { 'contato-1': Buffer.from('chave1') } }),
      auth.state.keys.set({ session: { 'contato-2': Buffer.from('chave2') } })
    ]);
    const restored = await localAuth(dir);
    assert.equal(restored.state.creds.registered, true);
    assert.deepEqual(restored.state.creds.noiseKey, auth.state.creds.noiseKey);
    const keys = await restored.state.keys.get('session', ['contato-1', 'contato-2']);
    assert.equal(Buffer.from(keys['contato-1']).toString(), 'chave1');
    assert.equal(Buffer.from(keys['contato-2']).toString(), 'chave2');
    await restored.state.keys.set({ session: { 'contato-1': null } });
    assert.equal((await (await localAuth(dir)).state.keys.get('session', ['contato-1']))['contato-1'], undefined);
    await writeFile(path.join(dir, 'session.json'), '{quebrado');
    await assert.rejects(localAuth(dir));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('GIF real converte e gera mensagem Baileys com legenda e gifPlayback, sem rede', async t => {
  try { await exec('ffmpeg', ['-version']); }
  catch { t.skip('FFmpeg nao instalado; instale para executar esta integracao.'); return; }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bom-dia-media-'));
  try {
    const file = path.join(dir, 'gif com espacos.gif');
    await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'testsrc=size=101x99:rate=10:duration=1', '-y', file]);
    const media = await prepareMedia({ file }, { maxVideoSeconds: 12, caption: 'Bom dia 🌹' }, dir);
    assert.ok((await readFile(media.video.url)).length > 0);
    assert.equal(media.jpegThumbnail[0], 0xff);
    let uploads = 0;
    const message = await generateWAMessageContent(media, {
      upload: async () => { uploads++; return { mediaUrl: 'https://example.invalid/video', directPath: '/offline-test' }; }
    });
    const restored = proto.Message.decode(proto.Message.encode(message).finish());
    assert.equal(uploads, 1);
    assert.equal(restored.videoMessage.gifPlayback, true);
    assert.equal(restored.videoMessage.caption, 'Bom dia 🌹');
    assert.equal(restored.videoMessage.mimetype, 'video/mp4');
    assert.ok(restored.videoMessage.jpegThumbnail.length > 0);
    assert.ok(restored.videoMessage.fileEncSha256.length > 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
