// Shared helpers for the members pages.

export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { location.href = `/enter?next=${encodeURIComponent(location.pathname + location.search)}`; throw new Error('signed out'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

/** el('div.card', {onclick}, child, 'text', ...) */
export function el(spec, attrs = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const n = document.createElement(tag || 'div');
  if (classes.length) n.className = classes.join(' ');
  if (attrs === null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { children.unshift(attrs); attrs = {}; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k in n && k !== 'list') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) n.append(c instanceof Node ? c : String(c));
  return n;
}

export const fmt = (x, d = 2) => (x == null ? '–' : Number(x).toFixed(d).replace(/\.?0+$/, '') || '0');

/** "First (@handle)" as a name with a quieter handle. */
export function who(name) {
  const m = /^(.*?) \((@[^)]+)\)$/.exec(name ?? '');
  return m ? el('span.who', m[1], ' ', el('span.handle', m[2])) : el('span.who', name ?? '');
}

export const coverUrl = (id, size = 'M') => (id ? `https://covers.openlibrary.org/b/id/${id}-${size}.jpg` : null);

/** Small cover image (or an empty placeholder of the same size). */
export function thumb(url, cls = 'thumb') {
  return url ? el(`img.${cls}`, { src: url, alt: '', loading: 'lazy', draggable: false }) : el(`span.${cls}.thumb-none`);
}

export function bookLinks(b) {
  const q = encodeURIComponent([b.title, b.author].filter(Boolean).join(' '));
  // Search by title + author: Open Library's first ISBN is often a foreign edition.
  return el('div.links',
    el('a', { href: `https://www.goodreads.com/search?q=${q}`, target: '_blank', rel: 'noopener' }, 'Goodreads'),
    el('a', { href: b.storygraph_url || `https://app.thestorygraph.com/browse?search_term=${q}`, target: '_blank', rel: 'noopener' }, 'StoryGraph'),
    el('a', { href: `https://www.amazon.com/s?k=${q}&i=stripbooks`, target: '_blank', rel: 'noopener' }, 'Amazon'),
    b.ol_key && el('a', { href: `https://openlibrary.org${b.ol_key}`, target: '_blank', rel: 'noopener' }, 'Open Library'));
}

export function bookCard(b, extra = []) {
  const img = b.cover_url || coverUrl(b.cover_id);
  return el('div.book',
    img ? el('img', { src: img, alt: '', loading: 'lazy' }) : el('div.noimg'),
    el('div.meta',
      el('div.title', b.title, b.year ? el('span.muted', ` (${b.year})`) : ''),
      b.author && el('div.muted', b.author),
      b.pitch && el('p.small.pitch', b.pitch),
      bookLinks(b),
      extra));
}

/** Search Open Library as you type; onPick({title, author, ol_key, cover_id, isbn, year}). */
export function bookSearch(onPick) {
  const input = el('input', { type: 'search', placeholder: 'Search by title or author…', style: 'width:100%', 'aria-label': 'Search for a book' });
  const list = el('ul.search-results', { hidden: true });
  let timer, seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { list.hidden = true; return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      list.hidden = false;
      list.replaceChildren(el('li.muted', 'Searching…'));
      try {
        const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=8&fields=key,title,author_name,first_publish_year,cover_i,isbn`;
        const { docs } = await (await fetch(url)).json();
        if (mine !== seq) return;
        if (!docs.length) { list.replaceChildren(el('li.muted', 'No matches. Enter the book by hand below.')); return; }
        list.replaceChildren(...docs.map((d) => {
          const book = {
            title: d.title, author: (d.author_name || []).slice(0, 2).join(', '), ol_key: d.key,
            cover_id: d.cover_i ?? null, year: d.first_publish_year ?? null,
            isbn: (d.isbn || []).find((x) => x.length === 13) || (d.isbn || [])[0] || null,
          };
          const pick = () => { onPick(book); list.hidden = true; input.value = ''; };
          return el('li', { tabIndex: 0, onclick: pick, onkeydown: (e) => e.key === 'Enter' && (e.preventDefault(), pick()) },
            el('div.book',
              book.cover_id ? el('img', { src: coverUrl(book.cover_id, 'S'), alt: '', style: 'width:32px' }) : el('div.noimg', { style: 'width:32px;height:48px' }),
              el('div.meta', el('div.title', book.title), el('div.muted.small', [book.author, book.year].filter(Boolean).join(' · ')))));
        }));
      } catch {
        if (mine === seq) list.replaceChildren(el('li.muted', "Couldn't reach Open Library. Enter the book by hand below."));
      }
    }, 350);
  });
  return el('div', input, list);
}

export async function getMe() {
  return (await api('/api/me')).me;
}

export const STATUS = { nominating: 'Nominating', voting: 'Voting open', closed: 'Closed' };
export const pill = (status) => el(`span.pill.${status}`, STATUS[status]);

export async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/';
}

// ---------------------------------------------------------------- tier lists
export const TIERS = ['S', 'A', 'B', 'C', 'D', 'F', 'N'];
const tierLabel = (t) => (t === 'N' ? "Didn't read" : t);

const chip = (b, editable) => el('span.chip', { 'data-id': b.book_id ?? b.id, tabIndex: editable ? 0 : null, title: b.author ? `${b.title} · ${b.author}` : b.title },
  thumb(b.cover_url, 'chip-cover'), el('span', b.title));

/** Read-only tier list. tiers: { S: [{book_id, title}], ... } */
export function tierView(tiers) {
  return el('div.tiers', TIERS.map((t) => el(`div.tier.tier-${t}`,
    el('div.tier-label', tierLabel(t)), el('div.tier-drop', (tiers[t] || []).map((b) => chip(b, false))))));
}

/**
 * Editable tier list. Drag books between tiers (mouse or touch), or tap a book then
 * tap where it should go, or use arrow keys. Left = better within a tier.
 * onChange({ S: [bookId, ...], ... }) is called after every move.
 */
export function tierEditor(books, tiers, onChange) {
  const placed = new Set(TIERS.flatMap((t) => (tiers[t] || []).map((b) => b.book_id)));
  const byId = Object.fromEntries(books.map((b) => [b.id, b]));
  const drops = Object.fromEntries(TIERS.map((t) => [t, el('div.tier-drop', { 'data-tier': t },
    (tiers[t] || []).filter((b) => byId[b.book_id]).map((b) => chip(byId[b.book_id], true)))]));
  const pool = el('div.tier-drop.tier-pool', { 'data-tier': '' }, books.filter((b) => !placed.has(b.id)).map((b) => chip(b, true)));
  const containers = [...TIERS.map((t) => drops[t]), pool];
  const root = el('div.tier-edit',
    el('div.tiers', TIERS.map((t) => el(`div.tier.tier-${t}`, el('div.tier-label', tierLabel(t)), drops[t]))),
    el('p.muted.small', 'Unranked'), pool);

  const state = () => Object.fromEntries(TIERS.map((t) => [t, [...drops[t].querySelectorAll('.chip')].map((c) => Number(c.dataset.id))]));
  const changed = () => onChange(state());

  // Where would a drop at (x, y) land? Returns [container, chipToInsertBefore | null].
  function target(x, y, ignore) {
    const under = document.elementFromPoint(x, y);
    const box = under?.closest('.tier-drop');
    if (!box || !root.contains(box)) return null;
    const chips = [...box.querySelectorAll('.chip')].filter((c) => c !== ignore);
    for (const c of chips) {
      const r = c.getBoundingClientRect();
      if (y < r.top) return [box, c];
      if (y <= r.bottom && x < r.left + r.width / 2) return [box, c];
    }
    return [box, null];
  }

  let selected = null;
  const select = (c) => {
    selected?.classList.remove('selected');
    selected = c === selected ? null : c;
    selected?.classList.add('selected');
  };

  root.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.chip');
    if (!c || e.button > 0) return;
    e.preventDefault();
    c.focus({ preventScroll: true });
    const start = { x: e.clientX, y: e.clientY };
    const rect = c.getBoundingClientRect();
    let ghost = null, holder = null;
    c.setPointerCapture(e.pointerId);

    const move = (ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
        ghost = c.cloneNode(true);
        ghost.classList.add('ghost');
        ghost.style.width = `${rect.width}px`;
        document.body.append(ghost);
        holder = el('span.chip-placeholder', { style: `height:${rect.height}px` });
        c.classList.add('dragging');
        c.after(holder);
      }
      ghost.style.left = `${ev.clientX - (start.x - rect.left)}px`;
      ghost.style.top = `${ev.clientY - (start.y - rect.top)}px`;
      const t = target(ev.clientX, ev.clientY, c);
      if (t) {
        const [box, before] = t;
        if (before) box.insertBefore(holder, before); else box.append(holder);
      }
    };
    const up = () => {
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
      if (!ghost) {
        // A tap: select this book, or move the selected book in front of it.
        if (selected && selected !== c) { c.before(selected); select(selected); changed(); } else select(c);
        return;
      }
      ghost.remove();
      holder.replaceWith(c);
      c.classList.remove('dragging');
      select(null);
      changed();
    };
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  });

  // Tap an empty part of a tier to move the selected book to its end.
  root.addEventListener('click', (e) => {
    const box = e.target.closest('.tier-drop');
    if (!selected || !box || e.target.closest('.chip')) return;
    box.append(selected);
    select(selected);
    changed();
  });

  // Keyboard: ←/→ move within a tier, ↑/↓ move to the tier above/below.
  root.addEventListener('keydown', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    const box = c.parentElement;
    if (e.key === 'ArrowLeft' && c.previousElementSibling) box.insertBefore(c, c.previousElementSibling);
    else if (e.key === 'ArrowRight' && c.nextElementSibling) c.nextElementSibling.after(c);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const i = containers.indexOf(box) + (e.key === 'ArrowUp' ? -1 : 1);
      if (i < 0 || i >= containers.length) return;
      containers[i].append(c);
    } else return;
    e.preventDefault();
    c.focus();
    changed();
  });

  return root;
}
