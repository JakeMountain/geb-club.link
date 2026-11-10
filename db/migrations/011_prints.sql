-- 2026-11-09: images members save from the print gallery, shown to the whole club
-- on /members/gallery.
CREATE TABLE prints (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX prints_member ON prints (member_id);
