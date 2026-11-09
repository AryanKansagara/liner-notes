import { useEffect, useMemo, useRef, useState } from 'react'
import { monthsBetween, yearInReview } from './engine/analyze.ts'
import { canvasBlob, drawCard, type CardFormat, type CardKind, type CardTheme } from './cards.ts'
import { Heatmap, MonthBars, Stat, TopList } from './charts.tsx'
import type { TabProps } from './Project.tsx'
import { lastYearStart } from './projectData.ts'
import { DAYS, download, fmtDay, fmtHour, fmtN, fmtPct, fmtYm, Link, toast } from './ui.tsx'

export const reviewStartFromUrl = (opts: string[], def: string) => {
  const q = new URLSearchParams(location.search).get('from')
  return q && opts.includes(q) ? q : def
}

export default function Review({ project, prep }: TabProps) {
  const { ctx, range } = prep
  const opts = useMemo(() => range ? monthsBetween(range.from, range.to).reverse() : [], [range])
  const [start, setStart] = useState(() => reviewStartFromUrl(opts, lastYearStart(range)))
  const r = useMemo(() => start ? yearInReview(ctx, start) : null, [ctx, start])
  const pick = (m: string) => { setStart(m); history.replaceState({}, '', `${location.pathname}?from=${m}`) }
  if (!r) return null
  const calYears = opts.filter(m => m.endsWith('-01'))
  return (
    <>
      <div className="panel review-head">
        <div>
          <div className="eyebrow">Year in review</div>
          <h2 className="review-title">{fmtYm(r.from)} <span className="muted">to</span> {fmtYm(r.to)}</h2>
        </div>
        <div className="row gap wrap">
          <label className="field inline"><span>Start month</span>
            <select value={start} onChange={e => pick(e.target.value)}>{opts.map(m => <option key={m} value={m}>{fmtYm(m)}</option>)}</select>
          </label>
          <div className="seg-control" aria-label="Quick picks">
            <button type="button" className={start === lastYearStart(range) ? 'on' : ''} onClick={() => pick(lastYearStart(range))}>Last 12 months</button>
            {calYears.slice(0, 4).map(m => <button type="button" key={m} className={start === m ? 'on' : ''} onClick={() => pick(m)}>{m.slice(0, 4)}</button>)}
          </div>
          <Link href={`/app/p/${project.id}/booklet?from=${start}`} className="btn primary sm">Print booklet</Link>
        </div>
      </div>

      <div className="kpis">
        <Stat label="Minutes" value={fmtN(r.totals.ms / 60_000)} note={`${fmtN(r.totals.plays)} plays · ${fmtN(r.totals.tracks)} tracks`} />
        <Stat label="Top artist" value={<span className="kpi-text">{r.topArtists[0]?.name ?? '—'}</span>} note={r.topArtists[0] ? `${fmtN(r.topArtists[0].ms / 60_000)} min` : ''} />
        <Stat label="New artists" value={fmtN(r.newArtists)} note={`of ${fmtN(r.totals.artists)} you played`} />
        <Stat label="Biggest day" value={r.biggestDay ? fmtDay(r.biggestDay.date) : '—'} note={r.biggestDay ? `${fmtN(r.biggestDay.ms / 60_000)} min` : ''} />
      </div>

      <StoryCards project={project} r={r} />

      <div className="grid-2">
        <div className="panel"><div className="panel-head"><h2>Top tracks</h2></div><TopList rows={r.topTracks.slice(0, 10)} metric="ms" /></div>
        <div className="panel"><div className="panel-head"><h2>Top artists</h2></div><TopList rows={r.topArtists.slice(0, 10)} metric="ms" /></div>
      </div>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>The shape of the year</h2></div>
          <MonthBars label="Hours per month" data={r.months.map(m => ({ month: m.month, value: m.ms / 3_600_000 }))} fmt={v => `${fmtN(v, 1)} h`} height={130} />
          <dl className="facts">
            <div><dt>Top album</dt><dd>{r.topAlbums[0] ? `${r.topAlbums[0].name}` : '—'}<small>{r.topAlbums[0]?.sub}</small></dd></div>
            <div><dt>Top podcast</dt><dd>{r.topShows[0]?.name ?? 'None'}<small>{r.topShows[0] ? `${fmtN(r.topShows[0].ms / 60_000)} min` : ''}</small></dd></div>
            <div><dt>First song of the window</dt><dd>{r.firstTrack ? r.firstTrack.name : '—'}<small>{r.firstTrack?.artist}</small></dd></div>
            <div><dt>Skip rate</dt><dd>{fmtPct(r.skip.rate)}</dd></div>
            <div><dt>Longest streak</dt><dd>{r.streak.longest.days} days</dd></div>
          </dl>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>When you listened</h2><span className="muted small">{DAYS[r.peak.weekday]}s, {fmtHour(r.peak.hour)}</span></div>
          <Heatmap clock={r.clock} />
          {r.eras.length > 0 && <p className="small" style={{ marginTop: 14 }}>Eras in this window: {r.eras.map(e => <b key={e.from} className="era-chip">{e.top[0]?.artist}</b>)}</p>}
        </div>
      </div>
    </>
  )
}

function StoryCards({ project, r }: { project: TabProps['project']; r: ReturnType<typeof yearInReview> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [format, setFormat] = useState<CardFormat>('story')
  const [kind, setKind] = useState<CardKind>('tracks')
  const [theme, setTheme] = useState<CardTheme>('green')
  const name = project.name.replace(/\s*\(synthetic\).*$/i, '')
  useEffect(() => { if (ref.current) void drawCard(ref.current, r, { format, kind, theme, name: `${name}`, synthetic: !!project.sampleId }) }, [r, format, kind, theme, name, project.sampleId])
  const file = `liner-notes-${kind}-${r.from}-${format}.png`
  const save = async () => { if (ref.current) download(file, await canvasBlob(ref.current)) }
  const share = async () => {
    if (!ref.current) return
    const f = new File([await canvasBlob(ref.current)], file, { type: 'image/png' })
    if (navigator.canShare?.({ files: [f] })) { try { await navigator.share({ files: [f], title: 'My year in music' }) } catch { /* cancelled */ } }
    else {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': f })]); toast('Image copied', { tone: 'ok' }) } catch { void save() }
    }
  }
  return (
    <div className="panel cards-panel">
      <div className="card-preview"><canvas ref={ref} className={format} aria-label={`Story card preview: ${kind}`} /></div>
      <div className="card-controls">
        <h2>Story card</h2>
        <p className="muted small">Rendered on a canvas at full resolution, ready for Instagram, TikTok or a group chat.</p>
        <div className="field"><span>Format</span><div className="seg-control">{([['story', '9:16 story'], ['square', 'Square']] as const).map(([k, l]) => <button type="button" key={k} className={format === k ? 'on' : ''} aria-pressed={format === k} onClick={() => setFormat(k)}>{l}</button>)}</div></div>
        <div className="field"><span>Content</span><div className="seg-control">{([['tracks', 'Top tracks'], ['artists', 'Top artists'], ['summary', 'Year summary']] as const).map(([k, l]) => <button type="button" key={k} className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}</div></div>
        <div className="field"><span>Colour</span><div className="swatches">{(['green', 'night', 'sunset'] as const).map(t => <button type="button" key={t} className={`swatch ${t}${theme === t ? ' on' : ''}`} aria-label={`${t} theme`} aria-pressed={theme === t} onClick={() => setTheme(t)} />)}</div></div>
        <div className="row gap wrap">
          <button type="button" className="btn primary" onClick={save}>Download PNG</button>
          <button type="button" className="btn outline" onClick={share}>Share or copy</button>
        </div>
      </div>
    </div>
  )
}
