# Liner Notes

A private, year-round deep dive into your own Spotify Extended Streaming History, with the "fix my Wrapped" controls people keep asking for.

**Live:** https://liner-notes-three-nu.vercel.app (the plain liner-notes.vercel.app alias belongs to another project)

## The pain

Wrapped is a once-a-year summary you can't correct. Sleep sounds, white noise, kids' songs and shared accounts take over top tracks, and Spotify's playlist exclusion only works going forward. Meanwhile the Extended Streaming History export holds every stream since day one, but as hundreds of thousands of rows of raw JSON.

## Features

- **Import** the `my_spotify_data.zip` or the JSON inside: extended audio/video history and the basic Account data. Parsed in a Web Worker, merged, de-duplicated, with a validation report listing every skipped row by file and row number.
- **Fix my Wrapped**: exclusion rules by artist, track, keyword (sleep, rain, kids...), date range, private sessions or podcasts. Suggested rules detect noise and night-time loops. Everything recomputes instantly.
- **Engine** (tested): sessions, a configurable play threshold (30 s default), top tracks/artists/albums/podcasts for any date range by minutes or plays, skip rate and songs you always skip, first listens and peak months, lost favourites, a local-time listening clock with a timezone setting, streaks, discovery rate, era detection, and a year in review for any 12 months.
- **Actions**: 9:16 and square story cards rendered to PNG, rediscovery lists of `spotify:track:` URIs to paste into a desktop playlist, CSV exports, and a printable liner-notes booklet.
- **History**: a snapshot per import, with a compare view of what changed since the last request.
- **Workspace**: several listeners per device in IndexedDB. Optional account (email + password) syncs settings, rules and snapshot summaries via Supabase. Raw history never leaves the browser.
- Two synthetic sample listeners (all artists and tracks invented), one whose top tracks are polluted by sleep sounds.

## Run locally

```bash
npm install
cp .env.example .env   # optional: public Supabase URL + publishable key for sync
npm run dev
npm test               # engine tests
npm run build
```

Built with Vite, React 19 and TypeScript. Independent project, not affiliated with Spotify.
