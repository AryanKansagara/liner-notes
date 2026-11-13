// Two synthetic listeners. Every artist, album and track name is invented. Distributions are tuned to look like a
// real extended history: Zipf-ish favourites, sessions around commutes and evenings, skips, shuffle, eras that change.
import { addMonths, tzOffset, ymStart } from './analyze.ts'
import type { Rule, Stream } from './types.ts'

export interface SampleDef { id: string; name: string; blurb: string; tz: string; from: string; to: string; seed: number }

export const SAMPLES: SampleDef[] = [
  { id: 'theo', name: 'Theo (synthetic): sleep sounds took over', blurb: 'Two years, rain loops every night and a toddler on the account. His top 5 is all noise until you fix it.', tz: 'America/Chicago', from: '2024-11', to: '2026-10', seed: 7 },
  { id: 'ines', name: 'Ines (synthetic): five years, four eras', blurb: 'Folk, then synth-pop, then jazz. Lost favourites, a 60-day streak and a lot of skipping.', tz: 'Europe/Lisbon', from: '2021-11', to: '2026-10', seed: 21 },
]

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

interface Track { name: string; album: string; artist: string; uri: string; dur: number; skippy: number }
interface Artist { name: string; tracks: Track[] }

const WORDS_A = ['Paper', 'Velvet', 'Northern', 'Glass', 'Quiet', 'Electric', 'Saltwater', 'Golden', 'Hollow', 'Neon', 'Wild', 'Slow', 'Silver', 'Lantern', 'Coastal', 'Midnight', 'Amber', 'Static', 'Linen', 'Cobalt']
const WORDS_B = ['Lights', 'Harbour', 'Letters', 'Orchard', 'Weather', 'Rivers', 'Hearts', 'Motel', 'Summer', 'Signals', 'Gardens', 'Echoes', 'Tides', 'Streets', 'Windows', 'Satellites', 'Fields', 'Ghosts', 'Parades', 'Mornings']
const TITLE_A = ['Say It', 'Falling', 'Better', 'Halfway', 'Carry Me', 'Small Hours', 'Undertow', 'Daylight', 'Overthinking', 'Polaroid', 'Two Hearts', 'Blue Hour', 'Runaway', 'Slow Burn', 'Gravity', 'Afterglow', 'Low Tide', 'Fever', 'Home Again', 'Paper Planes', 'Kerosene', 'Static Love', 'Holding On', 'Weightless', 'Somewhere', 'Northbound', 'Honey', 'Sidewalks', 'Lighthouse', 'Wildfire']
const TITLE_B = ['', '', '', '', ' (Acoustic)', ' Again', ' Tonight', ' in Lisbon', ' (Live)', ' Forever', '', ' at Dawn', '']

/** Era artists are fixed names so the sample tells a story; the long tail is generated. */
const NAMED = {
  folk: ['Marlow & the Pines', 'Juniper Vale', 'The Ashgrove Choir'],
  synth: ['Neon Harbour', 'Kitsune Drive', 'Velvet Parade'],
  jazz: ['Odette Fontaine Trio', 'Low Lantern Quartet', 'Sable & Sons'],
  pop: ['Rosa Vey', 'Clementine Ash', 'Polar Club'],
  indie: ['The Paper Satellites', 'Hollow Orchard', 'Coastal Ghosts'],
  hiphop: ['Mic Atlas', 'Dre Lumen', 'Southpaw Verse'],
}
const SLEEP_ARTIST = 'Quiet Hours Collective'
const SLEEP_TRACKS = ['Rain on a Tin Roof (Sleep Loop)', 'Brown Noise for Deep Sleep', 'Thunderstorm Far Away', 'Night Fan, 8 Hours', 'Ocean Waves at Night']
const KIDS_ARTIST = 'The Puddle Jumpers'
const KIDS_TRACKS = ['Bouncy Bus Song', 'Five Little Ducks (Kids Party Mix)', 'Brush Your Teeth Boogie', 'Rainbow Dance for Children', 'Wiggle Wiggle Stop']
const SHOWS = [{ name: 'The Long Commute', eps: 'Ep.' }, { name: 'Small Questions Podcast', eps: 'Episode' }]

const b62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const fakeId = (r: () => number) => Array.from({ length: 22 }, () => b62[Math.floor(r() * 62)]).join('')

function makeArtist(r: () => number, name: string, nTracks: number): Artist {
  const albums = [`${WORDS_A[Math.floor(r() * WORDS_A.length)]} ${WORDS_B[Math.floor(r() * WORDS_B.length)]}`, `${WORDS_B[Math.floor(r() * WORDS_B.length)]}`]
  const used = new Set<string>()
  const tracks: Track[] = []
  while (tracks.length < nTracks) {
    const t = TITLE_A[Math.floor(r() * TITLE_A.length)] + TITLE_B[Math.floor(r() * TITLE_B.length)]
    if (used.has(t)) continue
    used.add(t)
    tracks.push({ name: t, album: albums[tracks.length < nTracks / 2 ? 0 : 1], artist: name, uri: 'spotify:track:' + fakeId(r), dur: 150_000 + r() * 130_000, skippy: r() < 0.15 ? 0.55 + r() * 0.35 : r() * 0.18 })
  }
  return { name, tracks }
}

function special(r: () => number, artist: string, names: string[], album: string, dur: number): Artist {
  return { name: artist, tracks: names.map(n => ({ name: n, album, artist, uri: 'spotify:track:' + fakeId(r), dur: dur + r() * 30_000, skippy: 0.02 })) }
}

/** Picks an index with probability proportional to weights. */
function pick<T>(r: () => number, items: T[], w: (x: T, i: number) => number): T {
  let total = 0
  const ws = items.map((x, i) => { const v = w(x, i); total += v; return v })
  let u = r() * total
  for (let i = 0; i < items.length; i++) { u -= ws[i]; if (u <= 0) return items[i] }
  return items[items.length - 1]
}

/** Converts a local wall-clock time in tz to a UTC instant. */
const toUtc = (wall: number, tz: string) => { const g = wall - tzOffset(wall, tz); return wall - tzOffset(g, tz) }

export function generate(def: SampleDef): Stream[] {
  const r = rng(def.seed)
  const tail: Artist[] = []
  for (let i = 0; i < 70; i++) tail.push(makeArtist(r, `${WORDS_A[i % 20]} ${WORDS_B[(i * 7 + Math.floor(i / 20) + 3) % 20]}`, 4 + Math.floor(r() * 6)))
  const groups = Object.fromEntries(Object.entries(NAMED).map(([g, names]) => [g, names.map(n => makeArtist(r, n, 9 + Math.floor(r() * 5)))])) as Record<keyof typeof NAMED, Artist[]>
  const sleep = special(r, SLEEP_ARTIST, SLEEP_TRACKS, 'Sleep Sounds, Vol. 3', 175_000)
  const kids = special(r, KIDS_ARTIST, KIDS_TRACKS, 'Kids Songs for Little Feet', 125_000)

  const theo = def.id === 'theo'
  // Which groups dominate at a given point in the history (0..1).
  const mix = (p: number): [Artist[], number][] => theo
    ? [[groups.indie, 3], [groups.hiphop, p < 0.5 ? 3 : 1.5], [groups.pop, p < 0.5 ? 1 : 2.5], [tail, 1.2]]
    : p < 0.3 ? [[groups.folk, 4], [groups.indie, 1.2], [tail, 1]]
      : p < 0.55 ? [[groups.synth, 4], [groups.folk, p < 0.36 ? 0.8 : 0.05], [groups.pop, 1.2], [tail, 1]]
        : p < 0.8 ? [[groups.jazz, 3.5], [groups.synth, 0.6], [tail, 1.2]]
          : [[groups.pop, 2.5], [groups.jazz, 1.4], [groups.indie, 1], [tail, 1.2]]

  // Daily session start hours (local), weekday vs weekend.
  const weekdayHours = [0.1, 0.05, 0, 0, 0, 0.1, 0.6, 2.2, 2.6, 1.2, 0.8, 0.9, 1.4, 1.1, 0.9, 1, 1.3, 2.4, 2.1, 1.8, 1.9, 1.6, 1.1, 0.5]
  const weekendHours = [0.4, 0.3, 0.1, 0, 0, 0, 0.1, 0.3, 0.8, 1.4, 1.7, 1.8, 1.6, 1.5, 1.4, 1.3, 1.3, 1.4, 1.5, 1.7, 1.9, 1.8, 1.3, 0.8]
  const hours = Array.from({ length: 24 }, (_, i) => i)
  const countries = theo ? ['US', 'US', 'US', 'US', 'MX'] : ['PT', 'PT', 'PT', 'PT', 'ES', 'GB']
  const platforms = ['android', 'ios', 'windows', 'web_player']

  const out: Stream[] = []
  const start = ymStart(def.from), end = ymStart(addMonths(def.to, 1))
  const nDays = Math.round((end - start) / 86_400_000)
  const lastFor = new Map<Artist, Track>()

  // How busy each month is. Real histories are lumpy: a slow random walk (new job, new phone, a breakup album),
  // a dip in August holidays and a rise in December.
  const nMonths = Math.round((end - start) / (30.44 * 86_400_000)) + 1
  const busy: number[] = []
  for (let m = 0, lvl = 1; m < nMonths; m++) {
    lvl = Math.min(1.35, Math.max(0.55, lvl + (r() - 0.5) * 0.3))
    const cal = new Date(ymStart(addMonths(def.from, m))).getUTCMonth()
    busy.push(lvl * (cal === 7 ? 0.75 : cal === 11 ? 1.15 : 1))
  }

  const play = (wall: number, t: Track, o: { skip?: boolean; rs?: string; re?: string; shuffle?: boolean; country: string; platform: string; incognito?: boolean; offline?: boolean }) => {
    // Skips are mostly instant (flicking through shuffle); some get a verse in. Sessions sometimes stop mid-track.
    const ms = o.skip ? Math.round(r() < 0.45 ? r() * 2_500 : 2_500 + r() * 30_000) : o.re && o.re !== 'trackdone' ? Math.round(r() * t.dur) : Math.round(t.dur - (r() < 0.05 ? r() * 60_000 : 0))
    const st = toUtc(wall, def.tz)
    out.push({ ts: st + ms, ms, track: t.name, artist: t.artist, album: t.album, uri: t.uri, kind: 'track', rs: o.rs ?? 'trackdone', re: o.skip ? 'fwdbtn' : o.re ?? 'trackdone', shuffle: !!o.shuffle, skipped: !!o.skip, ...(o.offline ? { offline: true } : {}), ...(o.incognito ? { incognito: true } : {}), country: o.country, platform: o.platform })
    return ms
  }

  for (let d = 0; d < nDays; d++) {
    const day = start + d * 86_400_000
    const p = d / nDays
    const dow = (new Date(day).getUTCDay() + 6) % 7
    const weekend = dow >= 5
    const country = countries[Math.floor(r() * countries.length)]
    const level = busy[Math.min(busy.length - 1, Math.floor(d / 30.44))]
    // Quiet days (more of them in slow months) and a long streak in the Ines sample.
    if (!theo && !(p > 0.62 && p < 0.66) && r() < 0.12 / level) continue
    if (theo && r() < 0.07 / level) continue
    const groupsNow = mix(p)
    const nSessions = 1 + Math.floor(r() * (weekend ? 4 : 3.2) * level)
    for (let k = 0; k < nSessions; k++) {
      const h = pick(r, hours, x => (weekend ? weekendHours : weekdayHours)[x])
      let wall = day + h * 3_600_000 + Math.floor(r() * 3_600_000)
      const platform = h >= 9 && h < 17 && !weekend ? 'windows' : platforms[Math.floor(r() * platforms.length)]
      const shuffle = r() < 0.55
      const incognito = r() < 0.015
      const offline = r() < 0.04
      // A session sticks to one or two artists for a while, like an album or "This is" playlist.
      const n = 4 + Math.floor(-Math.log(1 - r()) * 9)
      const [group] = pick(r, groupsNow, x => x[1])
      // The long tail unlocks over time, so new artists keep turning up (discovery rate).
      const w = (g: Artist[], i: number, k: number) => g === tail && i / tail.length > p + 0.08 ? 0 : 1 / (g === tail ? (i % 7) + 1 : i + 1) ** k
      let artist = pick(r, group, (_, i) => w(group, i, 1))
      for (let j = 0; j < n; j++) {
        if (r() < 0.25) { const [g] = pick(r, groupsNow, x => x[1]); artist = pick(r, g, (_, i) => w(g, i, 0.8)) }
        const t = pick(r, artist.tracks, (x, i) => (1 / (i + 1) ** 1.1) * (lastFor.get(artist) === x ? 0.1 : 1))
        lastFor.set(artist, t)
        const skip = r() < t.skippy + (shuffle ? 0.08 : 0)
        const last = j === n - 1
        const re = !skip && last && r() < 0.35 ? (['endplay', 'endplay', 'logout', 'unexpected-exit-while-paused'] as const)[Math.floor(r() * 4)] : undefined
        wall += play(wall, t, { skip, re, shuffle, rs: j === 0 ? (r() < 0.2 ? 'appload' : 'clickrow') : skip ? 'fwdbtn' : 'trackdone', country, platform, incognito, offline }) + 1_000
      }
    }
    if (theo) {
      // Sleep loops most nights from about 23:00 to 6:30.
      if (r() < 0.62) {
        let wall = day + 22.8 * 3_600_000 + r() * 5_400_000
        const stop = day + 30.4 * 3_600_000 + r() * 1_800_000
        const t0 = Math.floor(r() * 3)
        while (wall < stop) {
          const t = sleep.tracks[r() < 0.8 ? t0 : Math.floor(r() * sleep.tracks.length)]
          wall += play(wall, t, { rs: 'trackdone', country: 'US', platform: 'ios' }) + 500
        }
      }
      // A toddler on the account: weekend mornings and some weekday evenings.
      if ((weekend && r() < 0.8) || (!weekend && r() < 0.25)) {
        let wall = day + (weekend ? 8 : 18) * 3_600_000 + r() * 3_600_000
        for (let j = 0, n = 6 + Math.floor(r() * 12); j < n; j++) wall += play(wall, kids.tracks[Math.floor(r() ** 1.6 * kids.tracks.length)], { country: 'US', platform: 'android', skip: r() < 0.05 }) + 500
      }
      // Weekday commute podcast.
      if (!weekend && r() < 0.7) {
        const show = SHOWS[Math.floor(r() * 2)]
        const ms = Math.round(900_000 + r() * 1_800_000)
        const st = toUtc(day + 7.6 * 3_600_000 + r() * 1_800_000, def.tz)
        out.push({ ts: st + ms, ms, track: `${show.eps} ${100 + Math.floor(p * 104)}: ${TITLE_A[Math.floor(r() * TITLE_A.length)]}`, artist: show.name, album: show.name, uri: 'spotify:episode:' + fakeId(r), kind: 'episode', rs: 'clickrow', re: 'endplay', country: 'US', platform: 'ios' })
      }
    }
  }
  // Keep the history inside the requested months (late-night sessions can spill past the end).
  const last = toUtc(end, def.tz)
  return out.filter(s => s.ts < last).sort((a, b) => a.ts - b.ts)
}

/** The rules a user would add to "fix" the Theo sample. Off by default so the problem is visible first. */
export function sampleRules(def: SampleDef, id: () => string): Rule[] {
  if (def.id !== 'theo') return []
  return [
    { id: id(), kind: 'keyword', value: 'sleep', label: 'Sleep sounds', on: false },
    { id: id(), kind: 'artist', value: SLEEP_ARTIST, label: SLEEP_ARTIST, on: false },
    { id: id(), kind: 'artist', value: KIDS_ARTIST, label: `${KIDS_ARTIST} (kids' songs)`, on: false },
  ]
}

export const SAMPLE_NOISE = { sleepArtist: SLEEP_ARTIST, kidsArtist: KIDS_ARTIST }
