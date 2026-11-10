import { isMember } from '../src/auth.js';

// Everything under /members, /prints and /api is members-only, except login and /api/public.
// (/prints holds saved print-gallery images, which can be camera photos.)
const OPEN = ['/api/login', '/api/logout'];

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const path = url.pathname;
  const gated = (path === '/members' || path.startsWith('/members/') || path.startsWith('/prints/') ||
    (path.startsWith('/api/') && !path.startsWith('/api/public/'))) && !OPEN.includes(path);
  if (!gated || await isMember(request, env)) {
    const res = await next();
    if (!gated) return res;
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'private, no-store');
    return out;
  }
  if (path.startsWith('/api/')) return Response.json({ error: 'password required' }, { status: 401 });
  return Response.redirect(new URL(`/enter?next=${encodeURIComponent(path + url.search)}`, request.url).toString(), 302);
}
