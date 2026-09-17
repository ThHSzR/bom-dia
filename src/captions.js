import { createHash } from 'node:crypto';
import path from 'node:path';
import { ROOT, readJSON, chooseGif } from './core.js';

export function parseCaptions(values) {
  if (!Array.isArray(values) || !values.length) throw Error('A lista de frases deve conter pelo menos uma frase.');
  const unique = new Map();
  for (const value of values) {
    if (typeof value !== 'string') throw Error('Cada frase deve ser um texto.');
    const text = value.normalize('NFC').replace(/\r\n?/g, '\n').trim()
      .split('\n').map(line => line.trim()).join('\n');
    const [greeting, ...body] = text.split('\n');
    if (!/^(?:bom\s*dia+|bodia+|buntinha)\b/iu.test(greeting) || !body.join('\n').trim() || text.length > 1000)
      throw Error('Cada frase precisa comecar com Bom dia, Bomdia, Bodia ou Buntinha, seguida de quebra de linha e mensagem (ate 1000 caracteres).');
    const hash = createHash('sha256').update(text).digest('hex');
    unique.set(hash, { text, hash });
  }
  return [...unique.values()];
}

export async function loadCaptions(config) {
  if (config.captionMode === 'fixed') return [];
  let values;
  try { values = await readJSON(path.join(ROOT, 'captions.local.json')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    values = await readJSON(path.join(ROOT, 'captions.json'));
  }
  return parseCaptions(values);
}

export function chooseCaption(captions, state, config, pick) {
  if (config.captionMode === 'fixed') return { text: config.caption, fixed: true };
  const rotation = state.captionRotation ?? { cycle: 1, used: [], lastHash: null };
  const selected = chooseGif(captions, rotation, pick);
  return { ...selected.gif, reset: selected.reset, fixed: false };
}
