// Shows "My page" in the top bar while a member account is signed in.
// Pages that sign in or out dispatch `geb:account` to update it without a reload.
const nav = document.querySelector('header.site nav');

function setMyPage(signedIn) {
  let link = nav.querySelector('a[href="/members/me"]');
  if (!signedIn) { link?.remove(); return; }
  if (link) return;
  link = document.createElement('a');
  link.href = '/members/me';
  link.textContent = 'My page';
  if (location.pathname.replace(/\.html$/, '') === '/members/me') link.setAttribute('aria-current', 'page');
  nav.querySelector('a[href="/members/"]').after(link);
}

// Sign-out button, next to "My page", on every members page.
function setSignOut(signedIn) {
  let btn = nav.querySelector('#logout');
  if (!signedIn || !location.pathname.startsWith('/members')) { btn?.remove(); return; }
  if (btn) return;
  btn = document.createElement('button');
  btn.className = 'link small';
  btn.id = 'logout';
  btn.textContent = 'Sign out';
  btn.onclick = () => import('/members/app.js').then((m) => m.logout());
  nav.append(btn);
}

fetch('/api/me', { credentials: 'same-origin' })
  .then((r) => (r.ok ? r.json() : { me: null }))
  .then((r) => { setMyPage(!!r.me); setSignOut(!!r.me); })
  .catch(() => {});

addEventListener('geb:account', (e) => { setMyPage(!!e.detail); setSignOut(!!e.detail); });

// The brand is the trip-let: a block whose shadows spell G, E and B, turning slowly.
const brand = document.querySelector('header.site .brand canvas');
if (brand) import("/triplet.js").then((m) => m.mountTriplet(brand, { interactive: false, zoom: 1.1 })).catch(() => {});

// A second row on the members pages.
const SUB = [['/members/tiers', 'Club tier list'], ['/members/taste', 'Taste map'], ['/members/almanac', 'Almanac'], ['/members/gallery', 'Print gallery'], ['/members/shame', 'Hall of shame']];
if (location.pathname.startsWith('/members')) {
  const here = location.pathname.replace(/\.html$/, '');
  const sub = document.createElement('nav');
  sub.className = 'sub';
  sub.setAttribute('aria-label', 'Members');
  for (const [href, label] of SUB) {
    const a = document.createElement('a');
    a.href = href; a.textContent = label;
    if (here === href) a.setAttribute('aria-current', 'page');
    sub.append(a);
  }
  nav.after(sub);
}
