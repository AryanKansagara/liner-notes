import { useMemo, useState } from 'react'
import {
  clock, discovery, eras, firstListens, lostFavourites, monthly, openUrl, peakHour, sessions, sessionStats, skipStats, sliceCtx, streaks,
  suggestRules, toCsv, top, totals, trackIndex, uriList, type Metric, type TopBy, type TopRow,
} from './engine/analyze.ts'
import { EraStrip, Heatmap, MonthBars, Stat, TopList } from './charts.tsx'
import type { Tab, TabProps } from './Project.tsx'
import { addRule, lastYearStart } from './projectData.ts'
import { CopyButton, DAYS, download, Empty, fmtDay, fmtHour, fmtHours, fmtN, fmtPct, fmtYm, Link } from './ui.tsx'

export default function Tabs(props: TabProps & { tab: Tab }) {
  if (props.tab === 'top') return <TopTab {...props} />
  if (props.tab === 'habits') return <Habits {...props} />
  if (props.tab === 'rediscover') return <Rediscover {...props} />
  return <Overview {...props} />
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// ---------- Overview ----------

function Overview({ project, prep }: TabProps) {
  const { ctx } = prep
  const d = useMemo(() => {
    const cl = clock(ctx)
    return { t: totals(ctx), cl, peak: peakHour(cl), months: monthly(ctx), artists: top(ctx, 'artist', 'ms', 5), tracks: top(ctx, 'track', 'ms', 5), eras: eras(ctx), sugg: suggestRules(ctx, project.settings.rules), st: streaks(ctx) }
  }, [ctx, project.settings.rules])
  if (!ctx.s.length) return <Empty title="Every stream is excluded"><p className="muted">Your exclusion rules hide the whole history. <Link href={`/app/p/${project.id}/fix`}>Review the rules</Link>.</p></Empty>
  const noisy = d.sugg.filter(s => s.rule.kind === 'keyword' || s.rule.kind === 'artist')
  return (
    <>
      {noisy.length > 0 && (
        <div className="banner warn">
          <span><b>Your stats may be polluted.</b> {noisy[0].why}{noisy.length > 1 ? ` and ${noisy.length - 1} more pattern${noisy.length > 2 ? 's' : ''} look like sleep, noise or kids' audio.` : '.'}</span>
          <Link href={`/app/p/${project.id}/fix`} className="btn primary sm">Fix my Wrapped</Link>
        </div>
      )}
      <div className="kpis">
        <Stat label="Hours listened" value={fmtN(d.t.ms / 3_600_000)} note={`${fmtN(d.t.musicMs / 60_000)} min of music, ${fmtN(d.t.talkMs / 60_000)} of podcasts`} />
        <Stat label="Plays (30 s or more)" value={fmtN(d.t.plays)} note={`${fmtN(d.t.tracks)} different tracks`} />
        <Stat label="Artists" value={fmtN(d.t.artists)} note={`${fmtN(d.t.activeDays)} days with music`} />
        <Stat label="Longest streak" value={`${d.st.longest.days} days`} note={d.st.longest.days ? `${fmtDay(d.st.longest.from)} to ${fmtDay(d.st.longest.to)}` : ''} />
      </div>
      <div className="panel">
        <MonthBars label="Hours per month" data={d.months.map(m => ({ month: m.month, value: m.ms / 3_600_000 }))} fmt={v => `${fmtN(v, 1)} h`} />
      </div>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>Top artists</h2><Link href={`/app/p/${project.id}/top`} className="small">All top lists</Link></div>
          <TopList rows={d.artists} metric="ms" />
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Top tracks</h2><span className="muted small">all time</span></div>
          <TopList rows={d.tracks} metric="ms" />
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Listening clock</h2><span className="muted small">Busiest: {DAYS[d.peak.weekday]}s around {fmtHour(d.peak.hour)} · {project.settings.tz}</span></div>
        <Heatmap clock={d.cl} />
      </div>
      {d.eras.length > 0 && (
        <div className="panel">
          <div className="panel-head"><h2>Your eras</h2><span className="muted small">Runs of months with a similar artist mix</span></div>
          <EraStrip eras={d.eras} />
        </div>
      )}
    </>
  )
}

// ---------- Top lists for any date range ----------

function TopTab({ project, prep }: TabProps) {
  const { ctx, range } = prep
  const years = useMemo(() => range ? Array.from({ length: +range.to.slice(0, 4) - +range.from.slice(0, 4) + 1 }, (_, i) => String(+range.to.slice(0, 4) - i)) : [], [range])
  const [preset, setPreset] = useState('12m')
  const [from, setFrom] = useState(range?.from ?? '')
  const [to, setTo] = useState(range?.to ?? '')
  const [by, setBy] = useState<TopBy>('track')
  const [metric, setMetric] = useState<Metric>('ms')
  const win = preset === 'all' ? [undefined, undefined] : preset === '12m' ? [lastYearStart(range), range?.to] : preset === 'custom' ? [from || undefined, to || undefined] : [`${preset}-01`, `${preset}-12`]
  const rows = useMemo(() => top(win[0] || win[1] ? sliceCtx(ctx, win[0], win[1]) : ctx, by, metric, 50), [ctx, win[0], win[1], by, metric])
  const label = preset === 'all' ? 'All time' : preset === '12m' ? 'Last 12 months' : preset === 'custom' ? `${from ? fmtYm(from, true) : 'Start'} to ${to ? fmtYm(to, true) : 'end'}` : preset
  const csv = () => download(`top-${by}s-${slug(label)}.csv`, toCsv(['rank', 'name', 'artist', 'minutes', 'plays', 'uri'], rows.map(r => [r.rank, r.name, r.sub, Math.round(r.ms / 60_000), r.plays, r.uri])))
  return (
    <div className="panel">
      <div className="filters">
        <div className="seg-control" role="radiogroup" aria-label="Date range">
          {[['12m', 'Last 12 months'], ['all', 'All time'], ...years.map(y => [y, y]), ['custom', 'Custom']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={preset === k} className={preset === k ? 'on' : ''} onClick={() => setPreset(k)}>{l}</button>)}
        </div>
        {preset === 'custom' && (
          <div className="row gap wrap">
            <label className="field inline"><span>From</span><input type="month" value={from} min={range?.from} max={range?.to} onChange={e => setFrom(e.target.value)} /></label>
            <label className="field inline"><span>To</span><input type="month" value={to} min={range?.from} max={range?.to} onChange={e => setTo(e.target.value)} /></label>
          </div>
        )}
        <div className="row gap wrap">
          <div className="seg-control" role="radiogroup" aria-label="Group by">
            {([['track', 'Tracks'], ['artist', 'Artists'], ['album', 'Albums'], ['show', 'Podcasts']] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={by === k} className={by === k ? 'on' : ''} onClick={() => setBy(k)}>{l}</button>)}
          </div>
          <div className="seg-control" role="radiogroup" aria-label="Rank by">
            {([['ms', 'Minutes'], ['plays', 'Plays']] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={metric === k} className={metric === k ? 'on' : ''} onClick={() => setMetric(k)}>{l}</button>)}
          </div>
        </div>
      </div>
      <div className="panel-head">
        <h2>Top {by === 'show' ? 'podcasts' : by + 's'} · {label}</h2>
        <div className="row gap-sm">
          {by === 'track' && <CopyButton text={uriList(rows)} label="Copy as Spotify URIs" />}
          <button type="button" className="btn ghost sm" onClick={csv} disabled={!rows.length}>CSV</button>
        </div>
      </div>
      <TopList rows={rows} metric={metric} empty="No listening in this range." action={by === 'artist' || by === 'track' ? (r: TopRow) => (
        <button type="button" className="btn ghost sm" title={`Exclude ${r.name} everywhere`} onClick={() => addRule(project, by === 'artist' ? { kind: 'artist', value: r.name, label: r.name } : { kind: 'track', value: r.key, label: `${r.name} (${r.sub})` })}>Exclude</button>
      ) : undefined} />
      {by === 'track' && <p className="muted small paste-hint">To make a playlist: copy the URIs, open a playlist in the Spotify desktop app, click inside the track list and press <kbd>Ctrl</kbd>/<kbd>&#8984;</kbd> <kbd>V</kbd>.</p>}
    </div>
  )
}

// ---------- Habits: clock, skips, sessions, streaks, discovery ----------

function Habits({ project, prep }: TabProps) {
  const { ctx } = prep
  const d = useMemo(() => {
    const cl = clock(ctx)
    return { cl, peak: peakHour(cl), skip: skipStats(ctx), ss: sessionStats(sessions(ctx)), st: streaks(ctx), disc: discovery(ctx) }
  }, [ctx])
  const avgRate = d.disc.length ? d.disc.reduce((a, m) => a + m.rate, 0) / d.disc.filter(m => m.artists).length : 0
  const csvSkips = () => download('songs-you-always-skip.csv', toCsv(['track', 'artist', 'starts', 'skips', 'skip_rate', 'uri'], d.skip.always.map(r => [r.name, r.artist, r.starts, r.skips, r.rate.toFixed(2), r.uri])))
  return (
    <>
      <div className="kpis">
        <Stat label="Skip rate" value={fmtPct(d.skip.rate)} note={`${fmtN(d.skip.skips)} of ${fmtN(d.skip.starts)} track starts`} />
        <Stat label="Sessions" value={fmtN(d.ss.count)} note={`median ${fmtN(d.ss.medianMin)} min, gap ${project.settings.sessionGapMin} min`} />
        <Stat label="Current streak" value={`${d.st.current} day${d.st.current === 1 ? '' : 's'}`} note={`longest ${d.st.longest.days} days`} />
        <Stat label="Discovery rate" value={fmtPct(avgRate)} note="of artists each month are new to you" />
      </div>
      <div className="panel">
        <div className="panel-head"><h2>When you listen</h2><span className="muted small">{project.settings.tz} · <Link href={`/app/p/${project.id}/fix#settings`}>change</Link></span></div>
        <Heatmap clock={d.cl} />
        <div className="hour-bars" aria-hidden="true">{d.peak.byHour.map((v, h) => <i key={h} style={{ height: `${(v / Math.max(...d.peak.byHour)) * 100}%` }} title={fmtHour(h)} />)}</div>
        <p className="muted small">Peak hour {fmtHour(d.peak.hour)}; busiest day {DAYS[d.peak.weekday]}. Longest session {d.ss.longest ? `${fmtHours(d.ss.longest.end - d.ss.longest.start)} on ${fmtDay(new Date(d.ss.longest.start).toISOString().slice(0, 10))} (${d.ss.longest.n} streams)` : '—'}.</p>
      </div>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>Songs you always skip</h2><div className="row gap-sm"><CopyButton text={uriList(d.skip.always)} label="Copy URIs" /><button type="button" className="btn ghost sm" onClick={csvSkips} disabled={!d.skip.always.length}>CSV</button></div></div>
          <p className="muted small">At least 5 starts and skipped 60% of the time or more. A skip is Spotify&rsquo;s own flag or pressing next; with the basic export, anything under {Math.round(ctx.minMs / 1000)} s.</p>
          {d.skip.always.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Track</th><th className="num">Starts</th><th className="num">Skipped</th></tr></thead>
              <tbody>{d.skip.always.slice(0, 15).map(r => <tr key={r.key}><th><span className="cell-title">{r.name}</span><small className="muted block">{r.artist}</small></th><td className="num">{r.starts}</td><td className="num">{fmtPct(r.rate)}</td></tr>)}</tbody>
            </table></div>
          ) : <p className="muted">Nothing you skip that consistently.</p>}
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Streaks</h2></div>
          <dl className="facts">
            <div><dt>Longest daily streak</dt><dd>{d.st.longest.days} days<small>{d.st.longest.days ? `${fmtDay(d.st.longest.from)} to ${fmtDay(d.st.longest.to)}` : ''}</small></dd></div>
            <div><dt>Longest single-artist streak</dt><dd>{d.st.artist.days} days of {d.st.artist.artist || '—'}<small>{d.st.artist.days ? `${fmtDay(d.st.artist.from)} to ${fmtDay(d.st.artist.to)}` : ''}</small></dd></div>
            <div><dt>Days with at least one play</dt><dd>{fmtN(d.st.activeDays)}</dd></div>
            <div><dt>Average session</dt><dd>{fmtN(d.ss.avgMin)} min</dd></div>
          </dl>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Discovery: new artists per month</h2><span className="muted small">first ever play in this history</span></div>
        <MonthBars label="New artists" data={d.disc.map(m => ({ month: m.month, value: m.newArtists }))} fmt={v => `${fmtN(v)} new artists`} height={120} />
        <p className="muted small">Busiest discovery month: {(() => { const b = [...d.disc].sort((a, b) => b.newArtists - a.newArtists)[0]; return b ? `${fmtYm(b.month)} (${b.newArtists} new, including ${b.examples.join(', ')})` : '—' })()}. The first months of any history look high because everything is new.</p>
      </div>
    </>
  )
}

// ---------- Rediscover: first listens, lost favourites, eras ----------

function Rediscover({ prep }: TabProps) {
  const { ctx } = prep
  const index = useMemo(() => trackIndex(ctx), [ctx])
  const [q, setQ] = useState('')
  const [quiet, setQuiet] = useState(180)
  const [minPlays, setMinPlays] = useState(10)
  const endLoc = ctx.loc.length ? ctx.loc[ctx.loc.length - 1] : 0
  const lost = useMemo(() => lostFavourites(index, endLoc, { quietDays: quiet, minPlays, n: 60 }), [index, endLoc, quiet, minPlays])
  const hits = useMemo(() => firstListens(index, q), [index, q])
  const ers = useMemo(() => eras(ctx), [ctx])
  const csvLost = () => download('lost-favourites.csv', toCsv(['track', 'artist', 'plays', 'peak_month', 'last_played', 'days_since', 'uri'], lost.map(t => [t.name, t.artist, t.plays, t.peakMonth, new Date(t.last).toISOString().slice(0, 10), t.daysSince, t.uri])))
  return (
    <>
      <div className="panel">
        <div className="panel-head"><h2>First listens</h2><span className="muted small">press <kbd>/</kbd> to search</span></div>
        <label className="field"><span className="sr-only">Search a song, artist or album</span><input id="first-q" type="search" placeholder="Search a song, artist or album" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" /></label>
        {q.trim() && (hits.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Track</th><th>First played</th><th>Peak month</th><th className="num">Plays</th><th /></tr></thead>
            <tbody>{hits.map(t => (
              <tr key={t.key}>
                <th><span className="cell-title">{t.name}</span><small className="muted block">{t.artist}</small></th>
                <td>{new Date(t.firstLoc).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })}</td>
                <td>{fmtYm(t.peakMonth, true)} <small className="muted">({t.peakPlays})</small></td>
                <td className="num">{fmtN(t.plays)}</td>
                <td>{t.uri && <a className="btn ghost sm" href={openUrl(t.uri)} target="_blank" rel="noreferrer">Open</a>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="muted">No played track matches &ldquo;{q}&rdquo;.</p>)}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Lost favourites</h2>
          <div className="row gap-sm wrap">
            <CopyButton text={uriList(lost)} label="Copy as Spotify URIs" />
            <button type="button" className="btn ghost sm" onClick={csvLost} disabled={!lost.length}>CSV</button>
          </div>
        </div>
        <div className="row gap wrap">
          <label className="field inline"><span>Silent for at least</span><select value={quiet} onChange={e => setQuiet(+e.target.value)}>{[90, 180, 365, 730].map(d => <option key={d} value={d}>{d >= 365 ? `${d / 365} year${d > 365 ? 's' : ''}` : `${d / 30} months`}</option>)}</select></label>
          <label className="field inline"><span>Played at least</span><select value={minPlays} onChange={e => setMinPlays(+e.target.value)}>{[5, 10, 20, 40].map(n => <option key={n} value={n}>{n} times</option>)}</select></label>
        </div>
        {lost.length ? (
          <ol className="lost">
            {lost.slice(0, 24).map(t => (
              <li key={t.key}>
                <b>{t.name}</b><small>{t.artist}</small>
                <span className="muted small">{t.plays} plays, peak {fmtYm(t.peakMonth, true)} · last heard {fmtN(t.daysSince)} days ago</span>
              </li>
            ))}
          </ol>
        ) : <Empty title="No lost favourites with these settings"><p className="muted small">Try a shorter silence or fewer plays.</p></Empty>}
        <p className="muted small paste-hint">Copy the URIs, open a new playlist in the Spotify desktop app, click the track list and paste with <kbd>Ctrl</kbd>/<kbd>&#8984;</kbd> <kbd>V</kbd>. Tracks from the basic export have no URI and are left out.</p>
      </div>

      {ers.length > 0 && (
        <div className="panel">
          <div className="panel-head"><h2>Eras</h2><span className="muted small">{ers.length} eras from {fmtYm(ers[0].from, true)} to {fmtYm(ers.at(-1)!.to, true)}</span></div>
          <EraStrip eras={ers} />
        </div>
      )}
    </>
  )
}

