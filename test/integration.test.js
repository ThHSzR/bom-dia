import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { generateWAMessageContent, proto } from '@whiskeysockets/baileys';
import { localAuth, hasPairedSession } from '../src/auth.js';
import { prepareAudio, prepareMedia } from '../src/media.js';
import { dispatch, dueDay, emptyState, shouldSendSundayAudio } from '../src/core.js';
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
    const media = await prepareMedia({ file }, { maxVideoSeconds: 12, caption: 'Bom dia 🌹\nQue seu dia seja lindo!' }, dir);
    assert.ok((await readFile(media.video.url)).length > 0);
    assert.equal(media.jpegThumbnail[0], 0xff);
    let uploads = 0;
    const message = await generateWAMessageContent(media, {
      upload: async () => { uploads++; return { mediaUrl: 'https://example.invalid/video', directPath: '/offline-test' }; }
    });
    const restored = proto.Message.decode(proto.Message.encode(message).finish());
    assert.equal(uploads, 1);
    assert.equal(restored.videoMessage.gifPlayback, true);
    assert.equal(restored.videoMessage.caption, 'Bom dia 🌹\nQue seu dia seja lindo!');
    assert.equal(restored.videoMessage.mimetype, 'video/mp4');
    assert.ok(restored.videoMessage.jpegThumbnail.length > 0);
    assert.ok(restored.videoMessage.fileEncSha256.length > 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('audio de domingo valida arquivo local sem enviar nada', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bom-dia-audio-'));
  try {
    const audioFile = path.join(dir, 'domingo.mp3');
    await writeFile(audioFile, Buffer.from([1, 2, 3]));
    const audio = await prepareAudio(audioFile);
    assert.equal(audio.name, 'domingo.mp3');
    assert.equal(audio.mimetype, 'audio/mpeg');
    assert.equal(audio.size, 3);
    assert.deepEqual(audio.content, { audio: { url: audioFile }, mimetype: 'audio/mpeg' });
    await assert.rejects(prepareAudio(path.join(dir, 'ausente.mp3')), /nao encontrado/);
    await writeFile(path.join(dir, 'texto.txt'), 'nao e audio');
    await assert.rejects(prepareAudio(path.join(dir, 'texto.txt')), /Audio de domingo deve ser/);
    await writeFile(path.join(dir, 'vazio.ogg'), '');
    await assert.rejects(prepareAudio(path.join(dir, 'vazio.ogg')), /esta vazio/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('domingo versionado prepara o audio especifico e simula o envio sem WhatsApp', async () => {
  const config = { enabled: true, time: '07:15', timeZone: 'America/Sao_Paulo', catchUpMinutes: 120,
    sundayAudio: { enabled: true, file: 'audio/abencoa-senhor.mp3' } };
  const sunday = new Date('2026-09-20T10:15:00Z');
  assert.equal(shouldSendSundayAudio(sunday, config), true);
  assert.equal(shouldSendSundayAudio(new Date('2026-09-21T10:15:00Z'), config), false);

  const audio = await prepareAudio(config.sundayAudio.file);
  const bytes = await readFile(audio.content.audio.url);
  assert.equal(audio.name, 'abencoa-senhor.mp3');
  assert.equal(audio.mimetype, 'audio/mpeg');
  assert.equal(audio.size, 3930560);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    'f885947b4bcc48d281996d47fd0c00fe198b77804ec73e4c3e7df4bac8245b24');

  const state = emptyState();
  let simulatedSends = 0;
  const selection = { gif: { name: 'bom-dia.gif', hash: 'gif-hash' }, reset: false,
    sundayAudio: { file: audio.name, mimetype: audio.mimetype, size: audio.size } };
  const record = await dispatch({ state, selection, day: '2026-09-20', recipient: '5511988888888',
    id: 'GIF-ID', persist: async () => {}, send: async () => {
      simulatedSends += 2;
      return { key: { id: 'GIF-ID' }, confirmation: 'delivered', sundayAudio: {
        ...selection.sundayAudio, id: 'AUDIO-ID', messageId: 'AUDIO-ID', confirmation: 'delivered'
      } };
    } });
  assert.equal(simulatedSends, 2);
  assert.equal(record.sundayAudio.file, 'abencoa-senhor.mp3');
  assert.equal(record.sundayAudio.confirmation, 'delivered');
  assert.equal(dueDay(new Date('2026-09-20T10:16:00Z'), config, state), null);
});
