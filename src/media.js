import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, paths } from './core.js';

const exec = promisify(execFile);
export async function prepareMedia(gif, config, directory = paths.cache) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Um unico par de arquivos temporarios, protegido pela trava de instancia.
  const video = path.join(directory, 'current.mp4');
  const thumb = path.join(directory, 'current.jpg');
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-ignore_loop', '1', '-i', gif.file, '-t', String(config.maxVideoSeconds),
    '-vf', "scale=trunc(min(480\\,iw)/2)*2:-2,fps=15", '-an', '-c:v', 'libx264',
    '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video],
  { timeout: 180_000, maxBuffer: 1024 * 1024 });
  if ((await stat(video)).size > 15 * 1024 * 1024) throw Error('Video convertido excede o limite local de 15 MB.');
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', video, '-frames:v', '1', '-vf', 'scale=160:-2', thumb], { timeout: 30_000 });
  return { video: { url: video }, mimetype: 'video/mp4', gifPlayback: true,
    caption: config.caption, jpegThumbnail: await readFile(thumb) };
}

const AUDIO_MIMETYPES = new Map([
  ['.aac', 'audio/aac'],
  ['.m4a', 'audio/mp4'],
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg; codecs=opus'],
  ['.opus', 'audio/ogg; codecs=opus'],
  ['.wav', 'audio/wav']
]);

export async function prepareAudio(file) {
  const resolved = path.resolve(ROOT, file);
  const name = path.basename(resolved);
  const ext = path.extname(name).toLowerCase();
  const mimetype = AUDIO_MIMETYPES.get(ext);
  if (!mimetype) throw Error('Audio de domingo deve ser .mp3, .m4a, .aac, .ogg, .opus ou .wav.');
  let info;
  try { info = await stat(resolved); }
  catch (e) {
    if (e.code === 'ENOENT') throw Error('Audio de domingo nao encontrado: ' + name);
    throw e;
  }
  if (!info.isFile()) throw Error('Audio de domingo nao e um arquivo: ' + name);
  if (info.size <= 0) throw Error('Audio de domingo esta vazio: ' + name);
  if (info.size > 16 * 1024 * 1024) throw Error('Audio de domingo excede 16 MB: ' + name);
  return { content: { audio: { url: resolved }, mimetype }, name, size: info.size, mimetype };
}
