// Parsers for Spotify's privacy exports. Pure functions; the Web Worker calls them so the UI never blocks.
import type { Kind, Stream } from './types.ts'

export type FileKind = 'extended-audio' | 'extended-video' | 'basic-music' | 'basic-podcast' | 'ignored'

export interface Issue { file: string; row: number; level: 'error' | 'warn'; msg: string }

export interface FileReport {
  file: string
  kind: FileKind
  rows: number
  kept: number
  skipped: number
  from?: number
  to?: number
}

/** Issue messages with their total count, so 7,000 identical warnings read as one line. */
export interface IssueGroup { msg: string; level: Issue['level']; count: number }

export interface ParseResult { streams: Stream[]; files: FileReport[]; issues: Issue[]; issueCount: number; groups: IssueGroup[] }

export const KIND_LABEL: Record<FileKind, string> = {
  'extended-audio': 'Extended history (audio)',
  'extended-video': 'Extended history (video)',
  'basic-music': 'Account data: music',
  'basic-podcast': 'Account data: podcasts',
  ignored: 'Not streaming history',
}

const MAX_ISSUES = 300

/** Decides what a file is from its name and the keys of its first row that has any of the known ones. */
export function detectKind(name: string, rows: unknown): FileKind {
  if (!Array.isArray(rows)) return 'ignored'
  const base = name.split('/').pop() ?? name
  for (const r of rows as unknown[]) {
    if (typeof r !== 'object' || r === null) continue
    if ('ts' in r && 'ms_played' in r) return /video/i.test(base) ? 'extended-video' : 'extended-audio'
    if ('endTime' in r && 'msPlayed' in r) return 'podcastName' in r || /podcast/i.test(base) ? 'basic-podcast' : 'basic-music'
  }
  return 'ignored'
}

/** Is this file name one of the history files we want out of a zip? */
export const isHistoryName = (name: string) => {
  // Skip macOS resource forks that appear when a folder is re-zipped on a Mac.
  if (/(^|\/)__MACOSX\//.test(name) || /(^|\/)\._[^/]*$/.test(name)) return false
  return /(Streaming_History_(Audio|Video)|StreamingHistory_?(music|podcast)?)[^/]*\.json$/i.test(name) || /(endsong|endvideo)[^/]*\.json$/i.test(name)
}

/** JSON.parse that tolerates the byte-order mark some editors add when a file is re-saved. */
export const parseJson = (text: string): unknown => JSON.parse(text.replace(/^\uFEFF/, ''))

const str = (v: unknown) => typeof v === 'string' ? v.trim() : ''
const bool = (v: unknown) => v === true || v === 'true' ? true : v === false || v === 'false' ? false : undefined

/** Parses Spotify's timestamps, NaN for anything else. Extended: ISO with Z (or an offset). Basic: "2024-03-01 13:45" in UTC. */
export function parseTs(v: unknown): number {
  if (typeof v !== 'string') return NaN
  const s = v.trim()
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d)(?::(\d\d)(?:\.\d+)?)?(?:Z|[+-]\d\d:?\d\d)| (\d\d):(\d\d)(?::(\d\d))?)$/.exec(s)
  if (!m) return NaN
  const [y, mo, d] = [+m[1], +m[2], +m[3]]
  // Date.parse rolls 30 February over into March.
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return NaN
  if (+(m[4] ?? m[7]) > 23 || +(m[5] ?? m[8]) > 59 || +(m[6] ?? m[9] ?? 0) > 59) return NaN
  return Date.parse(s.includes(' ') ? s.replace(' ', 'T') + 'Z' : s)
}

/** No single play lasts this long; a bigger value is damage and would put the start of the play outside any calendar. */
const MAX_PLAY_MS = 7 * 86_400_000
/** Spotify was founded in 2006. */
const FIRST_TS = Date.UTC(2006, 0, 1)

/** Milliseconds played, or the reason the value cannot be one. */
function playMs(v: unknown, field: string): number | string {
  if (v === undefined || v === null || v === '') return `${field} is missing or negative`
  const ms = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN
  if (!Number.isFinite(ms)) return `${field} is not a number`
  if (ms < 0) return `${field} is missing or negative`
  return ms > MAX_PLAY_MS ? `${field} is longer than 7 days` : ms
}

/**
 * For offline plays `ts` is when the play reached Spotify's servers, which can be hours or days after the music
 * stopped; `offline_timestamp` (seconds in recent exports, milliseconds in some older ones) holds the real start.
 * Returns the corrected end time, or `ts` when the field is missing, zero or implausible.
 */
export function offlineEnd(ts: number, ms: number, offline: unknown, ots: unknown): number {
  if (offline !== true || typeof ots !== 'number' || !(ots > 0)) return ts
  const start = ots < 1e11 ? ots * 1000 : ots
  if (start < Date.UTC(2008, 0, 1) || start + ms > ts) return ts
  return ts - (start + ms) > 5 * 60_000 ? start + ms : ts
}

export function parseFile(name: string, rows: unknown): { kind: FileKind; streams: Stream[]; report: FileReport; issues: Issue[]; issueCount: number; groups: Map<string, IssueGroup> } {
  const kind = detectKind(name, rows)
  const issues: Issue[] = []
  let issueCount = 0
  const groups = new Map<string, IssueGroup>()
  const push = (row: number, level: Issue['level'], msg: string) => {
    issueCount++
    if (issues.length < MAX_ISSUES) issues.push({ file: name, row, level, msg })
    const g = msg.replace(/ ".*"$/, '')
    const cur = groups.get(g)
    if (cur) cur.count++; else groups.set(g, { msg: g, level, count: 1 })
  }
  const streams: Stream[] = []
  const list = Array.isArray(rows) ? rows : []
  if (kind === 'ignored') return { kind, streams, report: { file: name, kind, rows: list.length, kept: 0, skipped: 0 }, issues, issueCount, groups }

  // Two days of slack for clocks and timezones.
  const latest = Date.now() + 2 * 86_400_000
  let skipped = 0, from = Infinity, to = -Infinity
  list.forEach((raw, i) => {
    const row = i + 1
    if (!raw || typeof raw !== 'object') { skipped++; push(row, 'error', 'Not an object'); return }
    const r = raw as Record<string, unknown>
    let s: Stream | null = null
    if (kind === 'extended-audio' || kind === 'extended-video') {
      const ms = playMs(r.ms_played, 'ms_played')
      let ts = parseTs(r.ts)
      if (!Number.isFinite(ts)) { skipped++; push(row, 'error', `Unreadable ts "${String(r.ts)}"`); return }
      if (ts < FIRST_TS || ts > latest) { skipped++; push(row, 'error', `Date before Spotify existed or in the future "${String(r.ts)}"`); return }
      if (typeof ms === 'string') { skipped++; push(row, 'error', ms); return }
      ts = offlineEnd(ts, ms, r.offline, r.offline_timestamp)
      const trackName = str(r.master_metadata_track_name), ep = str(r.episode_name), book = str(r.audiobook_chapter_title) || str(r.audiobook_title)
      let k: Kind, track: string, artist: string, album: string, uri: string
      if (trackName) { k = kind === 'extended-video' ? 'video' : 'track'; track = trackName; artist = str(r.master_metadata_album_artist_name) || 'Unknown artist'; album = str(r.master_metadata_album_album_name); uri = str(r.spotify_track_uri) }
      else if (ep) { k = 'episode'; track = ep; artist = str(r.episode_show_name) || 'Unknown show'; album = artist; uri = str(r.spotify_episode_uri) }
      else if (book) { k = 'audiobook'; track = book; artist = str(r.audiobook_title) || book; album = artist; uri = str(r.audiobook_chapter_uri) || str(r.audiobook_uri) }
      else { skipped++; push(row, 'warn', 'No track, episode or audiobook metadata (often a local file or removed content)'); return }
      s = { ts, ms, track, artist, album, uri, kind: k }
      const rs = str(r.reason_start), re = str(r.reason_end)
      if (rs) s.rs = rs
      if (re) s.re = re
      const sh = bool(r.shuffle), sk = bool(r.skipped), off = bool(r.offline), inc = bool(r.incognito_mode)
      if (sh !== undefined) s.shuffle = sh
      if (sk !== undefined) s.skipped = sk
      if (off) s.offline = off
      if (inc) s.incognito = inc
      const c = str(r.conn_country), p = str(r.platform)
      if (c) s.country = c
      if (p) s.platform = p
    } else {
      const ts = parseTs(r.endTime)
      const ms = playMs(r.msPlayed, 'msPlayed')
      if (!Number.isFinite(ts)) { skipped++; push(row, 'error', `Unreadable endTime "${String(r.endTime)}"`); return }
      if (ts < FIRST_TS || ts > latest) { skipped++; push(row, 'error', `Date before Spotify existed or in the future "${String(r.endTime)}"`); return }
      if (typeof ms === 'string') { skipped++; push(row, 'error', ms); return }
      if (kind === 'basic-music') {
        const track = str(r.trackName)
        if (!track) { skipped++; push(row, 'warn', 'Empty trackName'); return }
        s = { ts, ms, track, artist: str(r.artistName) || 'Unknown artist', album: '', uri: '', kind: 'track' }
      } else {
        const track = str(r.episodeName)
        if (!track) { skipped++; push(row, 'warn', 'Empty episodeName'); return }
        const show = str(r.podcastName) || 'Unknown show'
        s = { ts, ms, track, artist: show, album: show, uri: '', kind: 'episode' }
      }
    }
    streams.push(s)
    if (s.ts < from) from = s.ts
    if (s.ts > to) to = s.ts
  })
  const report: FileReport = { file: name, kind, rows: list.length, kept: streams.length, skipped, ...(streams.length ? { from, to } : {}) }
  return { kind, streams, report, issues, issueCount, groups }
}

const MINUTE = 60_000
/** Rows of the basic export have no URI and an end time cut to the minute. */
const isBasic = (s: Stream) => !s.uri && s.ts % MINUTE === 0

/**
 * Merges stream lists and drops repeats, sorted by ts.
 * Extended rows know the second they ended: same second, ms and title, by the same artist or with the same URI, is one play.
 * The basic export cuts endTime to the minute, so a basic row stands for one extended row with its ms and title in the
 * same or a neighbouring minute, and the extended row is kept. The two exports can credit the artist differently, so an equal
 * artist is preferred but not required. Basic rows only repeat each other when minute, ms, title and artist are all equal.
 * A list that holds both kinds is an earlier merge: its basic rows were already found to be plays of their own there.
 */
export function mergeStreams(...lists: Stream[][]): Stream[] {
  const full = new Map<string, Stream[]>(), basic = new Map<string, Stream>()
  // Which earlier merges a row came from, so its basic rows are not matched to extended rows of the same merge.
  const seen = new Map<Stream, Set<Stream[]>>()
  for (const list of lists) {
    const merged = list.some(isBasic) && !list.every(isBasic)
    const mark = (s: Stream) => { if (!merged) return; const l = seen.get(s); if (l) l.add(list); else seen.set(s, new Set([list])) }
    for (const s of list) {
      const k = `${s.ts}|${s.ms}|${s.track}`
      if (isBasic(s)) {
        const b = `${k}|${s.artist}`
        if (!basic.has(b)) basic.set(b, s)
        mark(basic.get(b)!)
        continue
      }
      const same = full.get(k)
      if (!same) { full.set(k, [s]); mark(s); continue }
      const i = same.findIndex(p => p.artist === s.artist || (!!p.uri && p.uri === s.uri))
      if (i < 0) same.push(s)
      else if (!same[i].uri && s.uri) { const l = seen.get(same[i]); if (l) seen.set(s, new Set(l)); same[i] = s }
      mark(i < 0 ? s : same[i])
    }
  }
  const apart = (a: Stream, b: Stream) => { const l = seen.get(a), m = seen.get(b); return !!l && !!m && [...l].some(x => m.has(x)) }
  const out = [...full.values()].flat()
  if (basic.size) {
    const byMinute = new Map<string, Stream[]>()
    for (const s of out) { const k = `${Math.floor(s.ts / MINUTE)}|${s.ms}|${s.track}`; const l = byMinute.get(k); if (l) l.push(s); else byMinute.set(k, [s]) }
    const taken = new Set<Stream>()
    let left = [...basic.values()]
    for (const sameArtist of [true, false]) for (const offsets of [[0], [-1, 1]]) left = left.filter(b => {
      for (const o of offsets) {
        const hit = byMinute.get(`${b.ts / MINUTE + o}|${b.ms}|${b.track}`)?.find(x => !taken.has(x) && (!sameArtist || x.artist === b.artist) && !apart(b, x))
        if (hit) { taken.add(hit); return false }
      }
      return true
    })
    for (const b of left) out.push(b)
  }
  return out.sort((a, b) => a.ts - b.ts)
}

export function parseMany(files: { name: string; rows: unknown }[]): ParseResult {
  const all: Stream[][] = []
  const reports: FileReport[] = []
  const issues: Issue[] = []
  let issueCount = 0
  const groups = new Map<string, IssueGroup>()
  for (const f of files) {
    const r = parseFile(f.name, f.rows)
    reports.push(r.report)
    all.push(r.streams)
    issueCount += r.issueCount
    for (const i of r.issues) if (issues.length < MAX_ISSUES) issues.push(i)
    for (const [msg, g] of r.groups) { const cur = groups.get(msg); if (cur) cur.count += g.count; else groups.set(msg, { ...g }) }
  }
  const streams = mergeStreams(...all)
  return { streams, files: reports, issues, issueCount, groups: [...groups.values()].sort((a, b) => b.count - a.count) }
}
