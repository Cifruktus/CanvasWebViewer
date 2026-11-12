import { parseCanvas, loadImages } from './canvas.js';
import { githubRepository, GitHubError, parseSource, vaultPath } from './github.js';
import { renderCanvas } from './viewer.js';

const byId = id => document.getElementById(id);
const tokenKey = 'canvaswebviewer.github.pat';
const tokenDialog = byId('token-dialog');
const tokenInput = byId('token');
const sourceDialog = byId('source-dialog');
const sourceForm = byId('source-form');
const sourceInput = byId('source-url');
const rootInput = byId('vault-root');
let token = '';
try {
  token = localStorage.getItem(tokenKey) || '';
} catch {
  // Opening public files also works when browser storage is unavailable.
}
let current;
let controller;
let noticeTimer;

const theme = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  document.documentElement.dataset.theme = theme.matches ? 'dark' : 'light';
}
theme.addEventListener('change', applyTheme);
applyTheme();

function showMessage(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function loadStatus(message) {
  showMessage(byId('status'), message);
}

function notice(message) {
  clearTimeout(noticeTimer);
  showMessage(byId('notice'), message);
  noticeTimer = setTimeout(() => showMessage(byId('notice'), ''), 2600);
}

function viewerUrl(source, root) {
  const address = new URL(location.pathname, location.origin);
  address.searchParams.set('src', source.url);
  if (root) address.searchParams.set('vaultRoot', root);
  return address;
}

async function loadCanvas(source, root) {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  current = { source, root };
  sourceInput.value = source.url;
  rootInput.value = root;
  byId('source-options').open = Boolean(root);
  byId('workspace').hidden = true;
  byId('landing').hidden = false;
  byId('open-source').hidden = true;
  byId('copy-link').hidden = true;
  byId('load-error').hidden = true;
  document.title = 'CanvasWebViewer';
  loadStatus('Loading canvas…');
  try {
    const repository = githubRepository(source, token, signal);
    const metadata = await repository.openCanvas();
    const canvas = await parseCanvas(metadata.response);
    signal.throwIfAborted();
    const images = await loadImages(canvas, vaultPath(root, true), repository, metadata.sha, signal, (loaded, total) => {
      loadStatus('Loading attachments… ' + loaded + ' / ' + total);
    });
    signal.throwIfAborted();

    const path = metadata.path.map(encodeURIComponent).join('/');
    const repo = [source.owner, source.repository].map(encodeURIComponent).join('/');
    byId('original-file').href = ['https://github.com', repo, 'blob', metadata.sha, path].join('/');
    document.title = metadata.path.at(-1) + ' · CanvasWebViewer';
    loadStatus('');
    byId('landing').hidden = true;
    byId('workspace').hidden = false;
    renderCanvas(canvas, images, metadata, signal);
    byId('open-source').hidden = false;
    byId('copy-link').hidden = false;
  } catch (error) {
    if (signal.aborted) return;
    controller.abort();
    byId('workspace').hidden = true;
    byId('landing').hidden = false;
    loadStatus('');
    byId('error-message').textContent = error.message;
    byId('load-error').hidden = false;
    byId('error-token').hidden = !(error instanceof GitHubError && [401, 403, 404].includes(error.status));
  }
}

function loadAddress() {
  const query = new URLSearchParams(location.search);
  if (!query.has('src')) {
    controller?.abort();
    current = undefined;
    document.title = 'CanvasWebViewer';
    byId('workspace').hidden = true;
    byId('landing').hidden = false;
    byId('open-source').hidden = true;
    byId('copy-link').hidden = true;
    byId('load-error').hidden = true;
    sourceInput.value = '';
    rootInput.value = '';
    byId('source-options').open = false;
    showMessage(byId('source-error'), '');
    loadStatus('');
    return;
  }
  sourceInput.value = query.get('src');
  rootInput.value = query.get('vaultRoot') || '';
  try {
    const source = parseSource(sourceInput.value);
    const root = rootInput.value;
    vaultPath(root, true);
    history.replaceState(null, '', viewerUrl(source, root));
    showMessage(byId('source-error'), '');
    loadCanvas(source, root);
  } catch (error) {
    controller?.abort();
    current = undefined;
    byId('workspace').hidden = true;
    byId('landing').hidden = false;
    byId('open-source').hidden = true;
    byId('copy-link').hidden = true;
    byId('load-error').hidden = true;
    loadStatus('');
    showMessage(byId('source-error'), error.message);
    byId('source-options').open = Boolean(rootInput.value);
  }
}

sourceForm.addEventListener('submit', event => {
  event.preventDefault();
  const root = rootInput.value.trim();
  try {
    const source = parseSource(sourceInput.value.trim());
    vaultPath(root, true);
    showMessage(byId('source-error'), '');
    if (sourceDialog.open) sourceDialog.close();
    byId('source-home').append(sourceForm);
    const address = viewerUrl(source, root);
    if (address.href !== location.href) history.pushState(null, '', address);
    loadCanvas(source, root);
  } catch (error) {
    showMessage(byId('source-error'), error.message);
  }
});
byId('open-source').addEventListener('click', () => {
  sourceInput.value = current.source.url;
  rootInput.value = current.root;
  showMessage(byId('source-error'), '');
  byId('source-modal').append(sourceForm);
  sourceDialog.showModal();
  sourceInput.focus();
  sourceInput.select();
});
sourceDialog.addEventListener('close', () => byId('source-home').append(sourceForm));

function openToken() {
  tokenInput.value = '';
  showMessage(byId('token-error'), '');
  showMessage(byId('token-status'), token ? 'A token is saved. Enter a new one to replace it.' : '');
  byId('remove-token').hidden = !token;
  tokenDialog.showModal();
  tokenInput.focus();
}
function updateToken(value) {
  try {
    if (value) localStorage.setItem(tokenKey, value);
    else localStorage.removeItem(tokenKey);
  } catch {
    showMessage(byId('token-error'), 'This browser blocked access to token storage.');
    return;
  }
  token = value;
  tokenDialog.close();
  notice(value ? 'GitHub token saved.' : 'Saved token removed.');
  if (current) loadCanvas(current.source, current.root);
}
byId('open-token').addEventListener('click', openToken);
byId('error-token').addEventListener('click', openToken);
byId('token-form').addEventListener('submit', event => {
  event.preventDefault();
  const value = tokenInput.value.trim();
  if (!/^[\w]{1,1024}$/.test(value)) {
    showMessage(byId('token-error'), 'Paste a GitHub personal access token.');
    return;
  }
  updateToken(value);
});
tokenDialog.addEventListener('close', () => { tokenInput.value = ''; });
byId('remove-token').addEventListener('click', () => updateToken(''));

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => button.closest('dialog').close());
}

byId('copy-link').addEventListener('click', async () => {
  const url = viewerUrl(current.source, current.root).href;
  try {
    await navigator.clipboard.writeText(url);
    notice('Viewer link copied.');
  } catch {
    window.prompt('Copy this viewer link', url);
  }
});
window.addEventListener('popstate', loadAddress);
window.addEventListener('storage', event => {
  if (event.storageArea !== localStorage || (event.key !== tokenKey && event.key !== null)) return;
  const value = localStorage.getItem(tokenKey) || '';
  if (value === token) return;
  token = value;
  if (tokenDialog.open) tokenDialog.close();
  if (sourceDialog.open) sourceDialog.close();
  if (current) loadCanvas(current.source, current.root);
});
loadAddress();
