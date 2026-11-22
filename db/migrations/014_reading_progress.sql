-- 2026-11-22: reading progress on the current book (/members/current), shown to signed-in members.
-- Members opt in to having it read from their public Goodreads updates feed; others can enter it by hand.
ALTER TABLE members ADD COLUMN goodreads_progress INTEGER NOT NULL DEFAULT 0;

-- source 'manual': entered on the page. source 'goodreads': cached result of reading the feed;
-- updated_at is the update's time, NULL when the feed had no match or could not be read.
CREATE TABLE reading_progress (
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books_read(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('manual', 'goodreads')),
  page INTEGER,
  pages INTEGER,       -- page count, when known
  percent INTEGER,     -- 0-100, instead of a page
  updated_at TEXT,
  fetched_at TEXT,     -- goodreads only: when the feed was last read
  PRIMARY KEY (member_id, book_id, source)
);
