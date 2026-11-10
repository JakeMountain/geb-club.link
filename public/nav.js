// The top bar on every page: the trip-let, then one row of links built here,
// with "My page" and "Sign out" at the right while a member account is signed in.
// Pages that sign in or out dispatch `geb:account` to update it without a reload.
const nav = document.querySelector('header.site nav');
const here = location.pathname.replace(/\.html$/, '').replace(/^\/members$/, '/members/');

// [href, label, other pages that belong under this link]
const TOP = [
  ['/members/current', 'Current book', ['/members/election']],
  ['/history', 'History', ['/members/book']],
  ['/members/', 'Members', ['/members/member', '/enter']],
];
const CLUB = [['/members/tiers', 'Club tier list'], ['/members/taste', 'Taste map'], ['/members/almanac', 'Almanac'], ['/members/gallery', 'Print gallery'], ['/members/shame', 'Hall of shame']];

function link(href, label, also = []) {
  const a = document.createElement('a');
  a.href = href; a.textContent = label;
  if (here === href) a.setAttribute('aria-current', 'page');
  else if (also.includes(here)) a.setAttribute('aria-current', 'true');
  return a;
}

// rebuild the links after the brand so every page has the same set
for (const n of [...nav.children]) if (!n.classList.contains('brand')) n.remove();
for (const [href, label, also] of TOP) nav.append(link(href, label, also));

// "Club" opens a menu of the club-wide pages
const club = document.createElement('details');
club.className = 'menu';
const summary = document.createElement('summary');
summary.textContent = 'Club';
if (CLUB.some(([href]) => href === here)) summary.setAttribute('aria-current', 'true');
const list = document.createElement('div');
list.className = 'menu-list';
for (const [href, label] of CLUB) list.append(link(href, label));
club.append(summary, list);
nav.append(club);
addEventListener('click', (e) => { if (club.open && !club.contains(e.target)) club.open = false; });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && club.open) { club.open = false; summary.focus(); } });

// My page and Sign out, kept together at the right
const account = document.createElement('span');
account.className = 'account';
nav.append(account);

function setAccount(signedIn) {
  account.replaceChildren();
  if (!signedIn) return;
  const btn = document.createElement('button');
  btn.className = 'link small';
  btn.id = 'logout';
  btn.textContent = 'Sign out';
  btn.onclick = () => import('/members/app.js').then((m) => m.logout());
  account.append(link('/members/me', 'My page'), btn);
}

fetch('/api/me', { credentials: 'same-origin' })
  .then((r) => (r.ok ? r.json() : { me: null }))
  .then((r) => setAccount(!!r.me))
  .catch(() => {});

addEventListener('geb:account', (e) => setAccount(!!e.detail));

// The brand is the trip-let: a block whose shadows spell G, E and B, turning slowly.
const brand = document.querySelector('header.site .brand canvas');
if (brand) import("/triplet.js").then((m) => m.mountTriplet(brand, { interactive: false, zoom: 1.1 })).catch(() => {});
