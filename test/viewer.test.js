import assert from 'node:assert/strict';
import test from 'node:test';
import { loadImages, parseCanvas, readBytes } from '../docs/canvas.js';
import { githubRepository, parseSource, vaultPath } from '../docs/github.js';

const sha = '1'.repeat(40);
const node = { x: 0, y: 0, width: 100, height: 100 };

test('source URLs accept GitHub blob/raw links and strip signing parameters', () => {
  const source = parseSource('https://github.com/owner/repo/blob/main/nested/M%C3%A1p.canvas?token=secret#fragment');
  assert.deepEqual(source.parts, ['main', 'nested', 'Máp.canvas']);
  assert.equal(source.url, 'https://github.com/owner/repo/blob/main/nested/M%C3%A1p.canvas');
  assert.equal(parseSource('https://raw.githubusercontent.com/owner/repo/refs/heads/main/m.canvas').namespace, 'refs/heads');
  assert.deepEqual(parseSource('https://github.com/owner/repo/raw/feature%2Fdemo/m.canvas').parts, ['feature/demo', 'm.canvas']);

  for (const url of [
    'https://github.com.example.org/owner/repo/blob/main/board.canvas',
    'https://x:y@github.com/owner/repo/blob/main/board.canvas',
    'https://github.com/owner/repo/blob/main/note.md',
    'https://github.com/owner/repo/blob/main/%2e%2e%2fother.canvas',
  ]) assert.throws(() => parseSource(url));
});

test('vault paths stay inside the vault', () => {
  assert.deepEqual(vaultPath('', true), []);
  assert.deepEqual(vaultPath('Vault/Screens'), ['Vault', 'Screens']);
  assert.deepEqual(vaultPath('images/Первый экран 100%.png'), ['images', 'Первый экран 100%.png']);
  for (const path of ['/image.png', '../image.png', 'a/../../image.png', 'a\\image.png', 'https://example.com/image.png']) {
    assert.throws(() => vaultPath(path));
  }
});

test('a slash in a branch is resolved and canvas and image requests use the same commit', async context => {
  const calls = [];
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    const address = new URL(url);
    calls.push([address.pathname, address.searchParams.get('ref')]);
    assert.equal(address.origin, 'https://api.github.com');
    assert.equal(options.headers.Authorization, 'Bearer fixture_token');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    if (address.pathname.endsWith('/commits/feature')) return new Response(null, { status: 422 });
    if (address.pathname.endsWith('/commits/feature%2Fdemo')) {
      assert.equal(options.headers.Accept, 'application/vnd.github.sha');
      return new Response(sha);
    }
    assert.equal(options.headers.Accept, 'application/vnd.github.raw+json');
    return new Response('{}');
  });
  const source = parseSource('https://github.com/owner/repo/blob/feature/demo/nested/board.canvas');
  const repository = githubRepository(source, 'fixture_token', new AbortController().signal);
  const result = await repository.openCanvas();
  assert.equal(result.sha, sha);
  assert.deepEqual(result.path, ['nested', 'board.canvas']);
  await repository.file(result.sha, vaultPath('images/100%.png'));
  assert.deepEqual(calls, [
    ['/repos/owner/repo/commits/feature', null],
    ['/repos/owner/repo/commits/feature%2Fdemo', null],
    ['/repos/owner/repo/contents/nested/board.canvas', sha],
    ['/repos/owner/repo/contents/images/100%25.png', sha],
  ]);
});

test('canvas reads optional fields and rejects an edge to an unknown node', async () => {
  assert.deepEqual(await parseCanvas(new Response('{}')), { nodes: [], edges: [] });
  const nodes = [
    { ...node, id: 'a', type: 'group' },
    { ...node, id: 'b', type: 'text', text: '<script>text</script>' },
  ];
  const edge = { id: 'e', fromNode: 'a', toNode: 'b' };
  const canvas = await parseCanvas(new Response(JSON.stringify({ nodes, edges: [edge] })));
  assert.equal(canvas.nodes[1].text, '<script>text</script>');
  assert.equal(canvas.edges[0].toEnd, 'arrow');
  assert.equal(canvas.edges[0].fromSide, 'right');
  edge.toNode = 'missing';
  await assert.rejects(parseCanvas(new Response(JSON.stringify({ nodes, edges: [edge] }))), /invalid edge/);
});

test('oversized downloads are stopped even without a Content-Length header', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(9)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readBytes(new Response(stream), 8, 'too large'), /too large/);
  assert.equal(cancelled, true);
});

test('an unavailable or unsafe attachment does not hide the canvas', async () => {
  const calls = [];
  const repository = {
    async file(commit, path) {
      calls.push([commit, path]);
      throw new Error('Missing file');
    },
  };
  const nodes = [
    { type: 'file', file: 'images/absent.png' },
    { type: 'file', file: 'images/absent.png' },
    { type: 'file', file: '../bad.png' },
    { type: 'file', file: 'image.svg' },
  ];
  const images = await loadImages({ nodes }, ['vault'], repository, sha, new AbortController().signal, () => {});
  assert.deepEqual(calls, [[sha, ['vault', 'images', 'absent.png']]]);
  assert.equal(images.size, 3);
  assert.equal(images.get('images/absent.png').error, 'Missing file');
  assert.match(images.get('../bad.png').error, /vault root/);
  assert.match(images.get('image.svg').error, /unsupported/);
});
