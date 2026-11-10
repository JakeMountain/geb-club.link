# geb-club.link

The GEB Club website: reading history, and a members area with elections, tier lists and notes.

Static pages in `public/`, API in `functions/` (Cloudflare Pages Functions), data in Cloudflare D1 (SQLite).

## Run it locally

Needs Node 20+.

```sh
npm install
cp .dev.vars.example .dev.vars   # local club password + session secret
npm run db:init:local            # creates the local database with the book list
npm run dev                      # http://localhost:8788
```

The members area uses the `CLUB_PASSWORD` from your `.dev.vars`.

If `npm run dev` starts but pages never load, an old dev server is still holding port 8788. Close it (Task Manager: `workerd.exe`), or use another port: `npx wrangler pages dev --port 8799`.

The local database starts with the books only. Create accounts and elections through the site to try the members pages.

## Tests

```sh
npm test
```

## Pages

Public: `/` (home), `/history`, `/voting`, `/enter` (club password).

Members:

| Page | What |
|---|---|
| `/members/` | Sign in or create an account, member list with debt and weight, history with notes. |
| `/members/current` | Current book and all elections. |
| `/members/election?id=` | One election: nominate, vote, results. Unsent ballot picks are kept in the browser until submitted. |
| `/members/book?id=` | One book: notes, who favorited it, link to its election. |
| `/members/member?id=` | One member: weight, debt after each election, tier list, notes, want to read. |
| `/members/me` | Your own page, in two views: Books (tier list, favorite, want to read, notes) and Account (profile, password, export). `/members/me#account` opens the second. |
| `/members/tiers`, `/members/taste`, `/members/almanac`, `/members/gallery`, `/members/shame` | Club tier list, taste map, almanac, print gallery, hall of shame. |

Pages are plain HTML with a module script; there is no build step for local dev. Check a layout change at phone width (about 390px) as well as desktop, in light and dark.

## Layout

| Path | What |
|---|---|
| `public/` | Pages. `public/members/` is behind the club password. |
| `public/style.css` | All shared styles: colors (light and dark), header, tables, forms, cards, election results, tier lists, covers. A page keeps only its own one-off styles in a `<style>` block. |
| `public/nav.js` | Top bar on every page: the trip-let, one row of links (Current book, History, Members, and a Club menu with the club-wide pages), and "My page" and "Sign out" at the right when signed in. The links are built here; each page's header only holds a fallback. |
| `public/members/app.js` | Shared helpers for the members pages: `api`, `el`, book cards, book search, name display, tier list view and editor. |
| `public/members/tierstats.js` | Tier list statistics: club averages, agreement between members, taste map, predictions. |
| `public/voting.html` | How we vote. Not in the top bar; linked from the election, current book, members and member pages. |
| `functions/_middleware.js` | Club password gate. |
| `functions/api/[[path]].js` | All API routes. |
| `src/tally.js` | Vote counting: debt-weighted STAR and plain STAR, and each member's debt after every election. |
| `src/auth.js` | Club password cookie, member accounts, password hashing. |
| `db/schema.sql` | Database schema. `db/migrations/` holds changes already applied to the live database. |
| `db/book_media.sql` | Cover image source and StoryGraph link for each book read. Re-runnable. |
| `db/tags.sql` | Starting tags for the books read (members add more on `/members/almanac`). |
| `public/triplet.js` | The trip-let in the top bar: a block whose shadows spell G, E and B. |
| `public/palette.js` | Main colors of each cover, for the home page shelf and the almanac. |
| `public/data/almanac.json` | Open Library data for each book read. Re-fetch after adding a book: `node scripts/almanac.mjs`. |
| `functions/covers/[id].js` | Serves covers from our own copy (D1 `cover_cache`), fetching from the source once. |
| `test/` | Unit tests. |

## Changing the database

Don't edit `db/schema.sql` alone. Add a new numbered file in `db/migrations/` with the change, and update `db/schema.sql` to match.

## Feature request bot

`bot/bot.mjs` reads new messages in one Discord channel, asks Claude Code which are requests worth building, builds each in a throwaway git worktree and opens a PR. It runs on Jake's machine and needs `git`, `gh` and `claude` signed in. It never deploys.

```sh
npm run bot -- --dry-run   # print verdicts, change nothing
npm run bot                # scan once
npm run bot:watch          # scan every 15 minutes
```

On Jake's PC a Task Scheduler task, "GEB feature request bot", runs `bot/run.cmd` daily at 5 PM with no window and appends output to `bot/bot.log`.

Config goes in `bot/.env` (gitignored):

```sh
DISCORD_BOT_TOKEN=          # Developer Portal -> your app -> Bot
DISCORD_CHANNEL_ID=         # right-click the channel, forum or forum post -> Copy Channel ID
# Optional:
DISCORD_ALLOWED_USER_IDS=   # comma-separated; empty = everyone in the channel
BOT_BACKFILL=100            # messages read on the first run (max 100)
BOT_MAX_PRS=                # most PRs per scan; empty = no limit
BOT_INTERVAL_MIN=15         # minutes between scans with --watch
BOT_MODEL=                  # empty = claude-opus-5-5
BOT_EFFORT=                 # empty = medium
BOT_REPLY=1                 # 0 = don't post the PR link in Discord
```

The Discord app needs the Message Content intent and, in the channel, View Channel, Read Message History and Send Messages (plus Send Messages in Threads for a forum).

Progress is in `bot/state.json`: a bookmark per channel and every request with its verdict. To have a declined request built, set its `status` to `queued`. Delete the file to start over.

Declined requests also go to `public/members/shame.json`, the data for the hall of shame page. The bot rewrites that file from `bot/state.json` on the branch `bot/hall-of-shame` and keeps one PR open for it until merged. Entries have a title, a reason and a date, and no names.

Whoever can post in the channel can steer what code gets written, and `npm test` runs that code on this machine. The builder has no network, git or other commands, and works in a clean checkout without the secret files. Review each PR before merging.

## Pull requests

Open a PR against `main`. Run `npm test` before you do. Jake reviews, merges and deploys (`npm run deploy` builds `dist/` with cache-busted asset links, then uploads it).

Don't commit real member names, Discord handles or ballot data. The detailed history is members-only and isn't in this repo.
