export function renderCanvas(canvas, images, metadata, signal) {
  const byId = id => document.getElementById(id);
  const svg = byId('canvas');
  const scene = byId('scene');
  const defs = svg.querySelector('defs');
  const groups = canvas.nodes.filter(node => node.type === 'group');
  const nodes = new Map(canvas.nodes.map(node => [node.id, node]));
  const palette = { 1: '#d66a7e', 2: '#d58b59', 3: '#baab59', 4: '#77ad87', 5: '#71aabc', 6: '#a190cc' };
  const nodeColor = value => palette[value] || value;
  const listen = (target, type, handler, options) => target.addEventListener(type, handler, { ...options, signal });
  const initialDefs = [...defs.children];
  const app = byId('viewer');
  const imageDialog = byId('image-dialog');
  let camera = { x: 0, y: 0, width: 1200, height: 700 };
  let drag = null;
  const touches = new Map();
  let pinch = null;
  let selectedNode = null;
  const minScale = 0.015;
  const maxScale = 4;

  function element(tag, attributes = {}, text) {
    const result = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, value);
    if (text !== undefined) result.textContent = text;
    return result;
  }

  function foreignBox(node, text, extraClass = '') {
    const foreign = element('foreignObject', { x: node.x, y: node.y, width: node.width, height: node.height });
    const content = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
    content.className = 'note ' + extraClass;
    content.textContent = text;
    foreign.append(content);
    return { foreign, content };
  }

  function imageSource(filename) {
    return images.get(filename)?.url;
  }

  function clip(node, id) {
    const path = element('clipPath', { id });
    path.append(element('rect', { x: node.x, y: node.y, width: node.width, height: node.height, rx: 5 }));
    defs.append(path);
    return `url(#${id})`;
  }

  function renderGroup(node, index) {
    const group = element('g', { 'data-node-id': node.id, class: 'group-node' });
    const attributes = { x: node.x, y: node.y, width: node.width, height: node.height, rx: 10, class: 'group-rect' };
    const frame = element('rect', attributes);
    if (node.color) {
      frame.style.fill = nodeColor(node.color);
      frame.style.fillOpacity = '.07';
      frame.style.stroke = nodeColor(node.color);
      frame.style.strokeOpacity = '.3';
    }
    group.append(frame);
    const source = imageSource(node.background);
    if (source) {
      if (node.backgroundStyle === 'repeat') {
        const pattern = element('pattern', { id: 'background-' + index, x: node.x, y: node.y, width: 256, height: 256, patternUnits: 'userSpaceOnUse' });
        const tile = element('image', { href: source, width: 256, height: 256 });
        pattern.append(tile);
        defs.append(pattern);
        group.append(element('rect', { x: node.x, y: node.y, width: node.width, height: node.height, fill: `url(#background-${index})`, 'clip-path': clip(node, 'group-clip-' + index), opacity: .25 }));
        const image = new Image();
        image.onload = () => {
          pattern.setAttribute('width', image.naturalWidth);
          pattern.setAttribute('height', image.naturalHeight);
          tile.setAttribute('width', image.naturalWidth);
          tile.setAttribute('height', image.naturalHeight);
        };
        image.src = source;
      } else {
        group.append(element('image', { href: source, x: node.x, y: node.y, width: node.width, height: node.height, preserveAspectRatio: node.backgroundStyle === 'ratio' ? 'xMidYMid meet' : 'xMidYMid slice', 'clip-path': clip(node, 'group-clip-' + index), opacity: .25 }));
      }
    }
    group.append(element('text', { x: node.x + 2, y: node.y - 15, class: 'group-label' }, node.label));
    if (node.background && images.get(node.background)?.error) group.append(element('title', {}, images.get(node.background).error));
    return group;
  }

  function openImage(node) {
    const source = imageSource(node.file);
    if (!source) return;
    const image = byId('full-image');
    byId('image-title').textContent = node.file.split('/').pop();
    byId('image-size').textContent = '';
    image.onload = () => { byId('image-size').textContent = `${image.naturalWidth} × ${image.naturalHeight} px · original size`; };
    image.alt = node.file;
    image.src = source;
    imageDialog.showModal();
  }

  function renderNode(node, index) {
    if (node.type === 'group') return renderGroup(node, index);
    const group = element('g', { 'data-node-id': node.id, class: 'node ' + (node.type === 'file' ? 'file-node' : '') });
    const frame = element('rect', { x: node.x, y: node.y, width: node.width, height: node.height, rx: 5, class: 'node-frame' });
    if (node.color) frame.style.stroke = nodeColor(node.color);
    group.append(frame);
    if (node.type === 'file') {
      const title = node.file.split('/').pop().replace(/\.[^.]+$/, '');
      group.append(element('text', { x: node.x + 1, y: node.y - 11, class: 'node-label' }, title));
      const source = imageSource(node.file);
      if (source) {
        group.append(element('image', { href: source, x: node.x, y: node.y, width: node.width, height: node.height, preserveAspectRatio: 'xMidYMin meet', 'clip-path': clip(node, 'clip-' + index) }));
        group.setAttribute('tabindex', '0');
        group.setAttribute('role', 'button');
        group.setAttribute('aria-label', 'Open image: ' + title);
        group.addEventListener('dblclick', event => { event.stopPropagation(); openImage(node); });
        group.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            openImage(node);
          }
        });
      } else {
        frame.setAttribute('class', 'missing-frame');
        const { foreign } = foreignBox(node, 'Image unavailable\n\n' + node.file + '\n\n' + (images.get(node.file)?.error || 'File not found'), 'missing-note');
        group.append(foreign);
      }
      group.addEventListener('click', () => { selectedNode = node; });
    } else if (node.type === 'text') {
      group.append(foreignBox(node, node.text).foreign);
    } else if (node.type === 'link') {
      const { foreign, content } = foreignBox(node, '', 'link-note');
      let safeUrl;
      try { const parsed = new URL(node.url); if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) safeUrl = parsed.href; } catch { /* unsupported link */ }
      if (safeUrl) {
        const anchor = document.createElement('a');
        anchor.href = safeUrl;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.textContent = node.url;
        anchor.addEventListener('pointerdown', event => event.stopPropagation());
        content.append(anchor);
      } else {
        content.append(document.createTextNode('\n' + node.url + '\nUnsupported URL'));
      }
      group.append(foreign);
    }
    return group;
  }

  const normals = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
  function endpoint(node, side) {
    return { top: [node.x + node.width / 2, node.y], right: [node.x + node.width, node.y + node.height / 2], bottom: [node.x + node.width / 2, node.y + node.height], left: [node.x, node.y + node.height / 2] }[side];
  }

  function renderEdge(edge) {
    const a = endpoint(nodes.get(edge.fromNode), edge.fromSide);
    const b = endpoint(nodes.get(edge.toNode), edge.toSide);
    const length = Math.max(55, Math.min(240, Math.hypot(b[0] - a[0], b[1] - a[1]) * .45));
    const na = normals[edge.fromSide], nb = normals[edge.toSide];
    const ca = [a[0] + na[0] * length, a[1] + na[1] * length];
    const cb = [b[0] + nb[0] * length, b[1] + nb[1] * length];
    const group = element('g', { 'data-edge-id': edge.id });
    const path = element('path', { d: `M${a} C${ca} ${cb} ${b}`, class: 'edge' });
    if (edge.color) path.style.stroke = nodeColor(edge.color);
    if (edge.fromEnd === 'arrow') path.setAttribute('marker-start', 'url(#arrow)');
    if (edge.toEnd === 'arrow') path.setAttribute('marker-end', 'url(#arrow)');
    group.append(path);
    if (edge.label) {
      const x = a[0] * .125 + ca[0] * .375 + cb[0] * .375 + b[0] * .125;
      const y = a[1] * .125 + ca[1] * .375 + cb[1] * .375 + b[1] * .125;
      group.append(element('text', { x, y: y - 10, class: 'edge-label' }, edge.label));
    }
    return group;
  }

  // Keep JSON Canvas's specified z order for nodes; edges sit behind cards.
  canvas.edges.forEach(edge => scene.append(renderEdge(edge)));
  canvas.nodes.forEach((node, index) => scene.append(renderNode(node, index)));

  function updateCamera() {
    svg.setAttribute('viewBox', `${camera.x} ${camera.y} ${camera.width} ${camera.height}`);
    const grid = byId('grid-area');
    for (const [key, value] of Object.entries({ x: camera.x, y: camera.y, width: camera.width, height: camera.height })) grid.setAttribute(key, value);
    byId('zoom-value').textContent = Math.round(svg.clientWidth / camera.width * 100) + '%';
  }

  function setActive(group) {
    byId('focus-name').textContent = group ? group.label || 'Group' : 'Entire canvas';
    for (const button of byId('scenario-list').children) {
      const active = group ? button.dataset.groupId === group.id : !button.dataset.groupId;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  function fit(group = null) {
    const items = group ? [group] : canvas.nodes;
    setActive(group);
    if (!items.length) return;
    const minX = Math.min(...items.map(n => n.x)) - 65;
    const minY = Math.min(...items.map(n => n.y)) - 80;
    const maxX = Math.max(...items.map(n => n.x + n.width)) + 65;
    const maxY = Math.max(...items.map(n => n.y + n.height)) + 70;
    const availableWidth = svg.clientWidth || 1000, availableHeight = svg.clientHeight || 700;
    const scale = Math.max(minScale, Math.min(maxScale, availableWidth / (maxX - minX), availableHeight / (maxY - minY)));
    camera.width = availableWidth / scale;
    camera.height = availableHeight / scale;
    camera.x = (minX + maxX - camera.width) / 2;
    camera.y = (minY + maxY - camera.height) / 2;
    updateCamera();
  }

  function zoom(factor, screenX = svg.clientWidth / 2, screenY = svg.clientHeight / 2) {
    const scale = svg.clientWidth / camera.width;
    const nextScale = Math.max(minScale, Math.min(maxScale, scale * factor));
    const actual = nextScale / scale;
    const fx = screenX / svg.clientWidth, fy = screenY / svg.clientHeight;
    camera.x += camera.width * fx * (1 - 1 / actual);
    camera.y += camera.height * fy * (1 - 1 / actual);
    camera.width /= actual;
    camera.height /= actual;
    updateCamera();
  }

  function addScenario(label, group = null) {
    const button = document.createElement('button');
    button.className = 'scenario';
    if (group) button.dataset.groupId = group.id;
    const icon = document.createElement('span');
    icon.className = 'scenario-icon';
    icon.setAttribute('aria-hidden', 'true');
    if (group?.color) icon.style.color = nodeColor(group.color);
    const name = document.createElement('span');
    name.className = 'scenario-name';
    name.textContent = label;
    button.append(icon, name);
    button.addEventListener('click', () => {
      fit(group);
      app.classList.remove('sidebar-open');
      byId('toggle-sidebar').setAttribute('aria-expanded', 'false');
    });
    byId('scenario-list').append(button);
  }

  addScenario('Entire canvas');
  groups.forEach(group => addScenario(group.label || 'Group', group));
  byId('revision').textContent = [metadata.revision, metadata.sha.slice(0, 12)].join(' · ');
  const warnings = [...images.values()].filter(image => image.error).length;
  byId('warnings').hidden = warnings === 0;
  byId('warnings').textContent = 'Unavailable attachments: ' + warnings;
  byId('empty-state').hidden = canvas.nodes.length > 0;
  byId('zoom-in').onclick = () => zoom(1.25);
  byId('zoom-out').onclick = () => zoom(1 / 1.25);
  byId('fit').onclick = () => fit();
  const expandButton = byId('expand-view');
  function updateExpandButton() {
    const active = !!document.fullscreenElement;
    byId('expand-label').textContent = active ? 'Exit fullscreen' : 'Fullscreen';
    expandButton.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Fullscreen');
    expandButton.setAttribute('aria-pressed', String(active));
    expandButton.disabled = !document.fullscreenEnabled;
    expandButton.title = document.fullscreenEnabled ? 'Fullscreen · Esc to exit' : 'Use your browser’s fullscreen mode';
  }
  updateExpandButton();
  listen(document, 'fullscreenchange', updateExpandButton);
  listen(document, 'keydown', event => {
    if (event.key === 'Escape' && document.fullscreenElement && !byId('image-dialog').open) {
      event.preventDefault();
      document.exitFullscreen().catch(() => {});
    }
  });
  expandButton.onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      expandButton.title = 'Use your browser’s fullscreen mode';
    }
  };
  byId('toggle-sidebar').onclick = () => {
    const open = app.classList.toggle('sidebar-open');
    byId('toggle-sidebar').setAttribute('aria-expanded', String(open));
  };
  byId('close-dialog').onclick = () => byId('image-dialog').close();
  listen(imageDialog, 'click', event => { if (event.target === event.currentTarget) event.currentTarget.close(); });
  listen(svg, 'wheel', event => {
    event.preventDefault();
    const bounds = svg.getBoundingClientRect();
    zoom(Math.exp(-Math.max(-200, Math.min(200, event.deltaY)) * .003), event.clientX - bounds.left, event.clientY - bounds.top);
  }, { passive: false });
  function beginPinch() {
    const [a, b] = [...touches.values()];
    pinch = { distance: Math.hypot(b.x - a.x, b.y - a.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    drag = null;
  }
  listen(svg, 'pointerdown', event => {
    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      svg.setPointerCapture(event.pointerId);
      if (touches.size === 2) beginPinch();
      else if (touches.size === 1) drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, camera: { ...camera } };
      return;
    }
    if (event.button !== 0 || event.target.closest('foreignObject')) return;
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, camera: { ...camera } };
  });
  listen(svg, 'pointermove', event => {
    if (touches.has(event.pointerId)) {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size >= 2 && pinch) {
        const [a, b] = [...touches.values()];
        const distance = Math.hypot(b.x - a.x, b.y - a.y);
        const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
        const bounds = svg.getBoundingClientRect();
        camera.x -= (x - pinch.x) * camera.width / svg.clientWidth;
        camera.y -= (y - pinch.y) * camera.height / svg.clientHeight;
        if (pinch.distance > 0 && distance > 0) zoom(distance / pinch.distance, x - bounds.left, y - bounds.top);
        else updateCamera();
        pinch = { distance, x, y };
        return;
      }
    }
    if (!drag || drag.pointer !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 3) {
      if (!svg.hasPointerCapture(event.pointerId)) svg.setPointerCapture(event.pointerId);
      svg.classList.add('is-dragging');
    }
    camera.x = drag.camera.x - (event.clientX - drag.x) * camera.width / svg.clientWidth;
    camera.y = drag.camera.y - (event.clientY - drag.y) * camera.height / svg.clientHeight;
    updateCamera();
  });
  function endDrag(event) {
    if (touches.delete(event.pointerId)) {
      pinch = null;
      if (touches.size >= 2) beginPinch();
      else if (touches.size === 1) {
        const [pointer, point] = touches.entries().next().value;
        drag = { pointer, x: point.x, y: point.y, camera: { ...camera } };
      } else drag = null;
    } else if (drag?.pointer === event.pointerId) drag = null;
    svg.classList.remove('is-dragging');
  }
  listen(svg, 'pointerup', endDrag);
  listen(svg, 'pointercancel', endDrag);
  listen(svg, 'lostpointercapture', endDrag);
  listen(svg, 'keydown', event => {
    if (event.target !== svg) return;
    if (['+', '=', '-', '0', 'f', 'F', 'Enter'].includes(event.key)) event.preventDefault();
    if (['+', '='].includes(event.key)) zoom(1.25);
    if (event.key === '-') zoom(1 / 1.25);
    if (['0', 'f', 'F'].includes(event.key)) fit();
    if (event.key === 'Enter' && selectedNode) openImage(selectedNode);
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      camera.x += ({ ArrowLeft: -1, ArrowRight: 1 }[event.key] || 0) * camera.width * .08;
      camera.y += ({ ArrowUp: -1, ArrowDown: 1 }[event.key] || 0) * camera.height * .08;
      updateCamera();
    }
  });
  let lastWidth = svg.clientWidth, lastHeight = svg.clientHeight;
  const resize = new ResizeObserver(() => {
    if (!svg.clientWidth || !svg.clientHeight) return;
    if (lastWidth && lastHeight) {
      const scale = lastWidth / camera.width;
      camera.width = svg.clientWidth / scale;
      camera.height = svg.clientHeight / scale;
    }
    lastWidth = svg.clientWidth; lastHeight = svg.clientHeight;
    updateCamera();
  });
  resize.observe(svg);
  signal.addEventListener('abort', () => {
    resize.disconnect();
    scene.replaceChildren();
    defs.replaceChildren(...initialDefs);
    byId('scenario-list').replaceChildren();
    imageDialog.close();
    byId('full-image').removeAttribute('src');
    app.classList.remove('sidebar-open');
    byId('toggle-sidebar').setAttribute('aria-expanded', 'false');
    svg.classList.remove('is-dragging');
  }, { once: true });
  fit();
  if (!canvas.nodes.length) updateCamera();
}
