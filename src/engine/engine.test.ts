import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { detectKind, isHistoryName, mergeStreams, offlineEnd, parseFile, parseJson, parseMany, parseTs } from './parse.ts'
import {
  addMonths, applyRules, buildCtx, clock, compareSnapshots, discovery, eras, firstListens, isSkip, longestRun, lostFavourites, monthsBetween,
  peakHour, prepare, sessionStats, totals, ruleMatches, sessions, skipStats, sliceCtx, snapshot, streaks, suggestRules, top, toCsv, trackIndex, tzOffset, uriList, yearInReview,
} from './analyze.ts'
import { SAMPLES, generate, sampleRules } from './sample.ts'
import type { Rule, Settings, Stream } from './types.ts'

const S: Settings = { minPlaySec: 30, tz: 'UTC', sessionGapMin: 20, rules: [] }
const MIN = 60_000
let n = 0
/** A stream that starts at `start` (ISO) and lasts `ms`. */
function st(start: string, ms: number, artist: string, track: string, extra: Partial<Stream> = {}): Stream {
  const t0 = Date.parse(start)
  return { ts: t0 + ms, ms, track, artist, album: extra.album ?? `${artist} LP`, uri: extra.uri ?? `spotify:track:${artist.slice(0, 3)}${track.slice(0, 3)}${n++}`, kind: 'track', ...extra }
}
const ctxOf = (list: Stream[], s: Partial<Settings> = {}) => buildCtx(list, { ...S, ...s })

// ---------- Parsing ----------

test('detects extended audio, video, basic music and podcast files', () => {
  assert.equal(detectKind('Streaming_History_Audio_2023-2024_3.json', [{ ts: '2024-01-01T00:00:00Z', ms_played: 1 }]), 'extended-audio')
  assert.equal(detectKind('Streaming_History_Video_2024.json', [{ ts: '2024-01-01T00:00:00Z', ms_played: 1 }]), 'extended-video')
  assert.equal(detectKind('StreamingHistory_music_0.json', [{ endTime: '2024-01-01 10:00', msPlayed: 1, trackName: 'x' }]), 'basic-music')
  assert.equal(detectKind('StreamingHistory_podcast_0.json', [{ endTime: '2024-01-01 10:00', msPlayed: 1, podcastName: 'x' }]), 'basic-podcast')
  assert.equal(detectKind('Userdata.json', { username: 'x' }), 'ignored')
  assert.ok(isHistoryName('Spotify Extended Streaming History/Streaming_History_Audio_2019-2020_0.json'))
  assert.ok(isHistoryName('MyData/StreamingHistory_music_1.json'))
  assert.ok(!isHistoryName('MyData/Playlist1.json'))
})

test('basic export timestamps are minute-precision UTC', () => {
  assert.equal(parseTs('2024-03-01 13:45'), Date.UTC(2024, 2, 1, 13, 45))
  assert.equal(parseTs('2024-03-01T13:45:10Z'), Date.UTC(2024, 2, 1, 13, 45, 10))
  assert.ok(Number.isNaN(parseTs('yesterday')))
})

test('extended rows map tracks, episodes and keep reason, shuffle, skip and incognito fields', () => {
  const rows = [
    { ts: '2024-05-01T08:03:00Z', ms_played: 200000, conn_country: 'PT', master_metadata_track_name: 'Song', master_metadata_album_artist_name: 'Band', master_metadata_album_album_name: 'Album', spotify_track_uri: 'spotify:track:abc', reason_start: 'clickrow', reason_end: 'trackdone', shuffle: true, skipped: false, incognito_mode: true, ip_addr: '1.2.3.4' },
    { ts: '2024-05-01T09:00:00Z', ms_played: 1800000, master_metadata_track_name: null, episode_name: 'Ep 1', episode_show_name: 'Show', spotify_episode_uri: 'spotify:episode:e1' },
    { ts: '2024-05-01T09:30:00Z', ms_played: 5000, master_metadata_track_name: null, episode_name: null },
    { ts: 'nope', ms_played: 1 },
  ]
  const r = parseFile('Streaming_History_Audio_2024.json', rows)
  assert.equal(r.streams.length, 2)
  assert.equal(r.report.skipped, 2)
  const [a, b] = r.streams
  assert.deepEqual([a.kind, a.artist, a.album, a.uri, a.rs, a.re, a.shuffle, a.skipped, a.incognito, a.country], ['track', 'Band', 'Album', 'spotify:track:abc', 'clickrow', 'trackdone', true, false, true, 'PT'])
  assert.ok(!('ip_addr' in a), 'IP addresses are never kept')
  assert.deepEqual([b.kind, b.artist, b.track], ['episode', 'Show', 'Ep 1'])
  assert.deepEqual(r.issues.map(i => [i.row, i.level]), [[3, 'warn'], [4, 'error']])
})

test('overlapping basic and extended files de-duplicate and keep the row with a URI', () => {
  const ext = parseFile('Streaming_History_Audio_2024.json', [{ ts: '2024-05-01T08:03:41Z', ms_played: 200000, master_metadata_track_name: 'Song', master_metadata_album_artist_name: 'Band', spotify_track_uri: 'spotify:track:abc' }]).streams
  const basic = parseFile('StreamingHistory_music_0.json', [{ endTime: '2024-05-01 08:03', artistName: 'Band', trackName: 'Song', msPlayed: 200000 }, { endTime: '2024-05-02 08:03', artistName: 'Band', trackName: 'Song', msPlayed: 200000 }]).streams
  const merged = mergeStreams(basic, ext)
  assert.equal(merged.length, 2)
  assert.equal(merged[0].uri, 'spotify:track:abc')
  const again = parseMany([{ name: 'a.json', rows: [{ endTime: '2024-05-02 08:03', artistName: 'Band', trackName: 'Song', msPlayed: 200000 }] }, { name: 'b.json', rows: [{ endTime: '2024-05-02 08:03', artistName: 'Band', trackName: 'Song', msPlayed: 200000 }] }])
  assert.equal(again.streams.length, 1, 're-importing the same request does not double count')
})

// ---------- Real export layouts (fixtures/) ----------
// The fixtures copy the exact field names, key order, nulls and formatting of real exports: the 2024 extended layout
// (username, ip_addr_decrypted), the 2025 layout (ip_addr, audiobook_* fields), and the basic Account data files
// (pretty-printed with " : ", saved here with a byte-order mark). The first extended row is verbatim from a public
// Spotify Community post; track, artist and show names elsewhere are invented.

const fixture = (name: string) => ({ name: `my_spotify_data/${name}`, rows: parseJson(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) })
const FIX = ['Streaming_History_Audio_2024_0.json', 'Streaming_History_Audio_2025_1.json', 'StreamingHistory_music_0.json', 'StreamingHistory_podcast_0.json'].map(fixture)

test('real export layouts: every file is detected and every row accounted for', () => {
  const r = parseMany(FIX)
  assert.deepEqual(r.files.map(f => [f.kind, f.rows, f.kept, f.skipped]), [['extended-audio', 6, 5, 1], ['extended-audio', 2, 2, 0], ['basic-music', 5, 5, 0], ['basic-podcast', 1, 1, 0]])
  assert.deepEqual(r.groups, [{ msg: 'No track, episode or audiobook metadata (often a local file or removed content)', level: 'warn', count: 1 }])
  assert.equal(r.streams.length, 9, 'basic rows that repeat extended rows are merged')
  assert.ok(r.streams.every(s => !('ip_addr' in s) && !('username' in s)))
})

test('real export layouts: audiobooks, episodes and private sessions map to the right kinds', () => {
  const r = parseMany(FIX)
  const book = r.streams.find(s => s.kind === 'audiobook')!
  assert.deepEqual([book.track, book.artist, book.uri], ['Chapter 4', 'The Salt Road', 'spotify:episode:5cHu1Lw7NqP3sXz0Yb2KdM'])
  const ep = r.streams.filter(s => s.kind === 'episode')
  assert.equal(ep.length, 1)
  assert.equal(ep[0].uri, 'spotify:episode:0aLp9rT2xVqk3Wn8YcB5Fd', 'the extended row wins over the basic podcast row')
  assert.equal(ep[0].skipped, undefined, 'skipped: null stays unknown')
  assert.equal(r.streams.filter(s => s.incognito).length, 1)
})

test('basic endTime cut to the minute still matches the extended row one minute earlier', () => {
  const r = parseMany(FIX)
  const lh = r.streams.filter(s => s.track === 'Lighthouse Hours')
  assert.equal(lh.length, 2)
  assert.ok(lh.every(s => s.uri.startsWith('spotify:track:')))
})

test('a short song on repeat is not collapsed by de-duplication', () => {
  const row = (ts: string) => ({ ts, ms_played: 45000, master_metadata_track_name: 'Wiggle', master_metadata_album_artist_name: 'Kids', spotify_track_uri: 'spotify:track:w' })
  assert.equal(parseMany([{ name: 'Streaming_History_Audio_2024.json', rows: [row('2024-05-01T08:00:50Z'), row('2024-05-01T08:01:35Z'), row('2024-05-01T08:02:20Z')] }]).streams.length, 3)
})

test('offline plays use offline_timestamp when ts is a later sync time', () => {
  const r = parseMany(FIX)
  const u = r.streams.find(s => s.track === 'Underpass')!
  assert.equal(u.ts, 1721719800_000 + 198000, 'played 23 Jul 07:30 UTC, synced 24 Jul')
  const ts = Date.UTC(2024, 6, 24, 18), ms = 200_000
  assert.equal(offlineEnd(ts, ms, false, 1721719800), ts, 'only offline rows are moved')
  assert.equal(offlineEnd(ts, ms, true, 0), ts, 'zero means unknown')
  assert.equal(offlineEnd(ts, ms, true, ts - ms - 2000), ts, 'a few seconds apart: keep ts')
  assert.equal(offlineEnd(ts, ms, true, Date.UTC(2024, 6, 23)), Date.UTC(2024, 6, 23) + ms, 'millisecond values from older exports')
  assert.equal(offlineEnd(ts, ms, true, (ts + 3_600_000) / 1000), ts, 'a start after ts is implausible')
})

test('zip entries: macOS resource forks are ignored, old endsong and endvideo files are read', () => {
  assert.ok(!isHistoryName('__MACOSX/Spotify Extended Streaming History/._Streaming_History_Audio_2019_0.json'))
  assert.ok(!isHistoryName('Spotify Extended Streaming History/._Streaming_History_Audio_2019_0.json'))
  assert.ok(isHistoryName('MyData/endsong_3.json'))
  assert.ok(isHistoryName('MyData/endvideo.json'))
  assert.equal(detectKind('MyData/endvideo.json', [{ ts: '2022-01-01T00:00:00Z', ms_played: 1 }]), 'extended-video')
})

// ---------- Time ----------

test('timezone offsets follow daylight saving time', () => {
  assert.equal(tzOffset(Date.UTC(2024, 0, 15, 12), 'America/New_York'), -5 * 3_600_000)
  assert.equal(tzOffset(Date.UTC(2024, 6, 15, 12), 'America/New_York'), -4 * 3_600_000)
  assert.equal(tzOffset(Date.UTC(2024, 6, 15, 12), 'Asia/Kolkata'), 5.5 * 3_600_000)
  assert.equal(addMonths('2024-11', 3), '2025-02')
  assert.equal(monthsBetween('2024-11', '2025-02').length, 4)
})

test('the listening clock uses local time and the start of the stream', () => {
  // Ends 01:02 UTC on Tue 2 Jan 2024 after 4 minutes, so it started 00:58 UTC = Mon 19:58 in New York.
  const s = st('2024-01-02T00:58:00Z', 4 * MIN, 'A', 'x')
  const utc = clock(ctxOf([s]))
  const ny = clock(ctxOf([s], { tz: 'America/New_York' }))
  assert.equal(utc[1 * 24 + 0], 4)
  assert.equal(ny[0 * 24 + 19], 4)
  assert.equal(peakHour(ny).hour, 19)
  assert.equal(peakHour(ny).weekday, 0)
})

// ---------- Plays, tops, skips ----------

test('a play needs 30 seconds by default and the threshold is configurable', () => {
  const list = [st('2024-01-01T10:00:00Z', 29_000, 'A', 'short'), st('2024-01-01T10:01:00Z', 31_000, 'A', 'ok'), st('2024-01-01T10:02:00Z', 50_000, 'A', 'ok')]
  assert.equal(top(ctxOf(list), 'artist', 'plays')[0].plays, 2)
  assert.equal(top(ctxOf(list, { minPlaySec: 45 }), 'artist', 'plays')[0].plays, 1)
  assert.equal(top(ctxOf(list, { minPlaySec: 10 }), 'artist', 'plays')[0].plays, 3)
})

test('top tracks rank by minutes or by plays, and albums group by artist + album', () => {
  const list = [
    ...Array.from({ length: 5 }, (_, i) => st(`2024-01-0${i + 1}T10:00:00Z`, 40_000, 'A', 'Many short', { uri: 'spotify:track:many' })),
    st('2024-01-01T12:00:00Z', 30 * MIN, 'B', 'One long', { uri: 'spotify:track:long' }),
  ]
  const c = ctxOf(list)
  assert.equal(top(c, 'track', 'ms')[0].name, 'One long')
  assert.equal(top(c, 'track', 'plays')[0].name, 'Many short')
  assert.equal(top(c, 'track', 'plays')[0].uri, 'spotify:track:many')
  assert.equal(top(c, 'album', 'ms')[0].name, 'B LP')
  assert.deepEqual(top(c, 'artist', 'ms').map(r => r.rank), [1, 2])
})

test('podcasts never enter music tops but rank as shows', () => {
  const ep: Stream = { ts: Date.UTC(2024, 0, 1, 9), ms: 60 * MIN, track: 'Ep', artist: 'Show', album: 'Show', uri: 'spotify:episode:1', kind: 'episode' }
  const c = ctxOf([ep, st('2024-01-01T10:00:00Z', 3 * MIN, 'A', 'x')])
  assert.deepEqual(top(c, 'artist').map(r => r.name), ['A'])
  assert.deepEqual(top(c, 'show').map(r => r.name), ['Show'])
})

test('skip detection uses the skipped flag, the next button, and short plays only when there are no reason fields', () => {
  assert.ok(isSkip({ skipped: true, ms: 200_000 } as Stream, 30_000))
  assert.ok(isSkip({ re: 'fwdbtn', ms: 200_000 } as Stream, 30_000))
  assert.ok(!isSkip({ re: 'endplay', skipped: false, ms: 5_000 } as Stream, 30_000), 'stopping playback is not a skip')
  assert.ok(isSkip({ ms: 5_000 } as Stream, 30_000), 'basic export: short = skip')
})

test('"songs you always skip" needs enough starts and a high skip rate', () => {
  const list: Stream[] = []
  for (let i = 0; i < 6; i++) list.push(st(`2024-01-0${i + 1}T10:00:00Z`, 5_000, 'A', 'Annoying', { re: 'fwdbtn', uri: 'spotify:track:ann' }))
  for (let i = 0; i < 6; i++) list.push(st(`2024-01-0${i + 1}T11:00:00Z`, 200_000, 'B', 'Loved', { re: 'trackdone' }))
  for (let i = 0; i < 2; i++) list.push(st(`2024-01-0${i + 1}T12:00:00Z`, 5_000, 'C', 'Rare', { re: 'fwdbtn' }))
  const s = skipStats(ctxOf(list))
  assert.deepEqual(s.always.map(r => r.name), ['Annoying'])
  assert.equal(s.rate, 8 / 14)
  assert.equal(uriList(s.always), 'spotify:track:ann')
})

// ---------- Exclusion rules ----------

test('exclusion rules match artists, tracks, keywords, dates, incognito and podcasts', () => {
  const s = st('2024-03-10T23:30:00Z', 3 * MIN, 'Quiet Hours', 'Rain for Sleep', { incognito: true })
  const r = (kind: Rule['kind'], value = '', to?: string): Rule => ({ id: kind, kind, value, to, on: true })
  assert.ok(ruleMatches(s, r('artist', 'quiet hours')))
  assert.ok(ruleMatches(s, r('track', 'quiet hours\u0000rain for sleep')))
  assert.ok(ruleMatches(s, r('keyword', 'SLEEP')))
  assert.ok(!ruleMatches(s, r('keyword', '')))
  assert.ok(ruleMatches(s, r('incognito')))
  assert.ok(!ruleMatches(s, r('podcasts')))
  assert.ok(ruleMatches(s, r('dates', '2024-03-01', '2024-03-10')))
  // 23:30 UTC on the 10th is already the 11th in Tokyo.
  assert.ok(!ruleMatches(s, r('dates', '2024-03-01', '2024-03-10'), 'Asia/Tokyo'))
})

test('rules recompute everything and credit each removed stream to one rule', () => {
  const list = [
    ...Array.from({ length: 10 }, (_, i) => st(`2024-01-01T0${i % 6}:00:00Z`, 3 * MIN, 'Quiet Hours', 'Rain for Sleep')),
    st('2024-01-01T18:00:00Z', 4 * MIN, 'Band', 'Real song'),
  ]
  const rules: Rule[] = [{ id: 'k', kind: 'keyword', value: 'sleep', on: true }, { id: 'a', kind: 'artist', value: 'Quiet Hours', on: true }]
  const r = applyRules(list, rules)
  assert.equal(r.kept.length, 1)
  assert.equal(r.impact.k.streams, 10)
  assert.equal(r.impact.a.streams, 0)
  const before = prepare(list, S).ctx, after = prepare(list, { ...S, rules }).ctx
  assert.equal(top(before, 'track')[0].name, 'Rain for Sleep')
  assert.equal(top(after, 'track')[0].name, 'Real song')
  assert.equal(peakHour(clock(after)).hour, 18)
  const off = prepare(list, { ...S, rules: rules.map(x => ({ ...x, on: false })) })
  assert.equal(off.removed, 0)
})

test('the sleep-sounds sample is fixed by its suggested rule', () => {
  const def = SAMPLES.find(s => s.id === 'theo')!
  const list = generate(def)
  const base = prepare(list, { ...S, tz: def.tz })
  assert.match(top(base.ctx, 'track', 'ms', 1)[0].sub, /Quiet Hours/)
  const sugg = suggestRules(base.ctx)
  assert.ok(sugg.some(x => x.rule.kind === 'keyword' && x.rule.value === 'sleep'))
  const rules = sampleRules(def, () => crypto.randomUUID()).map(r => ({ ...r, on: true }))
  const after = suggestRules(base.ctx, rules)
  assert.ok(!after.some(x => ['sleep', 'rain', 'brown noise'].includes(x.rule.value)), 'keywords already covered by a rule are not suggested again')
  const fixed = prepare(list, { ...S, tz: def.tz, rules })
  const top5 = top(fixed.ctx, 'track', 'ms', 5)
  assert.ok(top5.every(t => !/Quiet Hours|Puddle/.test(t.sub)), 'no noise left in the top 5')
  assert.ok(peakHour(clock(fixed.ctx)).hour > 5, 'peak hour is no longer the middle of the night')
})

// ---------- Sessions, streaks, discovery ----------

test('sessions split on gaps longer than the setting', () => {
  const list = [st('2024-01-01T10:00:00Z', 3 * MIN, 'A', '1'), st('2024-01-01T10:05:00Z', 3 * MIN, 'A', '2'), st('2024-01-01T11:00:00Z', 3 * MIN, 'A', '3')]
  assert.equal(sessions(ctxOf(list)).length, 2)
  assert.equal(sessions(ctxOf(list, { sessionGapMin: 60 })).length, 1)
  assert.equal(sessions(ctxOf(list))[0].n, 2)
})

test('session median is the middle value, or the mean of the two middle values', () => {
  const mk = (mins: number[]) => mins.map((m, i) => ({ start: i * 1e7, end: i * 1e7 + m * MIN, ms: m * MIN, n: 1 }))
  assert.equal(sessionStats(mk([10, 30, 20])).medianMin, 20)
  assert.equal(sessionStats(mk([10, 40, 20, 30])).medianMin, 25)
})

test('active days count only days with a music play, not podcast-only or 0 ms days', () => {
  const list = [st('2024-01-01T10:00:00Z', 3 * MIN, 'A', '1'), st('2024-01-02T10:00:00Z', 0, 'A', '1'), { ...st('2024-01-03T10:00:00Z', 30 * MIN, 'Show', 'Ep'), kind: 'episode' as const }]
  const t = totals(ctxOf(list))
  assert.deepEqual([t.activeDays, t.plays, t.streams], [1, 1, 3])
})

test('streaks count consecutive local days, including the longest single-artist run', () => {
  assert.deepEqual(longestRun([1, 2, 3, 7, 8]), { days: 3, from: '1970-01-02', to: '1970-01-04' })
  const list = ['01', '02', '03', '05', '06'].map(d => st(`2024-01-${d}T12:00:00Z`, 3 * MIN, 'A', d))
  list.push(st('2024-01-04T12:00:00Z', 3 * MIN, 'B', 'x'))
  const s = streaks(ctxOf(list))
  assert.equal(s.longest.days, 6)
  assert.equal(s.current, 6)
  assert.deepEqual([s.artist.artist, s.artist.days], ['A', 3])
})

test('discovery rate counts first-ever plays per month, with empty months filled', () => {
  const list = [st('2024-01-05T12:00:00Z', 3 * MIN, 'A', 'x'), st('2024-01-06T12:00:00Z', 3 * MIN, 'B', 'x'), st('2024-03-05T12:00:00Z', 3 * MIN, 'A', 'y'), st('2024-03-06T12:00:00Z', 3 * MIN, 'C', 'x')]
  const d = discovery(ctxOf(list))
  assert.deepEqual(d.map(x => [x.month, x.newArtists, x.artists]), [['2024-01', 2, 2], ['2024-02', 0, 0], ['2024-03', 1, 2]])
  assert.equal(d[2].rate, 0.5)
})

// ---------- First listens, lost favourites, eras ----------

test('first listen and peak month per track', () => {
  const list = [st('2022-06-01T12:00:00Z', 3 * MIN, 'A', 'Golden'), ...Array.from({ length: 4 }, (_, i) => st(`2023-02-0${i + 1}T12:00:00Z`, 3 * MIN, 'A', 'Golden'))]
  const ix = trackIndex(ctxOf(list))
  const [g] = firstListens(ix, 'gold')
  assert.equal(new Date(g.first).toISOString().slice(0, 10), '2022-06-01')
  assert.equal(g.plays, 5)
  assert.equal(g.peakMonth, '2023-02')
  assert.equal(firstListens(ix, '  ').length, 0)
})

test('lost favourites are heavily played, then silent for the quiet window', () => {
  const list: Stream[] = []
  for (let i = 1; i <= 12; i++) list.push(st(`2023-01-${String(i).padStart(2, '0')}T12:00:00Z`, 3 * MIN, 'A', 'Old flame'))
  for (let i = 1; i <= 12; i++) list.push(st(`2023-01-${String(i).padStart(2, '0')}T13:00:00Z`, 3 * MIN, 'B', 'Still loved'))
  list.push(st('2024-01-01T12:00:00Z', 3 * MIN, 'B', 'Still loved'))
  const c = ctxOf(list)
  const lost = lostFavourites(trackIndex(c), c.loc[c.loc.length - 1])
  assert.deepEqual(lost.map(t => t.name), ['Old flame'])
  assert.ok(lost[0].daysSince >= 350)
  assert.equal(lostFavourites(trackIndex(c), c.loc[c.loc.length - 1], { quietDays: 400 }).length, 0)
})

test('era detection splits months dominated by different artists and folds one-month blips', () => {
  const list: Stream[] = []
  const month = (m: string, artist: string, plays = 40) => { for (let i = 0; i < plays; i++) list.push(st(`${m}-${String(1 + (i % 27)).padStart(2, '0')}T12:${String(i % 60).padStart(2, '0')}:00Z`, 3 * MIN, artist, `t${i % 5}`)) }
  for (const m of ['2023-01', '2023-02', '2023-03', '2023-04']) month(m, 'Folk Band')
  month('2023-05', 'Random One')
  for (const m of ['2023-06', '2023-07', '2023-08']) month(m, 'Synth Duo')
  const e = eras(ctxOf(list))
  assert.equal(e.length, 2)
  assert.equal(e[0].top[0].artist, 'Folk Band')
  assert.equal(e[1].top[0].artist, 'Synth Duo')
  assert.equal(e[0].months + e[1].months, 8)
})

test('a long break in the data ends an era, even with the same artists', () => {
  const list: Stream[] = []
  const month = (m: string, artist: string) => { for (let i = 0; i < 30; i++) list.push(st(`${m}-${String(1 + (i % 27)).padStart(2, '0')}T12:00:00Z`, 3 * MIN, artist, `t${i % 5}`)) }
  for (const m of ['2021-01', '2021-02', '2021-03']) month(m, 'The Jam')
  for (const m of ['2024-06', '2024-07']) month(m, 'The Jam')
  const e = eras(ctxOf(list))
  assert.deepEqual(e.map(x => [x.from, x.to, x.months]), [['2021-01', '2021-03', 3], ['2024-06', '2024-07', 2]])
})

test('the five-year sample shows distinct eras and lost favourites', () => {
  const def = SAMPLES.find(s => s.id === 'ines')!
  const { ctx } = prepare(generate(def), { ...S, tz: def.tz })
  const e = eras(ctx)
  assert.ok(e.length >= 3, `found ${e.length} eras`)
  assert.equal(new Set(e.map(x => x.top[0].artist)).size, e.length)
  assert.ok(lostFavourites(trackIndex(ctx), ctx.loc[ctx.loc.length - 1]).length > 5)
})

// ---------- Year in review, snapshots, exports ----------

test('year in review covers exactly 12 local months starting anywhere', () => {
  const list = [st('2023-03-31T23:30:00Z', 3 * MIN, 'Before', 'x'), st('2023-04-15T12:00:00Z', 3 * MIN, 'In', 'x'), st('2024-03-31T12:00:00Z', 3 * MIN, 'In', 'y'), st('2024-04-01T12:00:00Z', 3 * MIN, 'After', 'x')]
  const c = ctxOf(list)
  const y = yearInReview(c, '2023-04')
  assert.equal(y.to, '2024-03')
  assert.equal(y.totals.streams, 2)
  assert.deepEqual(y.topArtists.map(a => a.name), ['In'])
  // In Lisbon (UTC+1 in summer, but UTC in March) vs Tokyo: 23:30 UTC on 31 March is April in Tokyo.
  assert.equal(yearInReview(ctxOf(list, { tz: 'Asia/Tokyo' }), '2023-04').totals.streams, 3)
  assert.equal(sliceCtx(c, '2024-04').s.length, 1)
})

test('snapshots compare: what changed since the last request', () => {
  const early = [st('2024-01-05T12:00:00Z', 3 * MIN, 'A', 'x'), st('2024-01-06T12:00:00Z', 2 * MIN, 'B', 'x')]
  const later = [...early, st('2024-02-05T12:00:00Z', 10 * MIN, 'B', 'y'), st('2024-02-06T12:00:00Z', 3 * MIN, 'C', 'x')]
  const a = snapshot(ctxOf(early), '1', 'Jan'), b = snapshot(ctxOf(later), '2', 'Feb')
  const d = compareSnapshots(a, b)
  assert.equal(d.addedStreams, 2)
  assert.equal(d.addedArtists, 1)
  assert.deepEqual(d.newMonths, ['2024-02'])
  assert.deepEqual(d.entered.map(x => x.name), ['C'])
  assert.deepEqual(d.moved.map(x => [x.name, x.delta]), [['B', 1], ['A', -1]])
  assert.ok(!JSON.stringify(b).includes('"ts"'), 'snapshots hold aggregates, not raw rows')
})

test('CSV escapes quotes, commas and newlines', () => {
  assert.equal(toCsv(['a', 'b'], [['x, y', 'say "hi"'], [1, null]]), 'a,b\n"x, y","say ""hi"""\n1,\n')
})
