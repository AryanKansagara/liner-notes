import { AUDIO, download, expect, HAND, importFiles, kpi, newListener, panel, play, ranked, section, test } from './fixtures'
import { readFile } from 'node:fs/promises'

test('landing, docs, settings and unknown pages load', async ({ page }) => {
  for (const [path, h] of [['/', /./], ['/docs', /Getting your Spotify data/], ['/settings', /Settings/], ['/nowhere', /This track isn.t available/]] as const) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(h)
  }
  await page.goto('/app/p/no-such-listener')
  await expect(page.getByText('Listener not found')).toBeVisible()
})

test('a sample listener opens in every section, and its sleep sounds can be excluded', async ({ page }) => {
  await page.goto('/app')
  await page.getByRole('button', { name: /Theo/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Theo')
  await expect.poll(async () => (await ranked(panel(page, 'Top tracks')))[0]).toMatch(/Quiet Hours Collective/)
  for (const [s, h] of [['Top lists', /^Top tracks/], ['Habits', 'When you listen'], ['Rediscover', 'Lost favourites'], ['Fix my Wrapped', 'Exclusion rules'], ['Year in review', 'Story card'], ['History', 'Snapshots'], ['Data', 'Synthetic listener']] as const) {
    await section(page, s)
    await expect(page.getByRole('heading', { name: h }).first()).toBeVisible()
  }
  await section(page, 'History')
  await expect(page.getByRole('heading', { name: 'What changed since the last request' })).toBeVisible()
  await section(page, 'Fix my Wrapped')
  const rules = page.locator('.rules li')
  for (let i = 0, n = await rules.count(); i < n; i++) if (!await rules.nth(i).getByRole('checkbox').isChecked()) {
    await rules.nth(i).locator('.switch').click()
    await expect(rules.nth(i)).toHaveClass('on')
  }
  await expect.poll(async () => (await ranked(page.locator('.panel.after'))).join()).not.toMatch(/Quiet Hours|Puddle/)
  await section(page, 'Overview')
  await expect.poll(async () => (await ranked(panel(page, 'Top tracks'))).join()).not.toMatch(/Quiet Hours|Puddle/)
})

test('the second sample opens from its link and shows eras', async ({ page }) => {
  await page.goto('/app?sample=ines&tab=rediscover')
  await expect(panel(page, 'Eras')).toBeVisible()
  await expect(page).toHaveURL(/\/rediscover$/)
})

test('keyboard shortcuts switch sections and open help', async ({ page }) => {
  await newListener(page)
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await page.locator('h1').click()
  await page.keyboard.press('3')
  await expect(page.getByRole('heading', { name: 'When you listen' })).toBeVisible()
  await page.keyboard.press('f')
  await expect(page.getByRole('heading', { name: 'Exclusion rules' })).toBeVisible()
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('b')
  await expect(page).toHaveURL(/\/booklet$/)
})

test('history, rules and settings survive a reload', async ({ page }) => {
  await newListener(page)
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await section(page, 'Top lists')
  await page.locator('.toplist li').filter({ hasText: 'Gamma' }).getByRole('button', { name: 'Exclude' }).click()
  await section(page, 'Fix my Wrapped')
  await panel(page, 'Definitions').getByLabel('A play counts from').fill('31')
  await expect(panel(page, 'Definitions').getByLabel('A play counts from')).toHaveValue('31')
  await page.reload()
  await expect(panel(page, 'Definitions').getByLabel('A play counts from')).toHaveValue('31')
  await expect(page.locator('.rules li')).toHaveText([/Gamma \(Cleo\)matches 1 streams/])
  await section(page, 'Overview')
  await expect(kpi(page, /^Plays/).locator('b')).toHaveText('5') // 7 minus Gamma minus the 30 s row
  await section(page, 'Data')
  await expect(panel(page, 'Imports')).toContainText('10 streams on this device')
})

test('story cards download as 9:16 and square PNGs', async ({ page }) => {
  await newListener(page)
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await section(page, 'Year in review')
  const shots: Buffer[] = []
  for (const [format, kind, file, w, h] of [['9:16 story', 'Top tracks', 'liner-notes-tracks-2024-01-story.png', 1080, 1920], ['Square', 'Top artists', 'liner-notes-artists-2024-01-square.png', 1080, 1080], ['Square', 'Year summary', 'liner-notes-summary-2024-01-square.png', 1080, 1080]] as const) {
    const card = page.locator('.cards-panel')
    await card.getByRole('button', { name: format }).click()
    await card.getByRole('button', { name: kind }).click()
    await expect.poll(() => card.locator('canvas').evaluate((c: HTMLCanvasElement) => c.height)).toBe(h)
    const [d] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Download PNG' }).click()])
    expect(d.suggestedFilename()).toBe(file)
    const png = await readFile(await d.path())
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([w, h])
    shots.push(png)
  }
  expect(shots[1].equals(shots[2])).toBe(false)
})

test('the booklet prints the same numbers as the review', async ({ page }) => {
  const path = await newListener(page)
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await page.goto(`${path}/booklet`)
  await expect(page.locator('.bk-big')).toHaveText('55minutes')
  await expect(page.locator('.bk-cover')).toContainText('7 plays · 4 tracks · 4 artists')
  await expect(page.locator('.bk-tracks li').first()).toHaveText('AlphaAda15 m')
  await expect(page.locator('.bk-grid')).toHaveText('2day streak6sessions11%skipped4new artists')
  await expect(page.getByText('Mostly on Thus around 8 am (UTC)')).toBeVisible()
  await page.goto(`${path}/booklet?from=2024-02`)
  await expect(page.locator('.bk-big')).toHaveText('6minutes')
  await page.goto(`${path}/booklet?from=1999-99`) // not a month of this history: falls back to the last 12 months
  await expect(page.locator('.bk-big')).toHaveText('55minutes')
})

test('Spotify URIs are copied one per line', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await newListener(page)
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await section(page, 'Top lists')
  await page.getByRole('button', { name: 'Copy as Spotify URIs' }).click()
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(['AdaAlpha00000000000000', 'CleoGamma0000000000000', 'BexBeta000000000000000', 'DeeDelta00000000000000'].map(x => `spotify:track:${x}`).join('\n'))
})

test('snapshots: save, delete and undo', async ({ page }) => {
  await newListener(page)
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await section(page, 'History')
  const rows = panel(page, 'Snapshots').locator('tbody tr')
  await expect(rows).toHaveText([/Request of .*Jan 1, 2024 to Feb 3, 2024.*10.*1.*4.*Ada/])
  await page.getByRole('button', { name: 'Save a snapshot now' }).click()
  await expect(rows).toHaveCount(2)
  await rows.first().getByRole('button', { name: /^Delete/ }).click()
  await expect(rows).toHaveCount(1)
  await page.getByRole('button', { name: 'Undo' }).last().click()
  await expect(rows).toHaveCount(2)
})

test('rename, delete and undo a listener', async ({ page }) => {
  await newListener(page)
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await page.goto('/app')
  const card = page.locator('.project-card')
  await card.getByRole('button', { name: 'Rename' }).click()
  await page.getByLabel('Project name').fill('Family plan')
  await page.keyboard.press('Enter')
  await expect(card.getByRole('link', { name: 'Family plan' })).toBeVisible()
  await card.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete listener' }).click()
  await expect(card).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await card.getByRole('link', { name: 'Family plan' }).click()
  await expect(kpi(page, /^Plays/).locator('b')).toHaveText('7')
})

test('the full export holds the history but never an IP address, and everything can be deleted', async ({ page }) => {
  await newListener(page)
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await page.goto('/settings')
  const [name, text] = await download(page, page.getByRole('button', { name: 'Export all my data (JSON)' }))
  expect(name).toMatch(/^liner-notes-export-\d{4}-\d\d-\d\d\.json$/)
  const out = JSON.parse(text)
  expect(out.app).toBe('liner-notes')
  expect(out.projects).toHaveLength(1)
  expect(out.projects[0].dataset).toHaveLength(10)
  expect(out.projects[0].dataset[0]).toMatchObject({ ts: Date.UTC(2024, 0, 1, 10, 3), ms: 180_000, artist: 'Ada', track: 'Alpha', album: 'Ada LP', kind: 'track' })
  expect(text).not.toContain('203.0.113.7')
  await page.getByRole('button', { name: 'Delete all listeners' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete everything' }).click()
  await expect(page.getByText('Deleted 1 listeners')).toBeVisible()
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'Try the sample' })).toBeVisible()
})

test('defaults apply to new listeners, and an unknown timezone is refused', async ({ page }) => {
  await page.goto('/settings')
  await page.getByLabel('Timezone').fill('Mars/Olympus')
  await expect(page.getByText('Unknown timezone')).toBeVisible()
  await page.getByLabel('A play counts from').fill('45')
  await page.getByLabel('New session after').fill('30')
  await newListener(page)
  await importFiles(page, 10, { name: AUDIO, data: HAND })
  await section(page, 'Fix my Wrapped')
  await expect(panel(page, 'Definitions').getByLabel('A play counts from')).toHaveValue('45')
  await expect(panel(page, 'Definitions').getByLabel('New session after')).toHaveValue('30')
  await expect(panel(page, 'Definitions').getByLabel('Timezone')).toHaveValue('UTC')
})

test('markup and formulas in titles stay text in the app', async ({ page }) => {
  await newListener(page)
  await importFiles(page, 1, { name: AUDIO, data: [play('2024-01-01T10:00:00Z', 180_000, '<img src=x onerror="window.pwned=1">', '<script>window.pwned=1</script>')] })
  for (const s of ['Overview', 'Top lists', 'Fix my Wrapped', 'Year in review', 'History'] as const) {
    await section(page, s)
    await expect(page.getByText('<img src=x onerror="window.pwned=1">').first()).toBeVisible()
  }
  expect(await page.evaluate(() => 'pwned' in window)).toBe(false)
})

test('the theme is remembered', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('radio', { name: 'Light' }).click()
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
})
