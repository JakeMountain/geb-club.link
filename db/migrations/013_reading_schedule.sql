-- 2026-11-10: reading schedule for a book, shown on /members/current. Admins enter it.
-- Each section is a chapter or page range to finish by a meeting date.
CREATE TABLE reading_sections (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books_read(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  unit TEXT NOT NULL DEFAULT 'chapter' CHECK (unit IN ('chapter', 'page')),
  start_at TEXT NOT NULL,  -- free text: "1", "Prologue", "121"
  end_at TEXT NOT NULL,
  due_date TEXT NOT NULL,  -- YYYY-MM-DD, the meeting it should be finished by
  UNIQUE (book_id, position)
);
