// Page wiring: controls, Cytoscape drawing, and the verse panel.
(function () {
  const T = window.VerseText;
  const G = window.VerseGraph;
  const $ = id => document.getElementById(id);

  const state = {
    centerId: -1,
    userWords: [],
    disabledStems: new Set(),
    volumes: null,
    maxBranches: 12,
    wordLimit: 3,
    labelMode: 'all',
    selectedId: -1,
  };
  let index = null;
  let cy = null;
  let web = null;

  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- start-up ----------
  function init() {
    if (!window.VERSE_DATA) return fail('data/verses.js is missing. Run: python tools/build_data.py');
    if (!window.cytoscape) return fail('Could not load js/vendor/cytoscape.min.js. Check that the file is in the project folder.');
    index = T.buildIndex(window.VERSE_DATA);
    state.volumes = new Set(index.volumes.map((_, i) => i));
    renderVolumes();
    wireControls();
    setupCy();
    $('loading').hidden = true;
    const fromHash = T.findVerse(index, decodeURIComponent(location.hash.slice(1)));
    setCenter(fromHash >= 0 ? fromHash : T.findVerse(index, 'Alma 32:21'), false);
  }

  function fail(msg) {
    $('loading').textContent = msg;
  }

  // ---------- controls ----------
  function renderVolumes() {
    $('volumes').innerHTML = index.volumes.map((v, i) =>
      `<label class="check"><input type="checkbox" data-vol="${i}" checked> ${esc(v)}</label>`).join('');
    $('volumes').addEventListener('change', e => {
      const i = Number(e.target.dataset.vol);
      if (e.target.checked) state.volumes.add(i); else state.volumes.delete(i);
      refresh();
    });
  }

  function wireControls() {
    const input = $('ref-input');
    const list = $('ref-suggest');
    let active = -1;
    const hideList = () => { list.hidden = true; active = -1; };
    let lastSearch = null;
    let timer = 0;

    const runSearch = () => {
      lastSearch = T.search(index, input.value, { volumes: state.volumes, limit: 10 });
      return lastSearch;
    };

    const showList = () => {
      const r = runSearch();
      if (!input.value.trim()) return hideList();
      const stems = new Set(r.stems);
      let html = r.results.map((res, i) => {
        const v = index.verses[res.id];
        const tag = res.kind === 'ref' ? '' : res.phrase ? '<span class="tag">exact phrase</span>' : '';
        return `<li role="option" data-id="${res.id}" aria-selected="${i === active}">
          <span class="ref">${esc(v[0])}</span>${tag}
          <span class="snippet">${snippet(v[3], res.kind === 'ref' ? new Set() : stems)}</span></li>`;
      }).join('');
      // Spelling hints go at the top, where they'll be seen.
      const head = r.unknown.map(u => `"${esc(u.word)}" isn't in the scriptures.` + (u.suggestions.length
        ? ` Try ${u.suggestions.map(s => `<button type="button" class="link" data-swap="${esc(u.word)}" data-word="${esc(s)}">${esc(s)}</button>`).join(', ')}.`
        : ''));
      if (head.length) html = `<li class="foot head" aria-disabled="true">${head.join('<br>')}</li>` + html;
      const foot = [];
      if (r.note) foot.push(esc(r.note));
      if (r.total > r.results.length) foot.push(`${(r.total - r.results.length).toLocaleString()} more matches. Keep typing to narrow them down.`);
      if (foot.length) html += `<li class="foot" aria-disabled="true">${foot.join('<br>')}</li>`;
      list.innerHTML = html;
      list.hidden = false;
    };

    // Short piece of the verse around the first matched word, matches in bold.
    function snippet(text, stems) {
      const toks = T.tokenize(text);
      const first = toks.find(t => t.stem && stems.has(t.stem));
      let from = 0, to = Math.min(text.length, 130);
      if (first && first.start > 60) { from = text.lastIndexOf(' ', first.start - 40) + 1; to = Math.min(text.length, from + 130); }
      let html = from > 0 ? '…' : '', last = from;
      for (const t of toks) {
        if (t.start < from || t.end > to || !t.stem || !stems.has(t.stem)) continue;
        html += esc(text.slice(last, t.start)) + '<b>' + esc(text.slice(t.start, t.end)) + '</b>';
        last = t.end;
      }
      return html + esc(text.slice(last, to)) + (to < text.length ? '…' : '');
    }

    const choose = id => {
      hideList();
      setCenter(id);
      input.blur();
    };

    input.addEventListener('input', () => {
      active = -1;
      clearTimeout(timer);
      timer = setTimeout(showList, 120);
    });
    input.addEventListener('focus', () => { if (input.value.trim() && input.value !== index.verses[state.centerId]?.[0]) showList(); });
    input.addEventListener('keydown', e => {
      const items = [...list.querySelectorAll('li[data-id]')];
      if (e.key === 'Escape') return hideList();
      if (list.hidden || !items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((li, i) => li.setAttribute('aria-selected', i === active));
        items[active].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        choose(Number(items[active].dataset.id));
      }
    });
    list.addEventListener('mousedown', e => {
      e.preventDefault(); // keep focus in the box
      const swap = e.target.closest('[data-swap]');
      if (swap) {
        input.value = input.value.replace(new RegExp(`\\b${swap.dataset.swap}\\b`, 'i'), swap.dataset.word);
        return showList();
      }
      const li = e.target.closest('li[data-id]');
      if (li) choose(Number(li.dataset.id));
    });
    input.addEventListener('blur', () => setTimeout(hideList, 150));

    $('ref-form').addEventListener('submit', e => {
      e.preventDefault();
      clearTimeout(timer);
      const exact = T.findVerse(index, input.value);
      if (exact >= 0) return choose(exact);
      const r = runSearch();
      if (r.results.length) return choose(r.results[0].id);
      showList();
    });
    $('random-btn').addEventListener('click', () => {
      let id;
      do { id = Math.floor(Math.random() * index.verses.length); }
      while (index.stemsByVerse[id].length < 3 || !state.volumes.has(index.verses[id][2]));
      setCenter(id);
    });

    $('kw-form').addEventListener('submit', e => {
      e.preventDefault();
      const words = $('kw-input').value.split(/[\s,]+/).map(w => w.toLowerCase().trim()).filter(Boolean);
      for (const w of words) if (!state.userWords.includes(w)) state.userWords.push(w);
      $('kw-input').value = '';
      refresh();
    });

    $('branch-slider').addEventListener('input', e => {
      state.maxBranches = Number(e.target.value);
      $('branch-count').textContent = state.maxBranches;
    });
    $('branch-slider').addEventListener('change', refresh);
    // 1-10 lines; the far right (11) means no limit (0 for the graph builder).
    const limitText = v => (v > 10 ? 'no limit' : `${v} line${v > 1 ? 's' : ''}`);
    $('limit-slider').addEventListener('input', e => {
      const v = Number(e.target.value);
      state.wordLimit = v > 10 ? 0 : v;
      $('limit-count').textContent = limitText(v);
    });
    $('limit-slider').addEventListener('change', refresh);
    $('label-mode').addEventListener('change', e => { state.labelMode = e.target.value; applyLabelMode(); });

    $('panel-close').addEventListener('click', () => { if (cy) clearHighlight(); closePanel(); });
    $('panel-pair').addEventListener('click', e => {
      const b = e.target.closest('[data-center]');
      if (b) setCenter(Number(b.dataset.center));
    });
    $('panel-center').addEventListener('click', () => { if (state.selectedId >= 0) setCenter(state.selectedId); });

    window.addEventListener('hashchange', () => {
      const id = T.findVerse(index, decodeURIComponent(location.hash.slice(1)));
      if (id >= 0 && id !== state.centerId) setCenter(id, false);
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => cy && cy.style(graphStyle()));
  }

  function setCenter(id, pushHash = true) {
    state.centerId = id;
    state.disabledStems.clear();
    $('ref-input').value = index.verses[id][0];
    if (pushHash) history.replaceState(null, '', '#' + encodeURIComponent(index.verses[id][0]));
    state.selectedId = id; // the panel opens on the new center once the web is built
    $('panel-pair').hidden = true;
    refresh();
  }

  // ---------- keyword chips ----------
  // "on 2 of 3 lines" / "limit reached" / "on 5 lines"
  function lineNote(k) {
    if (!web.wordLimit) return k.uses ? `on ${k.uses} line${k.uses > 1 ? 's' : ''}` : '';
    return k.atLimit ? `limit reached: ${k.uses} of ${web.wordLimit} lines` : `on ${k.uses} of ${web.wordLimit} lines`;
  }

  function renderChips() {
    $('auto-chips').innerHTML = web.keywords.auto.length ? web.keywords.auto.map(k => {
      let cls = 'chip', note = '';
      if (!k.enabled) cls += ' off';
      else if (k.count === 0) { cls += ' muted'; note = 'not in the selected volumes'; }
      else if (!k.shown) { cls += ' warn'; note = 'not shown; show more verses'; }
      else note = lineNote(k);
      return `<button type="button" class="${cls}" data-stem="${esc(k.stem)}" aria-pressed="${k.enabled}"
        title="${k.enabled ? 'Click to stop linking on this word' : 'Click to link on this word again'}">
        <span>${esc(k.label)} <span class="count">${k.count.toLocaleString()}</span></span>
        ${note ? `<span class="note">${note}</span>` : ''}</button>`;
    }).join('') : '<p class="hint">No uncommon words in this verse.</p>';

    $('user-chips').innerHTML = web.keywords.user.map((k, i) => {
      let cls = 'chip', note = '', extra = '', count = '';
      const volNames = k.byVolume ? k.byVolume.map((c, v) => c ? `${c.toLocaleString()} in ${index.volumes[v]}` : '').filter(Boolean).join('; ') : '';
      if (k.status === 'stopword') { cls += ' muted'; note = 'too common to link on'; }
      else if (k.status === 'notfound') {
        cls += ' bad'; note = 'not found in the scriptures';
        if (k.suggestions.length) extra = `<span class="sugg">Did you mean ${k.suggestions.map(s =>
          `<button type="button" data-replace="${i}" data-word="${esc(s)}">${esc(s)}</button>`).join('')}</span>`;
      } else if (k.status === 'novolumes') { cls += ' muted'; note = `0 in selected volumes (${volNames})`; }
      else {
        count = k.inSelected.toLocaleString();
        if (!k.enabled) cls += ' off';
        else if (!k.shown) { cls += ' warn'; note = 'not shown; show more verses'; }
        else note = lineNote(k);
      }
      const title = k.matchedForms && k.matchedForms.length ? `Matches: ${k.matchedForms.join(', ')}` : '';
      return `<span class="${cls}" title="${esc(title)}">
        <span class="row">${esc(k.word)} ${count ? `<span class="count">${count}</span>` : ''}
          <button type="button" class="x" data-remove="${i}" aria-label="Remove ${esc(k.word)}">×</button></span>
        ${note ? `<span class="note">${esc(note)}</span>` : ''}${extra}</span>`;
    }).join('');
  }

  document.addEventListener('click', e => {
    const auto = e.target.closest('#auto-chips .chip');
    if (auto) {
      const s = auto.dataset.stem;
      if (state.disabledStems.has(s)) state.disabledStems.delete(s); else state.disabledStems.add(s);
      return refresh();
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) { state.userWords.splice(Number(rm.dataset.remove), 1); return refresh(); }
    const rep = e.target.closest('[data-replace]');
    if (rep) {
      const i = Number(rep.dataset.replace);
      if (state.userWords.includes(rep.dataset.word)) state.userWords.splice(i, 1);
      else state.userWords[i] = rep.dataset.word;
      return refresh();
    }
  });

  // ---------- graph ----------
  function graphStyle() {
    return [
      { selector: 'node', style: {
        'background-color': css('--node'), 'border-color': css('--node-border'), 'border-width': 2,
        'label': 'data(label)', 'color': css('--text'), 'font-size': 12, 'font-weight': 600,
        'text-valign': 'center', 'text-halign': 'center', 'text-wrap': 'wrap', 'text-max-width': 70,
        'width': 82, 'height': 82,
      } },
      { selector: 'node.center', style: {
        'background-color': css('--center'), 'border-color': css('--center'), 'color': '#fff',
        'width': 110, 'height': 110, 'font-size': 14, 'text-max-width': 96,
      } },
      { selector: 'node.selected', style: { 'border-width': 5, 'border-color': css('--highlight') } },
      { selector: 'edge', style: {
        'width': 1.5, 'line-color': css('--edge'), 'curve-style': 'straight', 'opacity': 0.75,
        'label': 'data(label)', 'font-size': 10, 'color': css('--muted'),
        'text-rotation': 'autorotate', 'text-background-color': css('--bg'), 'text-background-opacity': 0.9,
        'text-background-padding': 2,
      } },
      { selector: 'edge.toCenter', style: { 'width': 2.5, 'line-color': css('--edge-center'), 'opacity': 0.9, 'color': css('--text') } },
      { selector: 'edge.ring', style: { 'width': 3, 'line-color': css('--ring'), 'opacity': 0.95, 'color': css('--text') } },
      { selector: 'edge.nolabel', style: { 'label': '' } },
      { selector: 'edge.hl', style: { 'line-color': css('--highlight'), 'width': 4, 'opacity': 1, 'label': 'data(label)', 'color': css('--text'), 'z-index': 10 } },
      { selector: '.faded', style: { 'opacity': 0.15 } },
    ];
  }

  function setupCy() {
    cy = cytoscape({
      container: $('cy'), style: graphStyle(), wheelSensitivity: 0.3,
      minZoom: 0.2, maxZoom: 3, boxSelectionEnabled: false,
    });
    // Refit whenever the stage changes size (window resize, panel opening/closing).
    new ResizeObserver(() => { cy.resize(); cy.fit(undefined, 40); }).observe($('cy'));
    cy.on('tap', 'node', e => { clearHighlight(); openPanel(Number(e.target.id())); });
    cy.on('tap', 'edge', e => highlightEdge(e.target));
    cy.on('tap', e => { if (e.target === cy) clearHighlight(); });
    cy.on('mouseover', 'edge', e => e.target.addClass('hl'));
    cy.on('mouseout', 'edge', e => { if (!e.target.data('pinned')) e.target.removeClass('hl'); });
    cy.on('mouseover', 'node', e => {
      if (state.labelMode !== 'hover') return;
      e.target.connectedEdges().addClass('hl');
    });
    cy.on('mouseout', 'node', e => { if (state.labelMode === 'hover') e.target.connectedEdges().filter(x => !x.data('pinned')).removeClass('hl'); });
  }

  // Building can take a few seconds (the ring search), so show a note first and
  // let it paint. If settings change again meanwhile, only the latest build runs.
  let buildToken = 0;
  function refresh() {
    if (state.centerId < 0) return;
    const token = ++buildToken;
    $('loading').textContent = 'Building the web…';
    $('loading').hidden = false;
    setTimeout(() => { if (token === buildToken) build(); }, 30);
  }

  function build() {
    web = G.buildWeb(index, state.centerId, {
      userWords: state.userWords, disabledStems: state.disabledStems, volumes: state.volumes,
      maxBranches: state.maxBranches, wordLimit: state.wordLimit,
    });
    $('loading').hidden = true;
    renderChips();
    drawGraph();
    if (web.message) showMessage(web.message); else $('message').hidden = true;
    const centerLines = web.edges.filter(e => e.toCenter).length;
    $('stats').textContent = `${web.nodes.length - 1} verses, ${web.edges.length} lines (${centerLines} to the center), ` +
      `from ${web.candidateCount.toLocaleString()} possible verses.` +
      (web.timedOut ? ' The search stopped at its time limit, so a larger web may exist.' : '');
    // The lines are rebuilt, so a "linked verses" view would be out of date.
    if (!$('panel-pair').hidden) closePanel();
    else if (state.selectedId >= 0 && !web.nodes.some(n => n.id === state.selectedId)) closePanel();
    else if (state.selectedId >= 0) openPanel(state.selectedId);
  }

  function drawGraph() {
    const n = web.ring.length;
    // An open ring leaves one empty slot, so its two unlinked ends aren't side by side.
    const slots = web.closed || n < 3 ? n : n + 1;
    const R = Math.max(230, (slots * 120) / (2 * Math.PI));
    const pos = new Map([[web.centerId, { x: 0, y: 0 }]]);
    web.ring.forEach((id, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, slots);
      pos.set(id, { x: R * Math.cos(a), y: R * Math.sin(a) });
    });
    const els = web.nodes.map(nd => ({
      group: 'nodes', data: { id: String(nd.id), label: index.verses[nd.id][1] },
      position: pos.get(nd.id), classes: nd.isCenter ? 'center' : '',
    }));
    web.edges.forEach((e, i) => els.push({
      group: 'edges', data: { id: 'e' + i, idx: i, source: String(e.a), target: String(e.b), label: e.label },
      classes: e.toCenter ? 'toCenter' : e.ring ? 'ring' : '',
    }));
    cy.batch(() => { cy.elements().remove(); cy.add(els); });
    cy.nodes().ungrabify();
    cy.layout({ name: 'preset', fit: true, padding: 40 }).run();
    applyLabelMode();
    markSelected();
  }

  function applyLabelMode() {
    if (!cy) return;
    cy.edges().removeClass('nolabel');
    if (state.labelMode === 'center') cy.edges().not('.toCenter').addClass('nolabel');
    if (state.labelMode === 'hover') cy.edges().addClass('nolabel');
  }

  function highlightEdge(edge) {
    clearHighlight();
    edge.data('pinned', true).addClass('hl');
    cy.elements().not(edge).not(edge.connectedNodes()).addClass('faded');
    openEdgePanel(web.edges[edge.data('idx')]);
  }
  function clearHighlight() {
    cy.elements().removeClass('faded');
    cy.edges().forEach(e => { e.data('pinned', false); e.removeClass('hl'); });
  }
  function markSelected() {
    cy.nodes().removeClass('selected');
    if (state.selectedId >= 0) cy.getElementById(String(state.selectedId)).addClass('selected');
  }

  // ---------- verse panel ----------
  // Verse text as HTML: words whose stem is in `stems` (on a line) in bold, and every
  // other keyword (any word not on the common list) underlined, so it's clear they count.
  function boldText(text, stems) {
    let html = '', last = 0;
    for (const t of T.tokenize(text)) {
      if (!t.stem) continue;
      const tag = stems.has(t.stem) ? 'b' : 'u';
      html += esc(text.slice(last, t.start)) + `<${tag}>` + esc(text.slice(t.start, t.end)) + `</${tag}>`;
      last = t.end;
    }
    return html + esc(text.slice(last));
  }

  // Both verses joined by a line, with only that line's keywords in bold.
  function openEdgePanel(edge) {
    state.selectedId = -1;
    const stems = new Set(edge.stems);
    const verseHtml = id => {
      const v = index.verses[id];
      return `<div class="pair-verse">
        <h3>${esc(v[0])}</h3><p class="hint">${esc(index.volumes[v[2]])}</p>
        <p class="verse-text">${boldText(v[3], stems)}</p>
        ${id === state.centerId ? '' : `<button type="button" data-center="${id}">Make this the center</button>`}
      </div>`;
    };
    $('panel-pair').innerHTML = `<h2>Linked verses</h2>
      <span class="link-label">${esc(edge.label)}</span>${verseHtml(edge.a)}${verseHtml(edge.b)}`;
    $('panel-pair').hidden = false;
    $('panel-single').hidden = true;
    $('panel').hidden = false;
    markSelected();
  }

  function openPanel(id) {
    state.selectedId = id;
    $('panel-pair').hidden = true;
    $('panel-single').hidden = false;
    const v = index.verses[id];
    const node = web && web.nodes.find(nd => nd.id === id);
    const html = boldText(v[3], new Set(node ? node.highlightStems : []));
    $('panel-title').textContent = v[0];
    $('panel-volume').textContent = index.volumes[v[2]];
    $('panel-text').innerHTML = html;
    const links = web ? web.edges.filter(e => e.a === id || e.b === id) : [];
    $('panel-links').innerHTML = links.length
      ? `Linked to ${links.length} verse${links.length > 1 ? 's' : ''}: ` + links.map(e => {
        const other = e.a === id ? e.b : e.a;
        return `${esc(index.verses[other][1])} (${esc(e.label)})`;
      }).join(', ')
      : '';
    $('panel-center').hidden = id === state.centerId;
    $('panel').hidden = false;
    if (cy) markSelected();
  }
  function closePanel() {
    state.selectedId = -1;
    $('panel').hidden = true;
    if (cy) markSelected();
  }

  // A dismissed message stays hidden until a different message appears
  // (or the same one for a different center verse).
  let dismissedKey = '';
  function showMessage(msg) {
    const key = `${state.centerId}|${msg}`;
    $('message-text').textContent = msg;
    $('message').dataset.key = key;
    $('message').hidden = key === dismissedKey;
  }
  $('message-close').addEventListener('click', () => {
    dismissedKey = $('message').dataset.key || '';
    $('message').hidden = true;
  });

  // Let the "Loading" text paint before the ~0.5 s index build.
  // (A timer, not requestAnimationFrame, which never fires in a background tab.)
  setTimeout(init, 30);
})();
