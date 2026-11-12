const API = 'https://api.github.com';
const RAW = 'application/vnd.github.raw+json';
const encodePath = path => path.map(encodeURIComponent).join('/');

export function parseSource(input) {
  let url;
  let parts;
  try {
    url = new URL(input);
    parts = url.pathname.slice(1).split('/').map(decodeURIComponent);
  } catch {
    throw new Error('Enter a GitHub link to a .canvas file.');
  }
  const [owner, repository] = parts.splice(0, 2);
  const validRepositoryPart = part => part && /^[\w.-]+$/.test(part) && part !== '.' && part !== '..';
  const web = url.origin === 'https://github.com';
  if (url.username || url.password || !validRepositoryPart(owner) || !validRepositoryPart(repository) ||
      (web ? !['blob', 'raw'].includes(parts.shift()) : url.origin !== 'https://raw.githubusercontent.com')) {
    throw new Error('Enter a GitHub file link or a raw.githubusercontent.com link.');
  }
  if (parts.length < 2 || !/\.canvas$/i.test(parts.at(-1)) ||
      parts.some(part => !part || part.split('/').some(piece => !piece || piece === '.' || piece === '..') ||
        /[\\\u0000-\u001f\u007f]/.test(part))) {
    throw new Error('The GitHub link must point to a .canvas file.');
  }

  url.search = '';
  url.hash = '';
  const namespace = parts[0] === 'refs' && ['heads', 'tags'].includes(parts[1]) ? parts.splice(0, 2).join('/') : '';
  if (parts.length < 2) throw new Error('The GitHub link must contain a revision and a file path.');
  return { owner, repository, namespace, parts, url: url.href };
}

export function vaultPath(value, allowRoot = false) {
  if (allowRoot && value === '') return [];
  const parts = value.split('/');
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || /[\\\u0000-\u001f\u007f]/.test(value) ||
      parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error('Use a path relative to the vault root.');
  }
  return parts;
}

export class GitHubError extends Error {
  constructor(response, token) {
    const messages = {
      401: 'GitHub rejected the token. Replace it and try again.',
      403: response.headers.get('x-ratelimit-remaining') === '0'
        ? 'GitHub’s API rate limit was reached. Add a token or try again later.'
        : 'GitHub denied access. Check the token’s repository permissions.',
      404: token ? 'GitHub could not find the file or the token does not have access.'
        : 'GitHub could not find the file. Add a token if it is in a private repository.',
      429: 'GitHub is rate limiting requests. Try again later.',
    };
    super(messages[response.status] || 'GitHub returned HTTP ' + response.status + '.');
    this.status = response.status;
  }
}

export function githubRepository(source, token, signal) {
  const base = API + '/repos/' + encodePath([source.owner, source.repository]);
  async function request(path, accept = 'application/vnd.github+json') {
    const headers = { Accept: accept };
    if (token) headers.Authorization = 'Bearer ' + token;
    let response;
    try {
      response = await fetch(base + path, {
        headers, signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error('Could not connect to the GitHub API.');
    }
    if (!response.ok) throw new GitHubError(response, token);
    return response;
  }

  function file(commit, path) {
    return request('/contents/' + encodePath(path) + '?ref=' + encodeURIComponent(commit), RAW);
  }

  async function openCanvas() {
    const { parts, namespace } = source;
    // GitHub leaves slashes in refs unescaped in some links. Check each possible split.
    let notFound;
    for (let split = 1; split < parts.length; split++) {
      const revision = parts.slice(0, split).join('/');
      const path = parts.slice(split);
      if (path.some(part => part.includes('/'))) continue;
      const ref = namespace ? namespace + '/' + revision : revision;
      let sha;
      try {
        const response = await request('/commits/' + encodeURIComponent(ref), 'application/vnd.github.sha');
        sha = (await response.text()).trim();
      } catch (error) {
        if (!(error instanceof GitHubError) || ![404, 422].includes(error.status)) throw error;
        if (error.status === 404) notFound ??= error;
      }
      if (sha !== undefined) {
        if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('GitHub did not return a valid commit.');
        try {
          return { response: await file(sha, path), sha, revision, path };
        } catch (error) {
          if (!(error instanceof GitHubError) || error.status !== 404) throw error;
          notFound = error;
        }
      }
      // An encoded slash in the first segment marks the whole ref explicitly.
      if (parts[0].includes('/')) break;
    }
    throw notFound || new Error('GitHub could not resolve the branch, tag or commit in this link.');
  }

  return { openCanvas, file };
}
