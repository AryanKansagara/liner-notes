export type Kind = 'track' | 'episode' | 'audiobook' | 'video'

/** One row of streaming history, normalised across the extended and basic exports. */
export interface Stream {
  /** When the stream ended (Spotify's `ts` / `endTime`), ms since epoch, UTC */
  ts: number
  /** Milliseconds played */
  ms: number
  /** Track, episode or chapter title */
  track: string
  /** Artist, show or audiobook title */
  artist: string
  album: string
  /** spotify:track:..., spotify:episode:... or '' (the basic export has no URIs) */
  uri: string
  kind: Kind
  /** reason_start / reason_end */
  rs?: string
  re?: string
  shuffle?: boolean
  skipped?: boolean
  offline?: boolean
  incognito?: boolean
  country?: string
  platform?: string
}

export type RuleKind = 'artist' | 'track' | 'keyword' | 'dates' | 'incognito' | 'podcasts'

/** An exclusion rule. Everything is recomputed without the rows it matches. */
export interface Rule {
  id: string
  kind: RuleKind
  /** artist name, track key, keyword, or a YYYY-MM-DD start date */
  value: string
  /** end date (inclusive) for date rules */
  to?: string
  label?: string
  on: boolean
}

export interface Settings {
  /** A stream counts as a play from this many seconds (Spotify's own threshold is 30) */
  minPlaySec: number
  /** IANA timezone used for clock, days, months and streaks */
  tz: string
  /** A gap longer than this starts a new listening session */
  sessionGapMin: number
  rules: Rule[]
}

export const DEFAULT_SETTINGS: Settings = { minPlaySec: 30, tz: 'UTC', sessionGapMin: 20, rules: [] }
