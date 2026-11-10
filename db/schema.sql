-- GEB club schema (Cloudflare D1 / SQLite)
DROP TABLE IF EXISTS reading_sections;
DROP TABLE IF EXISTS prints;
DROP TABLE IF EXISTS book_tags;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS cover_cache;
DROP TABLE IF EXISTS debt_seeds;
DROP TABLE IF EXISTS tier_entries;
DROP TABLE IF EXISTS book_notes;
DROP TABLE IF EXISTS want_to_read;
DROP TABLE IF EXISTS ballots;
DROP TABLE IF EXISTS candidates;
DROP TABLE IF EXISTS elections;
DROP TABLE IF EXISTS books_read;
DROP TABLE IF EXISTS members;

CREATE TABLE members (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE, -- display label built from first_name/discord
  first_name TEXT,
  discord TEXT,
  pw_hash TEXT,        -- NULL = passwordless account
  pw_salt TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT,
  storygraph_url TEXT,
  goodreads_url TEXT,
  favorite_book_id INTEGER REFERENCES books_read(id) ON DELETE SET NULL,
  is_admin INTEGER NOT NULL DEFAULT 0  -- counts only when the account has a password
);

CREATE UNIQUE INDEX members_discord ON members (discord COLLATE NOCASE) WHERE discord IS NOT NULL;

CREATE TABLE books_read (
  id INTEGER PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  author TEXT,
  nominator TEXT,      -- free text: "none", "George/Jacob", ...
  read_date TEXT,      -- YYYY-MM or YYYY-MM-DD, often unknown
  notes TEXT,
  election_id INTEGER REFERENCES elections(id) ON DELETE SET NULL,
  storygraph_url TEXT, -- official StoryGraph book page
  cover_url TEXT
);

CREATE TABLE elections (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'debt-star',
  status TEXT NOT NULL DEFAULT 'nominating' CHECK (status IN ('nominating', 'voting', 'closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  winner_id INTEGER,
  result TEXT          -- JSON snapshot of the tally at close
);

CREATE TABLE candidates (
  id INTEGER PRIMARY KEY,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  author TEXT,
  nominator_id INTEGER REFERENCES members(id),
  ol_key TEXT,         -- Open Library work key, e.g. /works/OL45804W
  cover_id INTEGER,
  isbn TEXT,
  year INTEGER,
  pitch TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ballots (
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id),
  scores TEXT NOT NULL, -- JSON {candidateId: 0..5}
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (election_id, member_id)
);

CREATE TABLE want_to_read (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  author TEXT,
  ol_key TEXT,
  cover_id INTEGER,
  year INTEGER,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX want_to_read_member ON want_to_read (member_id);

CREATE TABLE book_notes (
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books_read(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (member_id, book_id)
);

CREATE TABLE tier_entries (
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books_read(id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('S', 'A', 'B', 'C', 'D', 'F', 'N')), -- N = didn't read
  position INTEGER NOT NULL,
  PRIMARY KEY (member_id, book_id)
);

CREATE TABLE debt_seeds (
  member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  debt REAL NOT NULL,
  note TEXT
);

CREATE TABLE cover_cache (
  book_id INTEGER PRIMARY KEY REFERENCES books_read(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,       -- cover_url this copy was fetched from
  content_type TEXT NOT NULL,
  data BLOB NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- tags members add to books read (seeded from db/tags.sql)
CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE book_tags (
  book_id INTEGER NOT NULL REFERENCES books_read(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  tagged_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (book_id, tag_id)
);

-- images members save from the print gallery (/members/gallery), shown to the whole club
CREATE TABLE prints (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX prints_member ON prints (member_id);

-- reading schedule for a book (/members/current), entered by admins
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

-- votes to give a declined feature request (/members/shame) a second chance; keyed by its title in shame.json
CREATE TABLE shame_votes (
  title TEXT NOT NULL,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (title, member_id)
);
