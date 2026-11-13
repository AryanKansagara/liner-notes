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

/** Decides what a file is from its name and the keys of its first object. */
export function detectKind(name: string, rows: unknown): FileKind {
  if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'object' || rows[0] === null) return 'ignored'
  const first = rows[0] as Record<string, unknown>
  const base = name.split('/').pop() ?? name
  if ('ts' in first && 'ms_played' in first) return /video/i.test(base) ? 'extended-video' : 'extended-audio'
  if ('endTime' in first && 'msPlayed' in first) return 'podcastName' in first || /podcast/i.test(base) ? 'basic-podcast' : 'basic-music'
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

/** Parses Spotify's timestamps. Extended: ISO with Z. Basic: "2024-03-01 13:45" in UTC. */
export function parseTs(v: unknown): number {
  if (typeof v !== 'string') return NaN
  const s = v.trim()
  if (/^\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d)?$/.test(s)) return Date.parse(s.replace(' ', 'T') + 'Z')
  return Date.parse(s)
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

  let skipped = 0, from = Infinity, to = -Infinity
  list.forEach((raw, i) => {
    const row = i + 1
    if (!raw || typeof raw !== 'object') { skipped++; push(row, 'error', 'Not an object'); return }
    const r = raw as Record<string, unknown>
    let s: Stream | null = null
    if (kind === 'extended-audio' || kind === 'extended-video') {
      const ms = Number(r.ms_played)
      let ts = parseTs(r.ts)
      if (!Number.isFinite(ts)) { skipped++; push(row, 'error', `Unreadable ts "${String(r.ts)}"`); return }
      if (!Number.isFinite(ms) || ms < 0) { skipped++; push(row, 'error', 'ms_played is missing or negative'); return }
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
      const ms = Number(r.msPlayed)
      if (!Number.isFinite(ts)) { skipped++; push(row, 'error', `Unreadable endTime "${String(r.endTime)}"`); return }
      if (!Number.isFinite(ms) || ms < 0) { skipped++; push(row, 'error', 'msPlayed is missing or negative'); return }
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

/** Identity used to drop duplicates when files overlap (basic + extended, or a re-import of the same request). */
export const dedupKey = (s: Stream) => `${Math.floor(s.ts / 60000)}|${s.ms}|${s.track}`

/**
 * Merges stream lists, preferring rows with more detail (URIs) when the same play appears twice. Sorted by ts.
 * The basic export cuts endTime to the minute, so a basic row (no URI) also matches an extended row (with URI)
 * in the neighbouring minute. Two rows of the same kind only match in the same minute, so a short song on
 * repeat is not collapsed.
 */
export function mergeStreams(...lists: Stream[][]): Stream[] {
  const map = new Map<string, Stream>()
  for (const list of lists) for (const s of list) {
    const m = Math.floor(s.ts / 60000), rest = `|${s.ms}|${s.track}`
    let k = m + rest
    if (!map.has(k)) for (const n of [m - 1, m + 1]) { const prev = map.get(n + rest); if (prev && !prev.uri !== !s.uri) { k = n + rest; break } }
    const prev = map.get(k)
    if (!prev || (!prev.uri && s.uri)) map.set(k, s)
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts)
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
