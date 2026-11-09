// The listening engine. Every function is pure and works on a prepared context so the UI can recompute
// everything (rules, timezone, play threshold) on each change.
import type { Rule, Settings, Stream } from './types.ts'

const HOUR = 3_600_000
const DAY = 86_400_000

// ---------- Time ----------

const fmtCache = new Map<string, Intl.DateTimeFormat>()
const offCache = new Map<string, Map<number, number>>()

export function validTz(tz: string) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

/** Local minus UTC in ms for an instant in a timezone. Cached per UTC hour, so 500k rows cost a few thousand Intl calls. */
export function tzOffset(ts: number, tz: string): number {
  if (tz === 'UTC') return 0
  let cache = offCache.get(tz)
  if (!cache) offCache.set(tz, cache = new Map())
  const bucket = Math.floor(ts / HOUR)
  const hit = cache.get(bucket)
  if (hit !== undefined) return hit
  let f = fmtCache.get(tz)
  if (!f) fmtCache.set(tz, f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }))
  const t = bucket * HOUR
  const p: Record<string, number> = {}
  for (const x of f.formatToParts(new Date(t))) if (x.type !== 'literal') p[x.type] = Number(x.value)
  const off = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second) - t
  cache.set(bucket, off)
  return off
}

/** Local wall-clock helpers. `loc` is local time expressed as if it were UTC. */
export const ymOf = (loc: number) => { const d = new Date(loc); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
export const dayOf = (loc: number) => Math.floor(loc / DAY)
export const dateOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10)
export const hourOf = (loc: number) => Math.floor((loc % DAY + DAY) % DAY / HOUR)
/** Monday = 0 */
export const weekdayOf = (loc: number) => (new Date(loc).getUTCDay() + 6) % 7
export const ymStart = (ym: string) => Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1)
export function addMonths(ym: string, n: number) {
  const d = new Date(ymStart(ym))
  d.setUTCMonth(d.getUTCMonth() + n)
  return ymOf(d.getTime())
}
export function monthsBetween(a: string, b: string): string[] {
  const out: string[] = []
  for (let m = a; m <= b && out.length < 1200; m = addMonths(m, 1)) out.push(m)
  return out
}

// ---------- Keys ----------

export const trackKey = (s: Pick<Stream, 'artist' | 'track'>) => `${s.artist.toLowerCase()}\u0000${s.track.toLowerCase()}`
export const albumKey = (s: Pick<Stream, 'artist' | 'album'>) => `${s.artist.toLowerCase()}\u0000${s.album.toLowerCase()}`
export const isMusic = (s: Stream) => s.kind === 'track'
export const isTalk = (s: Stream) => s.kind === 'episode' || s.kind === 'audiobook'

// ---------- Exclusion rules ("fix my Wrapped") ----------

export function ruleMatches(s: Stream, r: Rule, tz = 'UTC'): boolean {
  const v = r.value.toLowerCase()
  switch (r.kind) {
    case 'artist': return s.artist.toLowerCase() === v
    case 'track': return trackKey(s) === r.value.toLowerCase()
    case 'keyword': return !!v && (s.track.toLowerCase().includes(v) || s.artist.toLowerCase().includes(v) || s.album.toLowerCase().includes(v))
    case 'incognito': return !!s.incognito
    case 'podcasts': return isTalk(s)
    case 'dates': {
      const start = s.ts - s.ms
      const d = dateOf(dayOf(start + tzOffset(start, tz)))
      return d >= r.value && d <= (r.to || r.value)
    }
  }
}

export interface RuleImpact { streams: number; ms: number; plays: number }

/** Drops every stream matched by an active rule. Each removed stream is credited to the first rule that matched it. */
export function applyRules(streams: Stream[], rules: Rule[], tz = 'UTC', minMs = 30_000) {
  const active = rules.filter(r => r.on)
  const impact: Record<string, RuleImpact> = Object.fromEntries(rules.map(r => [r.id, { streams: 0, ms: 0, plays: 0 }]))
  if (!active.length) return { kept: streams, impact, removed: 0, removedMs: 0 }
  const kept: Stream[] = []
  let removed = 0, removedMs = 0
  for (const s of streams) {
    const hit = active.find(r => ruleMatches(s, r, tz))
    if (!hit) { kept.push(s); continue }
    const im = impact[hit.id]
    im.streams++; im.ms += s.ms; if (s.ms >= minMs) im.plays++
    removed++; removedMs += s.ms
  }
  return { kept, impact, removed, removedMs }
}

/** What a rule would remove on its own, regardless of whether it is on. */
export function ruleReach(streams: Stream[], r: Rule, tz = 'UTC', minMs = 30_000): RuleImpact {
  const im = { streams: 0, ms: 0, plays: 0 }
  for (const s of streams) if (ruleMatches(s, r, tz)) { im.streams++; im.ms += s.ms; if (s.ms >= minMs) im.plays++ }
  return im
}

// ---------- Context ----------

export interface Ctx {
  /** Streams sorted by ts, after rules */
  s: Stream[]
  /** Local start time of each stream (as fake-UTC ms) */
  loc: Float64Array
  minMs: number
  gapMs: number
  tz: string
}

export function buildCtx(streams: Stream[], settings: Pick<Settings, 'minPlaySec' | 'tz' | 'sessionGapMin'>): Ctx {
  const s = streams.length < 2 || streams.every((x, i) => i === 0 || streams[i - 1].ts <= x.ts) ? streams : [...streams].sort((a, b) => a.ts - b.ts)
  const loc = new Float64Array(s.length)
  for (let i = 0; i < s.length; i++) { const st = s[i].ts - s[i].ms; loc[i] = st + tzOffset(st, settings.tz) }
  return { s, loc, minMs: settings.minPlaySec * 1000, gapMs: settings.sessionGapMin * 60_000, tz: settings.tz }
}

/** Applies rules then builds the context. */
export function prepare(streams: Stream[], settings: Settings) {
  const r = applyRules(streams, settings.rules, settings.tz, settings.minPlaySec * 1000)
  return { ctx: buildCtx(r.kept, settings), ...r }
}

/** Restricts a context to local months [from, to] inclusive (YYYY-MM). */
export function sliceCtx(ctx: Ctx, from?: string, to?: string): Ctx {
  const lo = from ? ymStart(from) : -Infinity
  const hi = to ? ymStart(addMonths(to, 1)) : Infinity
  const idx: number[] = []
  for (let i = 0; i < ctx.s.length; i++) if (ctx.loc[i] >= lo && ctx.loc[i] < hi) idx.push(i)
  return { ...ctx, s: idx.map(i => ctx.s[i]), loc: Float64Array.from(idx, i => ctx.loc[i]) }
}

export const isPlay = (s: Stream, minMs: number) => s.ms >= minMs

// ---------- Totals ----------

export interface Totals { streams: number; plays: number; ms: number; musicMs: number; talkMs: number; tracks: number; artists: number; activeDays: number; from: number; to: number }

export function totals(ctx: Ctx): Totals {
  let plays = 0, ms = 0, musicMs = 0, talkMs = 0
  const tracks = new Set<string>(), artists = new Set<string>(), days = new Set<number>()
  for (let i = 0; i < ctx.s.length; i++) {
    const s = ctx.s[i]
    ms += s.ms
    if (isMusic(s)) { musicMs += s.ms; if (isPlay(s, ctx.minMs)) { plays++; tracks.add(trackKey(s)); artists.add(s.artist) } }
    else if (isTalk(s)) talkMs += s.ms
    days.add(dayOf(ctx.loc[i]))
  }
  return { streams: ctx.s.length, plays, ms, musicMs, talkMs, tracks: tracks.size, artists: artists.size, activeDays: days.size, from: ctx.s[0]?.ts ?? 0, to: ctx.s.at(-1)?.ts ?? 0 }
}

// ---------- Top lists ----------

export type TopBy = 'track' | 'artist' | 'album' | 'show'
export type Metric = 'ms' | 'plays'
export interface TopRow { key: string; name: string; sub: string; uri: string; plays: number; ms: number; rank: number }

export function top(ctx: Ctx, by: TopBy, metric: Metric = 'ms', n = 50): TopRow[] {
  const map = new Map<string, TopRow>()
  for (const s of ctx.s) {
    if (by === 'show' ? !isTalk(s) : !isMusic(s)) continue
    if (by === 'album' && !s.album) continue
    const key = by === 'track' ? trackKey(s) : by === 'album' ? albumKey(s) : s.artist
    let r = map.get(key)
    if (!r) map.set(key, r = { key, name: by === 'track' ? s.track : by === 'album' ? s.album : s.artist, sub: by === 'track' || by === 'album' ? s.artist : '', uri: '', plays: 0, ms: 0, rank: 0 })
    r.ms += s.ms
    if (isPlay(s, ctx.minMs)) r.plays++
    if (!r.uri && by === 'track' && s.uri) r.uri = s.uri
  }
  const list = [...map.values()].filter(r => r.plays > 0 || metric === 'ms')
  list.sort((a, b) => metric === 'ms' ? b.ms - a.ms || b.plays - a.plays : b.plays - a.plays || b.ms - a.ms)
  return list.slice(0, n).map((r, i) => ({ ...r, rank: i + 1 }))
}

// ---------- Skips ----------

/** A skip: Spotify flagged it, the user pressed next, or (basic export, no reason fields) it stopped before a play. */
export const isSkip = (s: Stream, minMs: number) => s.skipped === true || s.re === 'fwdbtn' || (s.re === undefined && s.skipped === undefined && s.ms < minMs)

export interface SkipRow { key: string; name: string; artist: string; uri: string; starts: number; skips: number; rate: number }

export function skipStats(ctx: Ctx, minStarts = 5, minRate = 0.6, n = 50) {
  let starts = 0, skips = 0
  const per = new Map<string, SkipRow>()
  for (const s of ctx.s) {
    if (!isMusic(s)) continue
    starts++
    const sk = isSkip(s, ctx.minMs)
    if (sk) skips++
    const k = trackKey(s)
    let r = per.get(k)
    if (!r) per.set(k, r = { key: k, name: s.track, artist: s.artist, uri: s.uri, starts: 0, skips: 0, rate: 0 })
    r.starts++
    if (sk) r.skips++
    if (!r.uri && s.uri) r.uri = s.uri
  }
  const always = [...per.values()].map(r => ({ ...r, rate: r.skips / r.starts }))
    .filter(r => r.starts >= minStarts && r.rate >= minRate)
    .sort((a, b) => b.skips - a.skips || b.rate - a.rate)
    .slice(0, n)
  return { starts, skips, rate: starts ? skips / starts : 0, always }
}

// ---------- Per-track history: first listen, peak era, lost favourites ----------

export interface TrackStat { key: string; name: string; artist: string; album: string; uri: string; plays: number; ms: number; first: number; firstLoc: number; last: number; lastLoc: number; months: Map<string, number>; peakMonth: string; peakPlays: number }

export function trackIndex(ctx: Ctx): Map<string, TrackStat> {
  const map = new Map<string, TrackStat>()
  for (let i = 0; i < ctx.s.length; i++) {
    const s = ctx.s[i]
    if (!isMusic(s) || !isPlay(s, ctx.minMs)) continue
    const k = trackKey(s)
    let t = map.get(k)
    if (!t) map.set(k, t = { key: k, name: s.track, artist: s.artist, album: s.album, uri: s.uri, plays: 0, ms: 0, first: s.ts, firstLoc: ctx.loc[i], last: s.ts, lastLoc: ctx.loc[i], months: new Map(), peakMonth: '', peakPlays: 0 })
    t.plays++; t.ms += s.ms
    t.last = s.ts; t.lastLoc = ctx.loc[i]
    if (!t.uri && s.uri) t.uri = s.uri
    const m = ymOf(ctx.loc[i])
    const c = (t.months.get(m) ?? 0) + 1
    t.months.set(m, c)
    if (c > t.peakPlays) { t.peakPlays = c; t.peakMonth = m }
  }
  return map
}

/** Tracks whose title, artist or album contains the query, oldest first listen first. */
export function firstListens(index: Map<string, TrackStat>, query: string, n = 40): TrackStat[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return [...index.values()].filter(t => t.name.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q))
    .sort((a, b) => b.plays - a.plays).slice(0, n)
}

/** First time each artist was played (ms since epoch), plus their total plays. */
export function artistFirsts(ctx: Ctx) {
  const map = new Map<string, { artist: string; first: number; firstLoc: number; firstTrack: string; plays: number }>()
  for (let i = 0; i < ctx.s.length; i++) {
    const s = ctx.s[i]
    if (!isMusic(s) || !isPlay(s, ctx.minMs)) continue
    const a = map.get(s.artist)
    if (a) a.plays++
    else map.set(s.artist, { artist: s.artist, first: s.ts, firstLoc: ctx.loc[i], firstTrack: s.track, plays: 1 })
  }
  return map
}

export interface LostFavourite extends TrackStat { daysSince: number }

/** Heavily played, then abandoned: at least `minPlays` plays, none in the last `quietDays` of the history. */
export function lostFavourites(index: Map<string, TrackStat>, endLoc: number, opts: { quietDays?: number; minPlays?: number; n?: number } = {}): LostFavourite[] {
  const { quietDays = 180, minPlays = 10, n = 50 } = opts
  return [...index.values()]
    .filter(t => t.plays >= minPlays && endLoc - t.lastLoc >= quietDays * DAY)
    .map(t => ({ ...t, daysSince: Math.floor((endLoc - t.lastLoc) / DAY) }))
    .sort((a, b) => b.peakPlays - a.peakPlays || b.plays - a.plays)
    .slice(0, n)
}

// ---------- Listening clock ----------

/** Minutes by weekday (Mon = 0) x local hour, flattened as weekday * 24 + hour. */
export function clock(ctx: Ctx): number[] {
  const out = new Array<number>(168).fill(0)
  for (let i = 0; i < ctx.s.length; i++) out[weekdayOf(ctx.loc[i]) * 24 + hourOf(ctx.loc[i])] += ctx.s[i].ms / 60_000
  return out
}

export function peakHour(cl: number[]) {
  const byHour = new Array<number>(24).fill(0)
  const byDay = new Array<number>(7).fill(0)
  cl.forEach((v, i) => { byHour[i % 24] += v; byDay[Math.floor(i / 24)] += v })
  return { hour: byHour.indexOf(Math.max(...byHour)), weekday: byDay.indexOf(Math.max(...byDay)), byHour, byDay }
}

// ---------- Sessions ----------

export interface Session { start: number; end: number; ms: number; n: number }

export function sessions(ctx: Ctx): Session[] {
  const out: Session[] = []
  let cur: Session | null = null
  let curEnd = 0
  for (let i = 0; i < ctx.s.length; i++) {
    const s = ctx.s[i]
    const start = ctx.loc[i]
    const end = start + s.ms
    if (!cur || start - curEnd > ctx.gapMs) {
      cur = { start, end, ms: 0, n: 0 }
      out.push(cur)
      curEnd = end
    }
    cur.ms += s.ms; cur.n++
    if (end > curEnd) curEnd = end
    cur.end = curEnd
  }
  return out
}

export function sessionStats(list: Session[]) {
  if (!list.length) return { count: 0, avgMin: 0, medianMin: 0, longest: null as Session | null }
  const mins = list.map(s => (s.end - s.start) / 60_000).sort((a, b) => a - b)
  const longest = list.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a))
  return { count: list.length, avgMin: mins.reduce((a, b) => a + b, 0) / mins.length, medianMin: mins[Math.floor(mins.length / 2)], longest }
}

// ---------- Streaks ----------

export interface Streak { days: number; from: string; to: string }

/** Longest run of consecutive local days in a sorted, de-duplicated list of day numbers. */
export function longestRun(days: number[]): Streak {
  let best = { days: 0, from: 0, to: 0 }, start = 0
  for (let i = 0; i < days.length; i++) {
    if (i === 0 || days[i] !== days[i - 1] + 1) start = days[i]
    const len = days[i] - start + 1
    if (len > best.days) best = { days: len, from: start, to: days[i] }
  }
  return { days: best.days, from: best.days ? dateOf(best.from) : '', to: best.days ? dateOf(best.to) : '' }
}

export function streaks(ctx: Ctx) {
  const all = new Set<number>()
  const byArtist = new Map<string, Set<number>>()
  for (let i = 0; i < ctx.s.length; i++) {
    const s = ctx.s[i]
    if (!isPlay(s, ctx.minMs)) continue
    const d = dayOf(ctx.loc[i])
    all.add(d)
    if (isMusic(s)) { let set = byArtist.get(s.artist); if (!set) byArtist.set(s.artist, set = new Set()); set.add(d) }
  }
  const days = [...all].sort((a, b) => a - b)
  const longest = longestRun(days)
  let current = 0
  if (days.length) { current = 1; for (let i = days.length - 1; i > 0 && days[i - 1] === days[i] - 1; i--) current++ }
  let artist = { artist: '', days: 0, from: '', to: '' }
  for (const [a, set] of byArtist) {
    if (set.size <= artist.days) continue
    const r = longestRun([...set].sort((x, y) => x - y))
    if (r.days > artist.days) artist = { artist: a, ...r }
  }
  return { longest, current, activeDays: days.length, artist }
}

// ---------- Discovery ----------

export interface DiscoveryMonth { month: string; newArtists: number; artists: number; rate: number; examples: string[] }

/** New artists per local month. "New" means first play ever in this history (so pass the unsliced context). */
export function discovery(ctx: Ctx): DiscoveryMonth[] {
  const firsts = artistFirsts(ctx)
  const perMonth = new Map<string, Set<string>>()
  for (let i = 0; i < ctx.s.length; i++) {
    const s = ctx.s[i]
    if (!isMusic(s) || !isPlay(s, ctx.minMs)) continue
    const m = ymOf(ctx.loc[i])
    let set = perMonth.get(m)
    if (!set) perMonth.set(m, set = new Set())
    set.add(s.artist)
  }
  const fresh = new Map<string, { artist: string; plays: number }[]>()
  for (const f of firsts.values()) { const m = ymOf(f.firstLoc); const l = fresh.get(m) ?? []; l.push(f); fresh.set(m, l) }
  if (!perMonth.size) return []
  const keys = [...perMonth.keys()].sort()
  return monthsBetween(keys[0], keys.at(-1)!).map(month => {
    const artists = perMonth.get(month)?.size ?? 0
    const nw = (fresh.get(month) ?? []).sort((a, b) => b.plays - a.plays)
    return { month, newArtists: nw.length, artists, rate: artists ? nw.length / artists : 0, examples: nw.slice(0, 3).map(x => x.artist) }
  })
}

// ---------- Eras ----------

export interface Era { from: string; to: string; months: number; ms: number; top: { artist: string; share: number }[] }

function cosine(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0, na = 0, nb = 0
  for (const [k, v] of a) { na += v * v; const w = b.get(k); if (w) dot += v * w }
  for (const v of b.values()) nb += v * v
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}
function topShares(m: Map<string, number>, k = 10) {
  const total = [...m.values()].reduce((a, b) => a + b, 0) || 1
  return new Map([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([a, v]) => [a, v / total]))
}

/**
 * Splits the history into eras: runs of months whose artist mix stays similar. A month starts a new era when
 * its top-10 artist shares look unlike the running era (cosine below `threshold`). One-month blips are folded back.
 */
export function eras(ctx: Ctx, threshold = 0.45, minMonthMin = 60): Era[] {
  const months = new Map<string, Map<string, number>>()
  for (let i = 0; i < ctx.s.length; i++) {
    const s = ctx.s[i]
    if (!isMusic(s)) continue
    const m = ymOf(ctx.loc[i])
    let mm = months.get(m)
    if (!mm) months.set(m, mm = new Map())
    mm.set(s.artist, (mm.get(s.artist) ?? 0) + s.ms)
  }
  const keys = [...months.keys()].sort()
  type Seg = { months: string[]; agg: Map<string, number> }
  const segs: Seg[] = []
  for (const m of keys) {
    const mm = months.get(m)!
    const total = [...mm.values()].reduce((a, b) => a + b, 0)
    const cur = segs.at(-1)
    const add = (seg: Seg) => { seg.months.push(m); for (const [a, v] of mm) seg.agg.set(a, (seg.agg.get(a) ?? 0) + v) }
    if (cur && (total < minMonthMin * 60_000 || cosine(topShares(mm), topShares(cur.agg)) >= threshold)) add(cur)
    else { const seg = { months: [], agg: new Map() }; add(seg); segs.push(seg) }
  }
  // Fold single-month eras into the neighbour they resemble most.
  for (let i = 0; i < segs.length && segs.length > 1; i++) {
    if (segs[i].months.length > 1) continue
    const prev = segs[i - 1], next = segs[i + 1]
    const sp = prev ? cosine(topShares(segs[i].agg), topShares(prev.agg)) : -1
    const sn = next ? cosine(topShares(segs[i].agg), topShares(next.agg)) : -1
    const into = sp >= sn ? prev : next
    if (!into) continue
    for (const [a, v] of segs[i].agg) into.agg.set(a, (into.agg.get(a) ?? 0) + v)
    into.months.push(...segs[i].months)
    into.months.sort()
    segs.splice(i, 1)
    i--
  }
  // Merge neighbours that ended up led by the same artist.
  for (let i = 1; i < segs.length; i++) {
    const lead = (s: Seg) => [...s.agg.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (lead(segs[i]) === lead(segs[i - 1])) {
      for (const [a, v] of segs[i].agg) segs[i - 1].agg.set(a, (segs[i - 1].agg.get(a) ?? 0) + v)
      segs[i - 1].months.push(...segs[i].months)
      segs.splice(i, 1)
      i--
    }
  }
  return segs.map(s => {
    const ms = [...s.agg.values()].reduce((a, b) => a + b, 0)
    return { from: s.months[0], to: s.months.at(-1)!, months: s.months.length, ms, top: [...s.agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([artist, v]) => ({ artist, share: v / (ms || 1) })) }
  })
}

// ---------- Monthly series ----------

export function monthly(ctx: Ctx): { month: string; ms: number; plays: number }[] {
  const map = new Map<string, { ms: number; plays: number }>()
  for (let i = 0; i < ctx.s.length; i++) {
    const m = ymOf(ctx.loc[i])
    const r = map.get(m) ?? { ms: 0, plays: 0 }
    r.ms += ctx.s[i].ms
    if (isPlay(ctx.s[i], ctx.minMs)) r.plays++
    map.set(m, r)
  }
  if (!map.size) return []
  const keys = [...map.keys()].sort()
  return monthsBetween(keys[0], keys.at(-1)!).map(month => ({ month, ...(map.get(month) ?? { ms: 0, plays: 0 }) }))
}

export const monthRange = (ctx: Ctx) => ctx.s.length ? { from: ymOf(ctx.loc[0]), to: ymOf(Math.max(...ctx.loc.slice(-50))) } : null

// ---------- Year in review (any 12 months) ----------

export function yearInReview(full: Ctx, startYm: string) {
  const endYm = addMonths(startYm, 11)
  const ctx = sliceCtx(full, startYm, endYm)
  const t = totals(ctx)
  const cl = clock(ctx)
  const ph = peakHour(cl)
  const ss = sessionStats(sessions(ctx))
  const st = streaks(ctx)
  const days = new Map<number, number>()
  for (let i = 0; i < ctx.s.length; i++) days.set(dayOf(ctx.loc[i]), (days.get(dayOf(ctx.loc[i])) ?? 0) + ctx.s[i].ms)
  const bigDay = [...days.entries()].sort((a, b) => b[1] - a[1])[0]
  const disc = discovery(full).filter(d => d.month >= startYm && d.month <= endYm)
  const firstTrack = ctx.s.find(s => isMusic(s) && isPlay(s, ctx.minMs))
  return {
    from: startYm, to: endYm, totals: t,
    topTracks: top(ctx, 'track', 'ms', 10), topArtists: top(ctx, 'artist', 'ms', 10), topAlbums: top(ctx, 'album', 'ms', 5), topShows: top(ctx, 'show', 'ms', 3),
    skip: skipStats(ctx), clock: cl, peak: ph, sessions: ss, streak: st,
    biggestDay: bigDay ? { date: dateOf(bigDay[0]), ms: bigDay[1] } : null,
    newArtists: disc.reduce((a, d) => a + d.newArtists, 0),
    months: monthly(ctx).filter(m => m.month >= startYm && m.month <= endYm),
    eras: eras(full).filter(e => e.to >= startYm && e.from <= endYm),
    firstTrack: firstTrack ? { name: firstTrack.track, artist: firstTrack.artist } : null,
  }
}
export type Review = ReturnType<typeof yearInReview>

// ---------- Noise detection: suggested exclusion rules ----------

export const NOISE_KEYWORDS = ['sleep', 'rain', 'white noise', 'brown noise', 'lullaby', 'lullabies', 'kids', 'children', 'nursery', 'baby', 'meditation', 'asmr', 'ocean waves', 'thunderstorm']

export interface Suggestion { rule: Omit<Rule, 'id' | 'on'>; why: string; ms: number; streams: number }

/** Looks for the usual Wrapped polluters: sleep and noise tracks, kids' songs, and artists you mostly play between midnight and 6 am. */
export function suggestRules(ctx: Ctx, existing: Rule[] = []): Suggestion[] {
  const out: Suggestion[] = []
  const has = (kind: string, value: string) => existing.some(r => r.kind === kind && r.value.toLowerCase() === value.toLowerCase())
  const totalMusic = ctx.s.reduce((a, s) => a + (isMusic(s) ? s.ms : 0), 0) || 1
  for (const kw of NOISE_KEYWORDS) {
    if (has('keyword', kw)) continue
    const cand: Rule = { id: '', kind: 'keyword', value: kw, on: true }
    const im = ruleReach(ctx.s, cand, ctx.tz, ctx.minMs)
    // Skip keywords that an existing rule (on or off) already mostly covers.
    if (existing.length && im.streams) {
      let covered = 0
      for (const s of ctx.s) if (ruleMatches(s, cand, ctx.tz) && existing.some(r => ruleMatches(s, r, ctx.tz))) covered++
      if (covered / im.streams >= 0.8) continue
    }
    if (im.streams >= 20 && im.ms / totalMusic >= 0.005) out.push({ rule: { kind: 'keyword', value: kw, label: `Titles containing “${kw}”` }, why: `${im.streams.toLocaleString('en-US')} streams mention “${kw}”`, ms: im.ms, streams: im.streams })
  }
  const night = new Map<string, { n: number; all: number; streams: number }>()
  for (let i = 0; i < ctx.s.length; i++) {
    const s = ctx.s[i]
    if (!isMusic(s)) continue
    const r = night.get(s.artist) ?? { n: 0, all: 0, streams: 0 }
    r.all += s.ms; r.streams++
    const h = hourOf(ctx.loc[i])
    if (h < 6) r.n += s.ms
    night.set(s.artist, r)
  }
  for (const [artist, r] of night) {
    if (r.all < 300 * 60_000 || r.n / r.all < 0.6 || has('artist', artist)) continue
    if (out.some(o => o.rule.kind === 'keyword' && artist.toLowerCase().includes(o.rule.value))) continue
    out.push({ rule: { kind: 'artist', value: artist, label: artist }, why: `${Math.round(r.n / r.all * 100)}% of ${artist} plays are between midnight and 6 am`, ms: r.all, streams: r.streams })
  }
  if (!has('podcasts', '')) {
    const talk = ctx.s.reduce((a, s) => a + (isTalk(s) ? s.ms : 0), 0)
    if (talk > 60 * 60_000) out.push({ rule: { kind: 'podcasts', value: '', label: 'Podcasts and audiobooks' }, why: 'Keeps talk time out of minutes totals and the clock', ms: talk, streams: ctx.s.filter(isTalk).length })
  }
  if (!has('incognito', '')) {
    const inc = ctx.s.filter(s => s.incognito)
    if (inc.length) out.push({ rule: { kind: 'incognito', value: '', label: 'Private session streams' }, why: 'Spotify itself leaves these out of Wrapped', ms: inc.reduce((a, s) => a + s.ms, 0), streams: inc.length })
  }
  return out.sort((a, b) => b.ms - a.ms)
}

// ---------- Snapshots and compare ----------

export interface Snapshot {
  id: string
  at: number
  label: string
  from: number
  to: number
  streams: number
  plays: number
  ms: number
  tracks: number
  artists: number
  topArtists: { name: string; ms: number; plays: number }[]
  topTracks: { name: string; artist: string; uri: string; ms: number; plays: number }[]
  months: Record<string, number>
}

/** Derived aggregates only: this is what syncs, never the raw rows. */
export function snapshot(ctx: Ctx, id: string, label: string, at = Date.now()): Snapshot {
  const t = totals(ctx)
  return {
    id, at, label, from: t.from, to: t.to, streams: t.streams, plays: t.plays, ms: t.ms, tracks: t.tracks, artists: t.artists,
    topArtists: top(ctx, 'artist', 'ms', 25).map(r => ({ name: r.name, ms: Math.round(r.ms), plays: r.plays })),
    topTracks: top(ctx, 'track', 'ms', 25).map(r => ({ name: r.name, artist: r.sub, uri: r.uri, ms: Math.round(r.ms), plays: r.plays })),
    months: Object.fromEntries(monthly(ctx).map(m => [m.month, Math.round(m.ms)])),
  }
}

export interface RankChange { name: string; before: number | null; after: number | null; delta: number | null }

export function compareSnapshots(a: Snapshot, b: Snapshot) {
  const rank = (list: { name: string }[]) => new Map(list.map((x, i) => [x.name, i + 1]))
  const ra = rank(a.topArtists), rb = rank(b.topArtists)
  const changes: RankChange[] = []
  for (const [name, after] of rb) { const before = ra.get(name) ?? null; changes.push({ name, before, after, delta: before === null ? null : before - after }) }
  for (const [name, before] of ra) if (!rb.has(name)) changes.push({ name, before, after: null, delta: null })
  const newMonths = Object.keys(b.months).filter(m => !(m in a.months)).sort()
  const changedMonths = Object.keys(b.months).filter(m => m in a.months && Math.abs(b.months[m] - a.months[m]) > 60_000).sort()
  return {
    addedStreams: b.streams - a.streams, addedPlays: b.plays - a.plays, addedMs: b.ms - a.ms,
    addedArtists: b.artists - a.artists, addedTracks: b.tracks - a.tracks,
    extendedBy: Math.max(0, b.to - a.to), newMonths, changedMonths,
    entered: changes.filter(c => c.before === null && c.after! <= 10),
    left: changes.filter(c => c.after === null && c.before! <= 10),
    moved: changes.filter(c => c.delta !== null && c.delta !== 0 && Math.min(c.before!, c.after!) <= 10).sort((x, y) => Math.abs(y.delta!) - Math.abs(x.delta!)),
  }
}

// ---------- Exports ----------

const cell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
export const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map(r => r.map(cell).join(',')).join('\n') + '\n'

/** spotify:track:... lines; paste them into a Spotify desktop playlist. Rows without a URI (basic export) are skipped. */
export const uriList = (rows: { uri: string }[]) => [...new Set(rows.map(r => r.uri).filter(u => u.startsWith('spotify:track:')))].join('\n')
export const openUrl = (uri: string) => uri.startsWith('spotify:') ? `https://open.spotify.com/${uri.split(':')[1]}/${uri.split(':')[2]}` : ''
