import { readFileSync } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { alert, AUDIO, clockCells, expect, HAND, importFiles, kpi, newListener, panel, play, report, reportRow, section, test, upload, type Upload } from './fixtures'

const fixture = (name: string): Upload => ({ name, data: readFileSync(new URL(`../src/engine/fixtures/${name}`, import.meta.url)) })
const REAL = ['Streaming_History_Audio_2024_0.json', 'Streaming_History_Audio_2025_1.json', 'StreamingHistory_music_0.json', 'StreamingHistory_podcast_0.json'].map(fixture)
const json = (v: unknown) => strToU8(JSON.stringify(v))

test.beforeEach(async ({ page }) => { await newListener(page) })

test('every export layout at once: 2024 and 2025 extended, account data with a byte order mark, overlap merged', async ({ page }) => {
  await upload(page, ...REAL)
  await expect(report(page)).toContainText('9 unique streams') // 5 + 2 extended, and only the two Small Rooms rows are new in the 6 basic ones
  await expect(reportRow(page, REAL[0].name)).toHaveText(['Extended history (audio)', '6', '5', '1', 'Jul 22, 2024 to Jul 25, 2024'])
  await expect(reportRow(page, REAL[1].name)).toHaveText(['Extended history (audio)', '2', '2', '0', 'Mar 2, 2025 to Mar 2, 2025'])
  await expect(reportRow(page, REAL[2].name)).toHaveText(['Account data: music', '5', '5', '0', 'Jul 22, 2024 to Jul 26, 2024'])
  await expect(reportRow(page, REAL[3].name)).toHaveText(['Account data: podcasts', '1', '1', '0', 'Jul 25, 2024 to Jul 25, 2024'])
  await expect(report(page)).toContainText('1 row skipped')
  await expect(report(page).locator('.issues')).toContainText('Streaming_History_Audio_2024_0.json:1No track, episode or audiobook metadata')
})

test('zip: nested folder, __MACOSX copies and unrelated files', async ({ page }) => {
  const zip = zipSync({
    'Spotify Extended Streaming History/Streaming_History_Audio_2024_0.json': json(HAND),
    '__MACOSX/Spotify Extended Streaming History/._Streaming_History_Audio_2024_0.json': strToU8('\0\x05\x16\x07'),
    'Spotify Extended Streaming History/ReadMeFirst.pdf': strToU8('%PDF'),
    'Spotify Account Data/Userdata.json': json({ username: 'x' }),
  })
  await importFiles(page, 10, { name: 'my_spotify_data.zip', data: zip })
  await section(page, 'Overview')
  await expect(kpi(page, /^Plays/).locator('b')).toHaveText('7')
})

test('old endsong files and video history', async ({ page }) => {
  await upload(page, { name: 'endsong_0.json', data: HAND }, { name: 'Streaming_History_Video_2024.json', data: [play('2024-01-05T10:00:00Z', 600_000, 'Vee', 'Clip')] })
  await expect(reportRow(page, 'endsong_0.json').first()).toHaveText('Extended history (audio)')
  await expect(reportRow(page, 'Streaming_History_Video_2024.json').first()).toHaveText('Extended history (video)')
  await report(page).getByRole('button', { name: 'Import' }).click()
  await section(page, 'Overview')
  await expect(kpi(page, /^Plays/).locator('b')).toHaveText('7') // the video stays out of music
  await expect(panel(page, 'Top artists')).not.toContainText('Vee')
})

test('account data alone: no skip fields, and the report says what is missing', async ({ page }) => {
  await upload(page, { name: 'StreamingHistory_music_0.json', data: [
    { endTime: '2024-01-01 10:03', artistName: 'Ada', trackName: 'Alpha', msPlayed: 180_000 },
    { endTime: '2024-01-01 10:04', artistName: 'Bex', trackName: 'Beta', msPlayed: 5_000 },
    { endTime: '2024-01-01 10:05', artistName: '', trackName: '', msPlayed: 5_000 },
    { endTime: 'soon', artistName: 'Bex', trackName: 'Beta', msPlayed: 5_000 },
    { endTime: '2024-01-01 10:06', artistName: 'Bex', trackName: 'Beta', msPlayed: -1 },
  ] })
  await expect(report(page)).toContainText('This is the basic Account data export')
  await expect(reportRow(page, 'StreamingHistory_music_0.json')).toHaveText(['Account data: music', '5', '2', '3', /Jan 1, 2024/])
  await expect(report(page).locator('.issues > div')).toHaveText([/:3Empty trackName/, /:4Unreadable endTime "soon"/, /:5msPlayed is missing or negative/])
  await report(page).getByRole('button', { name: 'Import' }).click()
  await section(page, 'Habits')
  await expect(kpi(page, 'Skip rate')).toContainText('1 of 2 track starts')
})

test('offline rows land when they were played, not when they were synced', async ({ page }) => {
  // Started Sunday 7 January 2024 15:00 UTC, synced on Tuesday the 9th.
  await importFiles(page, 1, { name: AUDIO, data: [play('2024-01-09T12:00:00Z', 180_000, 'Ada', 'Alpha', { offline: true, offline_timestamp: Date.UTC(2024, 0, 7, 15) / 1000 })] })
  await section(page, 'Overview')
  await expect.poll(() => clockCells(panel(page, 'Listening clock'))).toEqual(['Sun 3 pm: 3 min'])
})

test('hours follow daylight saving time', async ({ page }) => {
  await newListenerIn(page, 'America/New_York')
  // 14:00 UTC is 9 am on Sat 9 March 2024 (UTC-5) and 10 am on Sun 10 March (UTC-4).
  await importFiles(page, 2, { name: AUDIO, data: [play('2024-03-09T14:00:00Z', 180_000, 'Ada', 'Alpha'), play('2024-03-10T14:00:00Z', 240_000, 'Ada', 'Alpha')] })
  await section(page, 'Overview')
  await expect.poll(() => clockCells(panel(page, 'Listening clock'))).toEqual(['Sat 9 am: 3 min', 'Sun 10 am: 4 min'])
})
const newListenerIn = async (page: import('@playwright/test').Page, tz: string) => {
  await page.goto('/settings')
  await page.getByLabel('Timezone').fill(tz)
  await expect(page.getByText('Saved').first()).toBeVisible()
  await page.goto('/app')
  await page.getByRole('button', { name: 'New listener' }).click()
  await expect(page.getByRole('button', { name: 'Choose your Spotify export files' })).toBeVisible()
}

test('an identical file adds nothing, and Replace swaps the history', async ({ page }) => {
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await expect(panel(page, 'Imports').locator('tbody tr').first().locator('td').nth(3)).toHaveText('0')
  await upload(page, { name: AUDIO, data: HAND.slice(0, 2) })
  await report(page).getByRole('button', { name: 'Replace instead' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Replace' }).click()
  await expect(panel(page, 'Imports')).toContainText('2 streams on this device')
})

test('cancelling a report imports nothing', async ({ page }) => {
  await upload(page, { name: AUDIO, data: HAND })
  await report(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(report(page)).toHaveCount(0)
  await expect(panel(page, 'Imports')).toHaveCount(0)
})

const text = JSON.stringify(HAND)
const zipped = zipSync({ [AUDIO]: strToU8(text) })
for (const [name, file, message] of [
  ['an empty JSON file', { name: AUDIO, data: '' }, /No streaming history files found.*Ignored: .*\(not valid JSON\)/],
  ['a truncated JSON file', { name: AUDIO, data: text.slice(0, text.length / 2) }, /No streaming history files found.*\(not valid JSON\)/],
  ['an empty list', { name: AUDIO, data: [] }, /No streaming history files found.*\(not streaming history\)/],
  ['a JSON file of something else', { name: 'Playlist1.json', data: { playlists: [] } }, /No streaming history files found.*Playlist1\.json \(not streaming history\)/],
  ['a list of something else', { name: AUDIO, data: [{ a: 1 }, 'x'] }, /No streaming history files found/],
  ['a text file', { name: 'notes.txt', data: 'hello' }, /No streaming history files found.*Ignored: notes\.txt/],
  ['rows that are all unreadable', { name: AUDIO, data: [{ ts: 'never', ms_played: 1 }] }, /No playable streams found in these files/],
  ['an empty zip file', { name: 'a.zip', data: '' }, /Could not read the files/],
  ['a truncated zip file', { name: 'a.zip', data: zipped.slice(0, zipped.length / 2) }, /Could not read the files/],
  ['a zip that is not a zip', { name: 'a.zip', data: 'PK? no' }, /Could not read the files/],
  ['a zip without history', { name: 'a.zip', data: zipSync({ 'Userdata.json': json({}) }) }, /no streaming history files inside/],
] as const) test(`${name} gives a message and no result`, async ({ page }) => {
  await upload(page, file)
  await expect(alert(page)).toContainText(message)
  await expect(report(page)).toHaveCount(0)
})
