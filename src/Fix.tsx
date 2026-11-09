import { useMemo, useState, type FormEvent } from 'react'
import { buildCtx, clock, peakHour, ruleReach, suggestRules, top, validTz } from './engine/analyze.ts'
import type { Rule, RuleKind } from './engine/types.ts'
import { Heatmap, TopList } from './charts.tsx'
import type { TabProps } from './Project.tsx'
import { addRule } from './projectData.ts'
import { uuid } from './store.ts'
import { DAYS, fmtHour, fmtHours, fmtN, toast } from './ui.tsx'

const KIND_LABEL: Record<RuleKind, string> = { artist: 'Artist', track: 'Track', keyword: 'Keyword', dates: 'Date range', incognito: 'Private sessions', podcasts: 'Podcasts & audiobooks' }

export function describeRule(r: Rule) {
  if (r.kind === 'dates') return `${r.value} to ${r.to || r.value}`
  if (r.kind === 'keyword') return `“${r.value}” in track, artist or album`
  if (r.kind === 'incognito') return 'Streams played in a private session'
  if (r.kind === 'podcasts') return 'All episodes and audiobook chapters'
  return r.label || r.value
}

export default function Fix({ project, ds, prep, setSettings }: TabProps) {
  const s = project.settings
  const base = useMemo(() => buildCtx(ds, s), [ds, s.tz, s.minPlaySec, s.sessionGapMin])
  const before = useMemo(() => ({ tracks: top(base, 'track', 'ms', 5), cl: clock(base) }), [base])
  const after = useMemo(() => { const cl = clock(prep.ctx); return { tracks: top(prep.ctx, 'track', 'ms', 5), artists: top(prep.ctx, 'artist', 'ms', 30), cl, peak: peakHour(cl) } }, [prep.ctx])
  const sugg = useMemo(() => suggestRules(base, s.rules), [base, s.rules])
  const reach = useMemo(() => Object.fromEntries(s.rules.map(r => [r.id, ruleReach(ds, { ...r, on: true }, s.tz, s.minPlaySec * 1000)])), [ds, s.rules, s.tz, s.minPlaySec])

  const setRules = (rules: Rule[], msg?: string) => {
    const prev = s.rules
    setSettings({ rules })
    if (msg) toast(msg, { undo: () => setSettings({ rules: prev }) })
  }

  const [kind, setKind] = useState<RuleKind>('keyword')
  const [value, setValue] = useState('')
  const [to, setTo] = useState('')
  const needsValue = kind !== 'incognito' && kind !== 'podcasts'
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = value.trim()
    if (needsValue && !v) return
    if (kind === 'dates' && to && to < v) { toast('The end date is before the start date', { tone: 'error' }); return }
    const rule: Rule = { id: uuid(), kind, value: v, to: kind === 'dates' ? to || v : undefined, label: kind === 'artist' ? v : undefined, on: true }
    if (kind === 'track') {
      const t = top(base, 'track', 'ms', 5000).find(x => `${x.name} · ${x.sub}` === v)
      if (!t) { toast('Pick a track from the list', { tone: 'error' }); return }
      rule.value = t.key; rule.label = `${t.name} (${t.sub})`
    }
    setRules([...s.rules, rule])
    toast(`Excluding ${describeRule(rule)}`, { tone: 'ok' })
    setValue(''); setTo('')
  }
  const trackOptions = useMemo(() => kind === 'track' ? top(base, 'track', 'ms', 300) : [], [base, kind])
  const [tz, setTz] = useState(s.tz)

  return (
    <>
      <div className="fix-compare">
        <div className="panel">
          <div className="panel-head"><h2>Before</h2><span className="muted small">raw history</span></div>
          <TopList rows={before.tracks} metric="ms" />
          <Heatmap clock={before.cl} label="Clock before" />
        </div>
        <div className="panel after">
          <div className="panel-head"><h2>After</h2><span className="good-text small">{prep.removed ? `${fmtN(prep.removed)} streams, ${fmtHours(prep.removedMs)} excluded` : 'no exclusions on'}</span></div>
          <TopList rows={after.tracks} metric="ms" />
          <Heatmap clock={after.cl} label="Clock after" />
        </div>
      </div>

      {sugg.length > 0 && (
        <div className="panel">
          <div className="panel-head"><h2>Suggested fixes</h2><span className="muted small">patterns that usually aren&rsquo;t your taste</span></div>
          <div className="sugg-list">
            {sugg.map(x => (
              <div className="sugg" key={x.rule.kind + x.rule.value}>
                <div><b>{x.rule.label}</b><small className="muted">{x.why} · {fmtHours(x.ms)}</small></div>
                <button type="button" className="btn primary sm" onClick={() => addRule(project, x.rule)}>Exclude</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head"><h2>Exclusion rules</h2><span className="muted small">Every chart, list, card and booklet recomputes without these streams</span></div>
        {s.rules.length ? (
          <ul className="rules">
            {s.rules.map(r => (
              <li key={r.id} className={r.on ? 'on' : ''}>
                <label className="switch" title={r.on ? 'Turn off' : 'Turn on'}><input type="checkbox" checked={r.on} aria-label={`${r.on ? 'Disable' : 'Enable'} rule ${describeRule(r)}`} onChange={() => setRules(s.rules.map(x => x.id === r.id ? { ...x, on: !x.on } : x))} /><span /></label>
                <span className="kind">{KIND_LABEL[r.kind]}</span>
                <span className="grow"><b>{describeRule(r)}</b><small className="muted block">matches {fmtN(reach[r.id]?.streams ?? 0)} streams · {fmtHours(reach[r.id]?.ms ?? 0)}{r.on && prep.impact[r.id] && prep.impact[r.id].streams < (reach[r.id]?.streams ?? 0) ? ` (${fmtN(prep.impact[r.id].streams)} not already caught by an earlier rule)` : ''}</small></span>
                <button type="button" className="btn danger-ghost sm" onClick={() => setRules(s.rules.filter(x => x.id !== r.id), `Removed rule: ${describeRule(r)}`)}>Remove</button>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No rules yet. Use a suggestion, the Exclude buttons on Top lists, or add one below.</p>}

        <form className="add-rule" onSubmit={submit}>
          <label className="field"><span>Exclude</span>
            <select value={kind} onChange={e => { setKind(e.target.value as RuleKind); setValue('') }}>
              {(Object.keys(KIND_LABEL) as RuleKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </label>
          {kind === 'artist' && <label className="field grow"><span>Artist</span><input list="artist-list" value={value} onChange={e => setValue(e.target.value)} placeholder="Start typing an artist" required /></label>}
          {kind === 'track' && <label className="field grow"><span>Track</span><input list="track-list" value={value} onChange={e => setValue(e.target.value)} placeholder="Start typing a track" required /></label>}
          {kind === 'keyword' && <label className="field grow"><span>Keyword</span><input value={value} onChange={e => setValue(e.target.value)} placeholder="sleep, rain, kids, lullaby…" required /></label>}
          {kind === 'dates' && <>
            <label className="field"><span>From</span><input type="date" value={value} onChange={e => setValue(e.target.value)} required /></label>
            <label className="field"><span>To</span><input type="date" value={to} min={value} onChange={e => setTo(e.target.value)} /></label>
          </>}
          <button className="btn primary" type="submit">Add rule</button>
          <datalist id="artist-list">{after.artists.map(a => <option key={a.key} value={a.name} />)}</datalist>
          <datalist id="track-list">{trackOptions.map(t => <option key={t.key} value={`${t.name} · ${t.sub}`} />)}</datalist>
        </form>
        <p className="muted small">Spotify lets you exclude playlists from your taste profile, but that only works going forward and only for playlists. These rules work on the whole history, for any artist, track, keyword or date range, and you can turn them off again.</p>
      </div>

      <div className="panel" id="settings">
        <div className="panel-head"><h2>Definitions</h2><span className="muted small">Busiest: {DAYS[after.peak.weekday]} {fmtHour(after.peak.hour)}</span></div>
        <div className="inline-fields">
          <label className="field"><span>A play counts from (seconds)</span><input type="number" min="0" max="600" value={s.minPlaySec} onChange={e => setSettings({ minPlaySec: Math.max(0, Math.min(600, Number(e.target.value) || 0)) })} /></label>
          <label className="field"><span>Timezone for clock and days</span><input value={tz} list="tz-list-p" aria-invalid={!validTz(tz)} onChange={e => { setTz(e.target.value); if (validTz(e.target.value)) setSettings({ tz: e.target.value }) }} /></label>
          <label className="field"><span>New session after (min)</span><input type="number" min="1" max="720" value={s.sessionGapMin} onChange={e => setSettings({ sessionGapMin: Math.max(1, Number(e.target.value) || 1) })} /></label>
        </div>
        <datalist id="tz-list-p">{(Intl.supportedValuesOf?.('timeZone') ?? []).map(z => <option key={z} value={z} />)}</datalist>
        <p className="muted small">Spotify counts a stream as a play from 30 seconds. Timestamps in the export are UTC; this timezone turns them into your local hours and days. If you moved, pick where you spent most of the time, or add a date-range rule for travel.</p>
      </div>
    </>
  )
}
