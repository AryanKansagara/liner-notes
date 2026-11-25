import { test as base, expect, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

/** Web fonts in index.html: answered with an empty stylesheet. */
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])

export const test = base.extend<{ external: string[] }>({
  external: async ({}, use) => { await use([]) },

  // Only the app is reachable: a request to any other host (Supabase included) fails the test, and so does an uncaught page error.
  context: async ({ context, baseURL, external }, use) => {
    const errors: string[] = []
    const origin = new URL(baseURL!).origin
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin === origin) return route.continue()
      if (FONT_HOSTS.has(url.host)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' })
      external.push(url.host)
      return route.abort('blockedbyclient')
    })
    context.on('weberror', e => errors.push(String(e.error())))
    await use(context)
    expect(errors, 'uncaught page errors').toEqual([])
    expect(external, 'requests to hosts other than the app').toEqual([])
  },
})

export { expect }

// ---------- Export rows ----------

export const AUDIO = 'Streaming_History_Audio_2024_0.json'
const MIN = 60_000

/** One extended-history row in the 2025 layout. `start` is when it began; Spotify records the end, as whole seconds. */
export function play(start: string, ms: number, artist: string, track: string, extra: Record<string, unknown> = {}) {
  return {
    ts: new Date(Math.round((Date.parse(start) + ms) / 1000) * 1000).toISOString().replace('.000Z', 'Z'), platform: 'ios', ms_played: ms, conn_country: 'PT', ip_addr: '203.0.113.7',
    master_metadata_track_name: track as string | null, master_metadata_album_artist_name: artist as string | null, master_metadata_album_album_name: `${artist} LP` as string | null,
    spotify_track_uri: `spotify:track:${(artist + track).replace(/[^A-Za-z0-9]/g, '').padEnd(22, '0').slice(0, 22)}` as string | null,
    episode_name: null as string | null, episode_show_name: null as string | null, spotify_episode_uri: null as string | null,
    audiobook_title: null, audiobook_uri: null, audiobook_chapter_uri: null, audiobook_chapter_title: null,
    reason_start: 'trackdone', reason_end: 'trackdone', shuffle: false, skipped: false, offline: false, offline_timestamp: 0, incognito_mode: false, ...extra,
  }
}
export const episode = (start: string, ms: number, show: string, name: string) => play(start, ms, show, name, {
  master_metadata_track_name: null, master_metadata_album_artist_name: null, master_metadata_album_album_name: null, spotify_track_uri: null,
  episode_name: name, episode_show_name: show, spotify_episode_uri: 'spotify:episode:0000000000000000000001',
})

/**
 * The hand-worked history (all UTC; 1 January 2024 is a Monday). Expected values in the specs are worked out on paper from this list.
 *  1 Mon 1 Jan 10:00:00  3:00  Ada   Alpha
 *  2 Mon 1 Jan 10:03:00  3:00  Ada   Alpha
 *  3 Mon 1 Jan 10:06:00  0:20  Bex   Beta   next pressed
 *  4 Mon 1 Jan 10:26:20  4:00  Bex   Beta   exactly 20 min after row 3 stopped
 *  5 Mon 1 Jan 12:00:00  5:00  Cleo  Gamma
 *  6 Tue 2 Jan 23:58:00  4:00  Ada   Alpha  ends on Wednesday
 *  7 Thu 4 Jan 08:00:00 30:00  Show  Ep 1   podcast
 *  8 Sat 3 Feb 09:00:00  0:30  Dee   Delta  exactly the play threshold
 *  9 Sat 3 Feb 09:00:30  0:29.999 Dee Delta just under it
 * 10 Sat 3 Feb 10:00:00  5:00  Ada   Alpha
 */
export const HAND = [
  play('2024-01-01T10:00:00Z', 3 * MIN, 'Ada', 'Alpha'),
  play('2024-01-01T10:03:00Z', 3 * MIN, 'Ada', 'Alpha'),
  play('2024-01-01T10:06:00Z', 20_000, 'Bex', 'Beta', { reason_end: 'fwdbtn', skipped: true }),
  play('2024-01-01T10:26:20Z', 4 * MIN, 'Bex', 'Beta'),
  play('2024-01-01T12:00:00Z', 5 * MIN, 'Cleo', 'Gamma'),
  play('2024-01-02T23:58:00Z', 4 * MIN, 'Ada', 'Alpha'),
  episode('2024-01-04T08:00:00Z', 30 * MIN, 'Show', 'Ep 1'),
  play('2024-02-03T09:00:00Z', 30_000, 'Dee', 'Delta'),
  play('2024-02-03T09:00:30Z', 29_999, 'Dee', 'Delta', { reason_end: 'endplay' }),
  play('2024-02-03T10:00:00Z', 5 * MIN, 'Ada', 'Alpha'),
]

// ---------- Driving the app ----------

/** A blank listener on its Data tab. Returns the listener path. */
export async function newListener(page: Page, tz?: string): Promise<string> {
  if (tz) {
    await page.goto('/settings')
    await page.getByLabel('Timezone').fill(tz)
    await expect(page.getByText('Saved').first()).toBeVisible()
  }
  await page.goto('/app')
  await page.getByRole('button', { name: 'Import your data' }).click()
  await expect(page.getByRole('button', { name: 'Choose your Spotify export files' })).toBeVisible()
  return new URL(page.url()).pathname.replace(/\/data$/, '')
}

export interface Upload { name: string; data: unknown }
const bytes = (d: unknown) => typeof d === 'string' || d instanceof Uint8Array ? Buffer.from(d as string) : Buffer.from(JSON.stringify(d))
/** Hands files to the import control. Objects are sent as JSON. */
export const upload = (page: Page, ...files: Upload[]) => page.locator('.drop input[type=file]').setInputFiles(files.map(f => ({ name: f.name, mimeType: 'application/octet-stream', buffer: bytes(f.data) })))

export const report = (page: Page) => page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Validation report' }) })
/** Cells of one file's row in the validation report: detected kind, rows, kept, skipped, covers. */
export const reportRow = (page: Page, file: string) => report(page).locator('tbody tr').filter({ has: page.getByRole('rowheader', { name: file, exact: true }) }).locator('td')
export const alert = (page: Page) => page.locator('.banner[role=alert]')

/** Uploads, checks the number of unique streams found and imports them. */
export async function importFiles(page: Page, streams: number, ...files: Upload[]) {
  const log = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Imports' }) }).locator('tbody tr')
  const before = await log.count()
  await upload(page, ...files)
  await expect(report(page)).toContainText(`${streams} unique streams after de-duplication`)
  await report(page).getByRole('button', { name: /^(Import|Add to this history)$/ }).click()
  await expect(report(page)).toHaveCount(0)
  await expect(log).toHaveCount(before + 1)
}

export type Section = 'Overview' | 'Top lists' | 'Habits' | 'Rediscover' | 'Fix my Wrapped' | 'Year in review' | 'History' | 'Data'
export async function section(page: Page, name: Section) {
  const link = page.getByRole('navigation', { name: 'Listener sections' }).getByRole('link', { name })
  await link.click()
  await expect(link).toHaveAttribute('aria-current', 'page')
}

export const kpi = (page: Page, label: string | RegExp) => page.locator('.kpi').filter({ has: page.locator('> small', { hasText: label }) })
export const panel = (page: Page, heading: string | RegExp) => page.locator('.panel').filter({ has: page.getByRole('heading', { name: heading }) })
/** "name | artist | value" per ranked row. */
export const ranked = (scope: Locator) => scope.locator('ol.toplist > li').evaluateAll(els => els.map(li => [li.querySelector('b')!, li.querySelector('.tl-main small'), li.querySelector('.tl-val')!].filter(Boolean).map(e => e!.textContent).join(' | ')))
/** The non-empty cells of a listening clock, as their hover titles. */
export const clockCells = (scope: Locator) => scope.locator('.heat').first().locator('.c.v').evaluateAll(els => els.map(e => e.getAttribute('title')))

export async function download(page: Page, button: Locator): Promise<[string, string]> {
  const [d] = await Promise.all([page.waitForEvent('download'), button.click()])
  return [d.suggestedFilename(), await readFile(await d.path(), 'utf8')]
}

/** Reads CSV independently of the app's writer. */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [[]]
  for (const m of text.matchAll(/("(?:[^"]|"")*"|[^,\r\n]*)(,|\r?\n|$)/g)) {
    if (m[0] === '' && m.index === text.length) break
    rows.at(-1)!.push(m[1].startsWith('"') ? m[1].slice(1, -1).replace(/""/g, '"') : m[1])
    if (m[2] !== ',') rows.push([])
  }
  return rows.filter(r => r.length)
}
