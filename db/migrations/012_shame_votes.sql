-- 2026-11-10: members' votes to give a declined feature request (on /members/shame) a second chance.
-- Keyed by the request's title in public/members/shame.json; one vote per member per request.
CREATE TABLE shame_votes (
  title TEXT NOT NULL,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (title, member_id)
);
