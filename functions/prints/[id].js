// GET /prints/<id>: a saved print gallery image, stored in D1. Members-only
// (gated by functions/_middleware.js): unlike covers, these can be camera photos.
const YEAR = 60 * 60 * 24 * 365;

export async function onRequestGet({ env, params }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return new Response('not found', { status: 404 });
  const row = await env.DB.prepare('SELECT content_type, data FROM prints WHERE id = ?').bind(id).first();
  if (!row) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(row.data), {
    headers: { 'Content-Type': row.content_type, 'Cache-Control': `private, max-age=${YEAR}, immutable` },
  });
}
