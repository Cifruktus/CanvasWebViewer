import { vaultPath } from './github.js';

const MiB = 1024 * 1024;

export async function readBytes(response, limit, tooLarge) {
  if (Number(response.headers.get('Content-Length')) > limit) {
    await response.body.cancel();
    throw new Error(tooLarge);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error(tooLarge);
      }
      chunks.push(value);
    }
    return new Blob(chunks);
  } finally {
    reader.releaseLock();
  }
}

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const hasText = (value, length) => typeof value === 'string' && value.length <= length;
const hasColor = value => value == null || (typeof value === 'string' && /^(?:[1-6]|#[a-f\d]{6})$/i.test(value));
const hasId = value => hasText(value, 256) && value.length > 0;
const nodeText = { text: 'text', file: 'file', link: 'url' };
const sides = ['top', 'right', 'bottom', 'left'];
const ends = ['none', 'arrow'];

export async function parseCanvas(response) {
  const bytes = await readBytes(response, 2 * MiB, 'The canvas exceeds 2 MiB.');
  let data;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes.arrayBuffer()));
  } catch {
    throw new Error('The file must contain a JSON Canvas document.');
  }
  if (!object(data)) throw new Error('The file must contain a JSON Canvas document.');
  const { nodes = [], edges = [] } = data;
  if (!Array.isArray(nodes) || nodes.length > 1000 || !Array.isArray(edges) || edges.length > 2000) {
    throw new Error('A canvas can contain up to 1,000 nodes and 2,000 edges.');
  }

  const nodeIds = new Set();
  for (const node of nodes) {
    if (!object(node) || !hasId(node.id) || nodeIds.has(node.id) || !hasColor(node.color) ||
        ![node.x, node.y].every(value => Number.isInteger(value) && Math.abs(value) <= 10_000_000) ||
        ![node.width, node.height].every(value => Number.isInteger(value) && value > 0 && value <= 100_000)) {
      throw new Error('The canvas contains an invalid node.');
    }
    if (node.type === 'group') {
      node.label ??= 'Group';
      node.backgroundStyle ??= 'cover';
      if (!hasText(node.label, 1000) ||
          (node.background != null && !hasText(node.background, 16000)) ||
          !['cover', 'ratio', 'repeat'].includes(node.backgroundStyle)) {
        throw new Error('The canvas contains an invalid group.');
      }
    } else if (typeof node.type !== 'string' || !Object.hasOwn(nodeText, node.type) || !hasText(node[nodeText[node.type]], 16000)) {
      throw new Error('The canvas contains an invalid node type or content.');
    }
    nodeIds.add(node.id);
  }

  const edgeIds = new Set();
  for (const edge of edges) {
    if (!object(edge) || !hasId(edge.id) || edgeIds.has(edge.id) || !hasColor(edge.color) ||
        !nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode)) {
      throw new Error('The canvas contains an invalid edge.');
    }
    edge.fromSide ??= 'right';
    edge.toSide ??= 'left';
    edge.fromEnd ??= 'none';
    edge.toEnd ??= 'arrow';
    if (![edge.fromSide, edge.toSide].every(side => sides.includes(side)) ||
        ![edge.fromEnd, edge.toEnd].every(end => ends.includes(end)) ||
        (edge.label != null && !hasText(edge.label, 1000))) {
      throw new Error('The canvas contains an invalid edge.');
    }
    edgeIds.add(edge.id);
  }

  return { nodes, edges };
}

async function imageType(blob) {
  const signature = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const text = new TextDecoder().decode(signature);
  if (signature[0] === 137 && text.slice(1, 8) === 'PNG\r\n\u001a\n') return 'image/png';
  if (signature[0] === 255 && signature[1] === 216 && signature[2] === 255) return 'image/jpeg';
  if (text.startsWith('GIF87a') || text.startsWith('GIF89a')) return 'image/gif';
  if (text.startsWith('RIFF') && text.slice(8) === 'WEBP') return 'image/webp';
  throw new Error('Expected a PNG, JPEG, GIF or WebP image.');
}

export async function loadImages(canvas, root, repository, sha, signal, progress) {
  const names = [...new Set(canvas.nodes.flatMap(node => {
    if (node.type === 'file') return [node.file];
    if (node.type === 'group' && node.background) return [node.background];
    return [];
  }))];
  const images = new Map();
  let bytesUsed = 0;
  let next = 0;
  let loaded = 0;
  const fetchable = names.slice(0, 256);
  for (const name of names.slice(256)) images.set(name, { error: 'The canvas exceeds 256 attachments.' });

  const workers = Array.from({ length: Math.min(fetchable.length, 6) }, async () => {
    while (next < fetchable.length && !signal.aborted) {
      const name = fetchable[next++];
      try {
        const path = [...root, ...vaultPath(name)];
        if (!/\.(png|jpe?g|gif|webp)$/i.test(name)) throw new Error('This attachment format is unsupported.');
        const response = await repository.file(sha, path);
        const blob = await readBytes(response, 8 * MiB, 'This image exceeds 8 MiB.');
        const type = await imageType(blob);
        const image = blob.slice(0, blob.size, type);
        const bitmap = await createImageBitmap(image).catch(() => {
          throw new Error('The image could not be decoded.');
        });
        const pixels = bitmap.width * bitmap.height;
        bitmap.close();
        if (pixels > 100_000_000) throw new Error('This image exceeds 100 megapixels.');
        signal.throwIfAborted();
        if (bytesUsed + blob.size > 32 * MiB) throw new Error('The canvas exceeds 32 MiB of images.');
        bytesUsed += blob.size;
        const url = URL.createObjectURL(image);
        signal.addEventListener('abort', () => URL.revokeObjectURL(url), { once: true });
        images.set(name, { url });
      } catch (error) {
        if (!signal.aborted) images.set(name, { error: error.message });
      }
      if (!signal.aborted) progress(++loaded, fetchable.length);
    }
  });
  await Promise.all(workers);
  signal.throwIfAborted();
  return images;
}
