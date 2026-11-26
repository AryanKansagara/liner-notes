import { AUDIO, clockCells, download, expect, HAND, importFiles, kpi, newListener, panel, play, ranked, readCsv, section, test } from './fixtures'

// Every expected number here is worked out on paper from the list above HAND in fixtures.ts.

test.beforeEach(async ({ page }) => {
  await newListener(page)
  await importFiles(page, 10, { name: AUDIO, data: HAND })
})

test('overview: totals, plays, artists, streak, ranking and clock', async ({ page }) => {
  await section(page, 'Overview')
  // Music 3+3+0:20+4+5+4+0:30+0:29.999+5 = 25:19.999; podcasts 30:00; together 55:20 = 0.92 h.
  await expect(kpi(page, 'Hours listened')).toContainText('1')
  await expect(kpi(page, 'Hours listened')).toContainText('25 min of music, 30 of podcasts')
  // 30 s or more: rows 1, 2, 4, 5, 6, 8, 10.
  await expect(kpi(page, /^Plays/).locator('b')).toHaveText('7')
  await expect(kpi(page, /^Plays/)).toContainText('4 different tracks')
  await expect(kpi(page, 'Artists').locator('b')).toHaveText('4')
  await expect(kpi(page, 'Artists')).toContainText('3 days with music') // 1 Jan, 2 Jan, 3 Feb
  await expect(kpi(page, 'Longest streak')).toContainText('2 days')
  await expect(kpi(page, 'Longest streak')).toContainText('Jan 1, 2024 to Jan 2, 2024')
  // Ada 3+3+4+5 = 15:00, Cleo 5:00, Bex 4:20, Dee 0:59.999.
  await expect.poll(() => ranked(panel(page, 'Top artists'))).toEqual(['Ada | 15 min', 'Cleo | 5 min', 'Bex | 4 min', 'Dee | 1 min'])
  // A stream belongs to the hour it starts in: row 6 is Tuesday 11 pm. Monday 10 am: 3+3+0:20+4 = 10:20.
  await expect.poll(() => clockCells(panel(page, 'Listening clock'))).toEqual(['Mon 10 am: 10 min', 'Mon 12 pm: 5 min', 'Tue 11 pm: 4 min', 'Thu 8 am: 30 min', 'Sat 9 am: 1 min', 'Sat 10 am: 5 min'])
  await expect(panel(page, 'Listening clock')).toContainText('Busiest: Thus around 8 am')
  // January 49:20 = 0.82 h, February 6:00 = 0.1 h.
  await expect(page.locator('figure.mbars rect title')).toHaveText(['Jan 2024: 0.8 h', 'Feb 2024: 0.1 h'])
})

test('habits: skips, sessions, streaks, discovery', async ({ page }) => {
  await section(page, 'Habits')
  await expect(kpi(page, 'Skip rate')).toContainText('1 of 9 track starts')
  await expect(kpi(page, 'Skip rate').locator('b')).toHaveText('11%')
  // Rows 1-4 (30:20), 5 (5:00), 6 (4:00), 7 (30:00), 8-9 (1:00), 10 (5:00). Middle two: 5 and 5. Mean 75:20 / 6 = 12.6.
  await expect(kpi(page, 'Sessions').locator('b')).toHaveText('6')
  await expect(kpi(page, 'Sessions')).toContainText('median 5 min, gap 20 min')
  await expect(panel(page, 'Streaks')).toContainText('13 min')
  await expect(page.getByText('Longest session 0.5 h on Jan 1, 2024 (4 streams).')).toBeVisible()
  await expect(kpi(page, 'Current streak')).toContainText('1 day')
  await expect(panel(page, 'Streaks')).toContainText('2 days of Ada')
  // January 3 new of 3; February 1 new (Dee) of 2 (Dee, Ada): mean of 100% and 50%.
  await expect(kpi(page, 'Discovery rate').locator('b')).toHaveText('75%')
  await expect(panel(page, /^Discovery/)).toContainText('January 2024 (3 new, including Ada, Bex, Cleo)')
})

test('top lists: tracks, artists, albums and podcasts by minutes and by plays, any date range, and the CSV', async ({ page }) => {
  await section(page, 'Top lists')
  const list = page.locator('.panel')
  const is = (rows: string[]) => expect.poll(() => ranked(list)).toEqual(rows)
  await is(['Alpha | Ada | 15 min', 'Gamma | Cleo | 5 min', 'Beta | Bex | 4 min', 'Delta | Dee | 1 min'])
  await page.getByRole('radio', { name: 'Plays' }).click()
  await is(['Alpha | Ada | 4 plays', 'Gamma | Cleo | 1 plays', 'Beta | Bex | 1 plays', 'Delta | Dee | 1 plays'])
  const [name, csv] = await download(page, page.getByRole('button', { name: 'CSV' }))
  expect(name).toBe('top-tracks-last-12-months.csv')
  expect(readCsv(csv)).toEqual([
    ['rank', 'name', 'artist', 'minutes', 'plays', 'uri'],
    ['1', 'Alpha', 'Ada', '15', '4', 'spotify:track:AdaAlpha00000000000000'],
    ['2', 'Gamma', 'Cleo', '5', '1', 'spotify:track:CleoGamma0000000000000'],
    ['3', 'Beta', 'Bex', '4', '1', 'spotify:track:BexBeta000000000000000'],
    ['4', 'Delta', 'Dee', '1', '1', 'spotify:track:DeeDelta00000000000000'],
  ])
  await page.getByRole('radio', { name: 'Albums' }).click()
  await is(['Ada LP | Ada | 4 plays', 'Cleo LP | Cleo | 1 plays', 'Bex LP | Bex | 1 plays', 'Dee LP | Dee | 1 plays'])
  await page.getByRole('radio', { name: 'Podcasts' }).click()
  await page.getByRole('radio', { name: 'Minutes' }).click()
  await is(['Show | 30 min'])
  await page.getByRole('radio', { name: 'Artists' }).click()
  await page.getByRole('radio', { name: 'Custom' }).click()
  await page.getByLabel('From', { exact: true }).fill('2024-02')
  await is(['Ada | 5 min', 'Dee | 1 min'])
  await page.getByLabel('From', { exact: true }).fill('2024-01')
  await page.getByLabel('To', { exact: true }).fill('2024-01')
  await is(['Ada | 10 min', 'Cleo | 5 min', 'Bex | 4 min'])
})

test('year in review', async ({ page }) => {
  await section(page, 'Year in review')
  await expect(page.getByRole('heading', { name: 'January 2024 to December 2024' })).toBeVisible()
  await expect(kpi(page, 'Minutes').locator('b')).toHaveText('55')
  await expect(kpi(page, 'Minutes')).toContainText('7 plays · 4 tracks')
  await expect(kpi(page, 'Top artist')).toContainText('Ada')
  await expect(kpi(page, 'Top artist')).toContainText('15 min')
  await expect(kpi(page, 'New artists')).toContainText('4')
  await expect(kpi(page, 'Biggest day')).toContainText('Jan 4, 2024')
  await expect(kpi(page, 'Biggest day')).toContainText('30 min')
  await expect(panel(page, 'The shape of the year')).toContainText('Ada LP')
  await expect(panel(page, 'The shape of the year')).toContainText('First song of the windowAlphaAda')
  // Starting in February only rows 8-10 remain: 6 minutes, and Dee is the only artist never heard before.
  await page.getByLabel('Start month').selectOption('2024-02')
  await expect(kpi(page, 'Minutes').locator('b')).toHaveText('6')
  await expect(kpi(page, 'New artists').locator('b')).toHaveText('1')
  await expect(page).toHaveURL(/from=2024-02/)
})

test('the play threshold, timezone and session gap recompute everything', async ({ page }) => {
  const def = (l: string) => panel(page, 'Definitions').getByLabel(l)
  await section(page, 'Fix my Wrapped')
  await def('A play counts from').fill('31') // row 8 drops out
  await section(page, 'Overview')
  await expect(kpi(page, /^Plays/).locator('b')).toHaveText('6')
  await expect(kpi(page, 'Artists').locator('b')).toHaveText('3')
  await section(page, 'Fix my Wrapped')
  await def('A play counts from').fill('20') // rows 3 and 9 come in
  await section(page, 'Overview')
  await expect(kpi(page, /^Plays/).locator('b')).toHaveText('9')
  await section(page, 'Fix my Wrapped')
  await def('New session after').fill('19') // row 4 starts a session of its own
  await section(page, 'Habits')
  await expect(kpi(page, 'Sessions').locator('b')).toHaveText('7')
  await section(page, 'Fix my Wrapped')
  await def('Timezone').fill('Asia/Tokyo') // UTC+9: 10 am is 7 pm, Tuesday 11 pm is Wednesday 8 am
  await expect(page.getByText('times in Asia/Tokyo')).toBeVisible()
  await section(page, 'Overview')
  await expect.poll(() => clockCells(panel(page, 'Listening clock'))).toEqual(['Mon 7 pm: 10 min', 'Mon 9 pm: 5 min', 'Wed 8 am: 4 min', 'Thu 5 pm: 30 min', 'Sat 6 pm: 1 min', 'Sat 7 pm: 5 min'])
})

test('exclusion rules: artist, track, keyword, date range and podcasts, switched off, removed and undone', async ({ page }) => {
  await section(page, 'Fix my Wrapped')
  const after = page.locator('.panel.after')
  const add = async (kind: string, label?: string, value?: string) => {
    await page.locator('.add-rule').getByLabel('Exclude').selectOption({ label: kind })
    if (label) await page.locator('.add-rule').getByLabel(label, { exact: true }).fill(value!)
    await page.getByRole('button', { name: 'Add rule' }).click()
  }
  await add('Artist', 'Artist', 'ada') // any case: 4 streams, 15 min
  await expect(after).toContainText('4 streams, 0.3 h excluded')
  await expect.poll(() => ranked(after)).toEqual(['Gamma | Cleo | 5 min', 'Beta | Bex | 4 min', 'Delta | Dee | 1 min'])
  await add('Track', 'Track', 'Gamma · Cleo')
  await expect(after).toContainText('5 streams')
  await add('Keyword', 'Keyword', 'BEX l') // only in the album name; rows 3 and 4
  await expect(after).toContainText('7 streams')
  await add('Podcasts & audiobooks')
  await expect(after).toContainText('8 streams')
  await expect.poll(() => ranked(after)).toEqual(['Delta | Dee | 1 min'])
  await expect(page.getByRole('link', { name: /4 exclusions on/ })).toBeVisible()
  await page.locator('.add-rule').getByLabel('Exclude').selectOption({ label: 'Date range' })
  await page.getByLabel('From', { exact: true }).fill('2024-01-01')
  await page.getByLabel('To', { exact: true }).fill('2024-01-02')
  await page.getByRole('button', { name: 'Add rule' }).click()
  const dates = page.locator('.rules li').filter({ hasText: '2024-01-01 to 2024-01-02' })
  await expect(dates).toContainText('matches 6 streams') // row 6 starts on the 2nd
  await expect(dates).toContainText('0 not already caught by an earlier rule')
  for (let i = 0; i < 4; i++) {
    await page.locator('.rules li').nth(i).locator('.switch').click()
    await expect(page.locator('.rules li').nth(i)).not.toHaveClass('on')
  }
  await expect.poll(() => ranked(after)).toEqual(['Alpha | Ada | 5 min', 'Delta | Dee | 1 min'])
  await dates.getByRole('button', { name: 'Remove' }).click()
  await expect(after).toContainText('no exclusions on')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(dates).toHaveCount(1)
  await expect(after).toContainText('6 streams')
})

test('a second request is merged, and History reports what changed', async ({ page }) => {
  await section(page, 'Data')
  // The same ten rows again, plus 20 minutes of Eve in March.
  await importFiles(page, 11, { name: AUDIO, data: HAND }, { name: 'Streaming_History_Audio_2024_1.json', data: [play('2024-03-01T12:00:00Z', 1_200_000, 'Eve', 'Echo')] })
  await expect(panel(page, 'Imports').locator('tbody tr').first().locator('td').nth(3)).toHaveText('1')
  await section(page, 'History')
  const k = (l: string) => page.locator('.kpi').filter({ has: page.locator('small', { hasText: l }) })
  await expect(k('Streams')).toContainText('+111 in total')
  await expect(k('Artists')).toContainText('+15 in total')
  await expect(k('Tracks')).toContainText('+15 in total')
  await expect(k('Hours')).toContainText('1 new month of data')
  await expect(page.getByText('#1 Eve')).toBeVisible()
  await expect(page.locator('ul.plain li', { hasText: 'Ada' })).toContainText('▼ 1 Ada #1 → #2')
  await expect(page.locator('.banner')).toHaveCount(0)
})

test('lost favourites, first listens and songs you always skip', async ({ page }) => {
  // Ten plays of Old in January 2023, then six one-second skips and one full play of Nope on 1 March 2023, on top of HAND.
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => play(`2023-01-${String(i + 1).padStart(2, '0')}T12:00:00Z`, 180_000, 'Fay', 'Old')),
    ...Array.from({ length: 6 }, (_, i) => play(`2023-03-01T12:0${i}:00Z`, 1000, 'Gus', 'Nope', { reason_end: 'fwdbtn', skipped: true })),
    play('2023-03-01T12:30:00Z', 200_000, 'Gus', 'Nope'),
  ]
  await section(page, 'Data')
  await importFiles(page, 17, { name: 'Streaming_History_Audio_2023.json', data: rows })
  await section(page, 'Rediscover')
  // Last heard 10 January 2023 12:00, the history ends 3 February 2024 10:00: 388 whole days.
  await expect(page.locator('ol.lost li')).toHaveText([/Old.*Fay.*10 plays, peak Jan 2023 · last heard 388 days ago/])
  const [, csv] = await download(page, panel(page, 'Lost favourites').getByRole('button', { name: 'CSV' }))
  expect(readCsv(csv)[1]).toEqual(['Old', 'Fay', '10', '2023-01', '2023-01-10', '388', 'spotify:track:FayOld0000000000000000'])
  await page.getByLabel('Played at least').selectOption('20')
  await expect(page.getByText('No lost favourites with these settings')).toBeVisible()
  await page.getByPlaceholder('Search a song').fill('OLD')
  await expect(panel(page, 'First listens').locator('tbody td').first()).toHaveText('Jan 1, 2023, 12:00 PM')
  await section(page, 'Habits')
  const skips = panel(page, 'Songs you always skip')
  await expect(skips.locator('tbody tr')).toHaveText([/Nope.*Gus.*7.*86%/]) // 6 of 7
  const [, skipCsv] = await download(page, skips.getByRole('button', { name: 'CSV' }))
  expect(readCsv(skipCsv)[1].slice(0, 5)).toEqual(['Nope', 'Gus', '7', '6', '0.86'])
})
