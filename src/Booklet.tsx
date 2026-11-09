import { useEffect, useMemo } from 'react'
import { discovery, lostFavourites, monthsBetween, trackIndex, yearInReview } from './engine/analyze.ts'
import { Heatmap } from './charts.tsx'
import { lastYearStart, usePrepared, useProject } from './projectData.ts'
import { reviewStartFromUrl } from './Review.tsx'
import { DAYS, Empty, fmtDay, fmtHour, fmtN, fmtPct, fmtYm, Link, ThemeToggle } from './ui.tsx'

const mmss = (ms: number) => { const m = Math.round(ms / 60_000); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:00` : `${m}:00` }

export default function Booklet({ id }: { id: string }) {
  const { loading, project, ds } = useProject(id)
  const prep = usePrepared(ds, project?.settings)
  const data = useMemo(() => {
    if (!prep?.range) return null
    const opts = monthsBetween(prep.range.from, prep.range.to)
    const start = reviewStartFromUrl(opts, lastYearStart(prep.range))
    const r = yearInReview(prep.ctx, start)
    const idx = trackIndex(prep.ctx)
    const endLoc = Math.min(prep.ctx.loc[prep.ctx.loc.length - 1], Date.UTC(+r.to.slice(0, 4), +r.to.slice(5, 7), 1))
    const lost = lostFavourites(idx, endLoc, { n: 8 })
    const disc = discovery(prep.ctx).filter(d => d.month >= r.from && d.month <= r.to).flatMap(d => d.examples).slice(0, 12)
    return { r, lost, disc }
  }, [prep])
  useEffect(() => { if (project) document.title = `Liner notes · ${project.name}` }, [project?.name])

  if (loading) return <div className="boot"><span className="spinner" /> Pressing the booklet</div>
  if (!project || !data) return <section className="page narrow"><Empty title="Nothing to print yet"><Link href="/app" className="btn primary">Back to listeners</Link></Empty></section>
  const { r, lost, disc } = data
  const name = project.name.replace(/\s*\(synthetic\).*$/i, '')

  return (
    <div className="booklet">
      <div className="report-actions">
        <Link href={`/app/p/${id}/review?from=${r.from}`} className="btn ghost sm">Back</Link>
        <ThemeToggle />
        <button type="button" className="btn primary sm" onClick={() => print()}>Print or save as PDF</button>
      </div>

      <section className="bk-page bk-cover">
        <div className="bk-label">Liner Notes</div>
        <h1>{name}</h1>
        <p className="bk-dates">{fmtYm(r.from)} – {fmtYm(r.to)}</p>
        <div className="bk-big">{fmtN(r.totals.ms / 60_000)}<small>minutes</small></div>
        <p className="bk-sub">{fmtN(r.totals.plays)} plays · {fmtN(r.totals.tracks)} tracks · {fmtN(r.totals.artists)} artists</p>
        {project.sampleId && <p className="bk-sub">Synthetic sample listener. Every artist and track is invented.</p>}
        <div className="bk-disc" aria-hidden="true" />
      </section>

      <section className="bk-page">
        <h2>Track listing</h2>
        <ol className="bk-tracks">
          {r.topTracks.map(t => <li key={t.key}><span className="bk-t">{t.name}<small>{t.sub}</small></span><span className="bk-d">{mmss(t.ms)}</span></li>)}
        </ol>
        <h2>Personnel</h2>
        <ul className="bk-credits">
          {r.topArtists.map((a, i) => <li key={a.key}><b>{a.name}</b> <span>{i === 0 ? 'lead artist' : i < 3 ? 'featured' : 'appears'} · {fmtN(a.ms / 60_000)} min, {fmtN(a.plays)} plays</span></li>)}
        </ul>
      </section>

      <section className="bk-page">
        <h2>Recorded at</h2>
        <p>Mostly on {DAYS[r.peak.weekday]}s around {fmtHour(r.peak.hour)} ({project.settings.tz}). The biggest day was {r.biggestDay ? `${fmtDay(r.biggestDay.date)}, with ${fmtN(r.biggestDay.ms / 60_000)} minutes` : '—'}.</p>
        <Heatmap clock={r.clock} />
        <div className="bk-grid">
          <div><b>{r.streak.longest.days}</b><small>day streak</small></div>
          <div><b>{fmtN(r.sessions.count)}</b><small>sessions</small></div>
          <div><b>{fmtPct(r.skip.rate)}</b><small>skipped</small></div>
          <div><b>{fmtN(r.newArtists)}</b><small>new artists</small></div>
        </div>
        {r.eras.length > 0 && <>
          <h2>Eras</h2>
          <ul className="bk-credits">{r.eras.map(e => <li key={e.from}><b>The {e.top[0]?.artist} era</b> <span>{fmtYm(e.from, true)} – {fmtYm(e.to, true)} · {e.top.slice(1).map(t => t.artist).join(', ')}</span></li>)}</ul>
        </>}
      </section>

      <section className="bk-page">
        {disc.length > 0 && <><h2>Discovered this year</h2><p className="bk-flow">{disc.join(' · ')}</p></>}
        {r.topAlbums.length > 0 && <><h2>Albums on repeat</h2><ul className="bk-credits">{r.topAlbums.map(a => <li key={a.key}><b>{a.name}</b> <span>{a.sub} · {fmtN(a.ms / 60_000)} min</span></li>)}</ul></>}
        {lost.length > 0 && <><h2>Lost favourites</h2><ul className="bk-credits">{lost.map(t => <li key={t.key}><b>{t.name}</b> <span>{t.artist} · {t.plays} plays, peak {fmtYm(t.peakMonth, true)}</span></li>)}</ul></>}
        <p className="bk-colophon">Compiled from Spotify Extended Streaming History with Liner Notes. A play is {project.settings.minPlaySec} seconds or more. {project.settings.rules.filter(x => x.on).length ? `${project.settings.rules.filter(x => x.on).length} exclusion rule(s) applied.` : 'No exclusions applied.'} Independent project, not affiliated with Spotify.</p>
      </section>
    </div>
  )
}
