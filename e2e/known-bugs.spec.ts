import { AUDIO, download, expect, HAND, importFiles, kpi, newListener, panel, play, readCsv, report, section, test, upload } from './fixtures'

// Filed bugs. Each test states the correct behaviour and is expected to fail until its issue is fixed.

const MIN = 60_000

test('#2 storage: a history the browser refuses to store is not reported as imported', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...a: [unknown, IDBValidKey?]) {
      if (this.name === 'data') throw new DOMException('full', 'QuotaExceededError')
      return put.apply(this, a)
    }
  })
  await newListener(page)
  await upload(page, { name: AUDIO, data: HAND })
  await report(page).getByRole('button', { name: 'Import' }).click()
  await expect(page.locator('.toast, .banner').first()).toBeVisible()
  await expect(page.getByText(/new streams added/)).toHaveCount(0, { timeout: 2000 })
  await expect(page.getByText(/could not be (saved|stored)/i).first()).toBeVisible({ timeout: 5000 })
  await expect(report(page)).toBeVisible()
  await expect(panel(page, 'Imports')).toHaveCount(0)
  await section(page, 'History')
  await expect(page.getByText('No snapshots yet')).toBeVisible()
})

test('#2 storage: a write aborted as it commits keeps the earlier history', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...a: [unknown, IDBValidKey?]) {
      const r = put.apply(this, a)
      if (this.name === 'data' && (a[0] as unknown[]).length > 10) r.addEventListener('success', () => this.transaction.abort())
      return r
    }
  })
  await newListener(page)
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await upload(page, { name: AUDIO, data: [...HAND, play('2024-03-01T12:00:00Z', MIN, 'Eve', 'Echo')] })
  await report(page).getByRole('button', { name: 'Add to this history' }).click()
  await expect(page.getByText(/could not be stored/)).toBeVisible()
  await expect(page.getByText('1 new streams added')).toHaveCount(0)
  await page.reload()
  await expect(panel(page, 'Imports').locator('tbody tr')).toHaveCount(1)
  await expect(panel(page, 'Imports')).toContainText('10 streams on this device')
})

test('#2 storage: a rule the browser cannot keep is reported', async ({ page }) => {
  await newListener(page)
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await page.evaluate(() => { IDBObjectStore.prototype.put = () => { throw new DOMException('full', 'QuotaExceededError') } })
  await section(page, 'Top lists')
  await page.locator('.toplist li').filter({ hasText: 'Gamma' }).getByRole('button', { name: 'Exclude' }).click()
  await expect(page.getByText(/My history could not be saved/)).toBeVisible()
})

test('#2 storage: without a database the history still works until the page is closed', async ({ page }) => {
  await page.addInitScript(() => { IDBFactory.prototype.open = () => { throw new DOMException('blocked', 'SecurityError') } })
  await newListener(page)
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await section(page, 'Overview')
  await expect(kpi(page, /^Plays/).locator('b')).toHaveText('7')
})

test('#3 validity: one impossible row is skipped with a reason and does not break the listener', async ({ page }) => {
  await newListener(page)
  await upload(page, { name: AUDIO, data: [...HAND, { ...HAND[0], ms_played: 1e16 }, { ...HAND[1], ms_played: null }, { ...HAND[1], ts: '5' }] })
  await expect(report(page)).toContainText('3 rows skipped', { timeout: 10_000 })
  await expect(report(page).locator('.issues > div')).toHaveText([/:11ms_played is longer than 7 days/, /:12ms_played is missing/, /:13Unreadable ts "5"/])
  await report(page).getByRole('button', { name: 'Import' }).click()
  await section(page, 'Overview')
  await expect(kpi(page, /^Plays/).locator('b')).toHaveText('7')
})

test('#4 merge: two artists with the same title in one minute are two streams', async ({ page }) => {
  await newListener(page)
  await upload(page, { name: AUDIO, data: [play('2024-01-01T10:00:00Z', 10_000, 'Ada', 'Intro'), play('2024-01-01T10:00:20Z', 10_000, 'Bex', 'Intro')] })
  await expect(report(page)).toContainText('2 unique streams', { timeout: 10_000 })
})

test('#4 merge: a 20 second sound on repeat keeps every repeat', async ({ page }) => {
  await newListener(page)
  await upload(page, { name: AUDIO, data: [0, 20, 39].map(s => play(`2024-01-01T10:00:${String(s).padStart(2, '0')}Z`, 20_000, 'Ada', 'Loop')) })
  await expect(report(page)).toContainText('3 unique streams', { timeout: 10_000 })
})

test('#5 unreadable: a damaged history file among good ones is called out', async ({ page }) => {
  await newListener(page)
  await upload(page, { name: AUDIO, data: HAND }, { name: 'Streaming_History_Audio_2023.json', data: '[{"ts":"2023-01' })
  await expect(report(page)).toBeVisible()
  await expect(report(page).locator('[role=alert]')).toContainText('Streaming_History_Audio_2023.json', { timeout: 5000 })
  await expect(report(page)).not.toContainText('Ignored:')
})

test('#5 unreadable: every damaged file is named, unrelated files are not', async ({ page }) => {
  await newListener(page)
  const bad = Array.from({ length: 9 }, (_, i) => ({ name: `Streaming_History_Audio_${2010 + i}_${i}.json`, data: i % 2 ? '' : { error: 'x' } }))
  await upload(page, { name: AUDIO, data: HAND }, ...bad, { name: 'notes.txt', data: 'x' }, { name: 'Playlist1.json', data: {} })
  const warning = report(page).locator('[role=alert]')
  await expect(warning).toContainText('9 files could not be read')
  for (const b of bad) await expect(warning).toContainText(b.name)
  await expect(warning).not.toContainText(/notes|Playlist/)
  await expect(report(page)).toContainText('Ignored: notes.txt, Playlist1.json (not streaming history)')
})

test('#5 unreadable: a history file whose first row is damaged keeps its other rows', async ({ page }) => {
  await newListener(page)
  await upload(page, { name: AUDIO, data: [null, ...HAND] })
  await expect(report(page)).toContainText('10 unique streams', { timeout: 10_000 })
})

test('#6 snapshot: the one saved by an import follows the rules in force', async ({ page }) => {
  await newListener(page)
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await section(page, 'Top lists')
  await page.locator('.toplist li').filter({ hasText: 'Alpha' }).getByRole('button', { name: 'Exclude' }).click()
  await section(page, 'Data')
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await section(page, 'History')
  await expect(panel(page, 'Snapshots').locator('tbody tr').first()).toContainText('Cleo', { timeout: 5000 })
  // The same as a snapshot saved by hand: 10 streams less Ada's 4, 3 artists left.
  const cells = (i: number) => panel(page, 'Snapshots').locator('tbody tr').nth(i).locator('td').allTextContents()
  const imported = await cells(0)
  expect(imported.slice(1, 4)).toEqual(['6', '1', '3'])
  await page.getByRole('button', { name: 'Save a snapshot now' }).click()
  await expect(panel(page, 'Snapshots').locator('tbody tr')).toHaveCount(3)
  expect(await cells(0)).toEqual(imported)
  await page.goto('/app')
  await expect(page.locator('.project-card')).toContainText('Top artist Cleo')
})

test('#6 snapshot: rules that are off are not applied', async ({ page }) => {
  await newListener(page)
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await section(page, 'Top lists')
  await page.locator('.toplist li').filter({ hasText: 'Alpha' }).getByRole('button', { name: 'Exclude' }).click()
  await section(page, 'Fix my Wrapped')
  await page.locator('.rules li .switch').click()
  await expect(page.locator('.rules li')).not.toHaveClass('on')
  await section(page, 'Data')
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await section(page, 'History')
  await expect(panel(page, 'Snapshots').locator('tbody tr')).toHaveText([/10.*1.*4.*Ada/, /10.*1.*4.*Ada/])
})

test('#7 csv: a title that starts like a formula is exported as text', async ({ page }) => {
  test.fail()
  await newListener(page)
  await importFiles(page, 1, { name: AUDIO, data: [play('2024-01-01T10:00:00Z', 3 * MIN, '+Band', '=HYPERLINK("http://example.com","x")')] })
  await section(page, 'Top lists')
  const [, csv] = await download(page, page.getByRole('button', { name: 'CSV' }))
  expect(readCsv(csv)[1].slice(1, 3)).toEqual(['\'=HYPERLINK("http://example.com","x")', "'+Band"])
})

test('#8 undo: taking back a rule keeps a setting changed since', async ({ page }) => {
  test.fail()
  await newListener(page)
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await section(page, 'Top lists')
  await page.locator('.toplist li').filter({ hasText: 'Gamma' }).getByRole('button', { name: 'Exclude' }).click()
  await section(page, 'Fix my Wrapped')
  const gap = panel(page, 'Definitions').getByLabel('New session after')
  await gap.fill('45')
  await expect(gap).toHaveValue('45')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.rules li')).toHaveCount(0)
  await expect(gap).toHaveValue('45', { timeout: 5000 })
})

test('#9 sessions: clocks going forward do not split one, clocks going back do not join two', async ({ page }) => {
  test.fail()
  await newListener(page, 'America/New_York')
  await importFiles(page, 4, { name: AUDIO, data: [
    // New York, 10 March 2024: 1:56-2:00 EST (06:56 UTC), then straight on at 3:00 EDT (07:00 UTC). One session.
    play('2024-03-10T06:56:00Z', 4 * MIN, 'Ada', 'Alpha'), play('2024-03-10T07:00:00Z', 4 * MIN, 'Ada', 'Alpha'),
    // 3 November 2024: 1:50-1:54 EDT (05:50 UTC), then 1:55 EST (06:55 UTC), 61 minutes later. Two sessions.
    play('2024-11-03T05:50:00Z', 4 * MIN, 'Ada', 'Alpha'), play('2024-11-03T06:55:00Z', 4 * MIN, 'Ada', 'Alpha'),
  ] })
  await section(page, 'Habits')
  // Three sessions: 8, 4 and 4 minutes, so a mean of 16 / 3 = 5.3. Split and joined the wrong way they are 4, 4 and 9.
  await expect(panel(page, 'Streaks')).toContainText('Average session5 min', { timeout: 5000 })
})

test('#10 history: the unfinished last month of the older request is not reported as changed', async ({ page }) => {
  test.fail()
  await newListener(page)
  await importFiles(page, 10, { name: AUDIO, data: HAND }) // ends on 3 February
  await importFiles(page, 11, { name: AUDIO, data: [...HAND, play('2024-02-20T10:00:00Z', 5 * MIN, 'Ada', 'Alpha')] })
  await section(page, 'History')
  await expect(page.getByRole('heading', { name: 'What changed since the last request' })).toBeVisible()
  await expect(page.getByText('Months already covered by the older snapshot changed')).toHaveCount(0, { timeout: 5000 })
})

test('#11 dates: the covered dates use the listener timezone they are labelled with', async ({ page }) => {
  test.fail()
  await newListener(page, 'America/New_York')
  // 02:00 UTC on 2 January is 9 pm on 1 January in New York.
  await importFiles(page, 1, { name: AUDIO, data: [play('2024-01-02T02:00:00Z', 3 * MIN, 'Ada', 'Alpha')] })
  await expect(page.getByText(/times in America\/New_York/)).toContainText('Jan 1, 2024 to Jan 1, 2024', { timeout: 5000 })
})

test('#12 empty: with everything excluded no section shows a busiest hour', async ({ page }) => {
  test.fail()
  await newListener(page)
  await importFiles(page, 1, { name: AUDIO, data: HAND.slice(0, 1) })
  await section(page, 'Top lists')
  await page.getByRole('button', { name: 'Exclude' }).click()
  await section(page, 'Habits')
  await expect(page.getByText('Every stream is excluded')).toBeVisible({ timeout: 5000 })
  await section(page, 'Year in review')
  await expect(page.getByText('Every stream is excluded')).toBeVisible({ timeout: 5000 })
})

test('#13 label: the plays tile names the threshold in force', async ({ page }) => {
  test.fail()
  await newListener(page)
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await section(page, 'Fix my Wrapped')
  await panel(page, 'Definitions').getByLabel('A play counts from').fill('60')
  await section(page, 'Overview')
  await expect(kpi(page, /^Plays/)).toContainText('60 s or more', { timeout: 5000 })
})

test('#14 suggestions: an artist called Train is not suggested as rain noise', async ({ page }) => {
  test.fail()
  await newListener(page)
  await importFiles(page, 25, { name: AUDIO, data: Array.from({ length: 25 }, (_, i) => play(`2024-01-${String(i + 1).padStart(2, '0')}T12:00:00Z`, 4 * MIN, 'Train', 'Braintree')) })
  await section(page, 'Fix my Wrapped')
  await expect(panel(page, 'Exclusion rules')).toBeVisible()
  await expect(page.getByText('25 streams mention “rain”')).toHaveCount(0, { timeout: 5000 })
})
