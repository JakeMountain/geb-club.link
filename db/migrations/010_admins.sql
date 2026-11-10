-- 2026-11-09: site admins. Admins see ballots and the count so far while voting is open,
-- and can edit candidates. Only counts on an account with a password.
ALTER TABLE members ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
