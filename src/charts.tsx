import { useState, type ReactNode } from 'react'
import type { Era, TopRow } from './engine/analyze.ts'
import { DAYS, fmtHour, fmtMinutes, fmtN, fmtYm } from './ui.tsx'

/** Hour x weekday listening clock. Cell intensity is relative to the busiest hour. */
export function Heatmap({ clock, label = 'Listening clock' }: { clock: number[]; label?: string }) {
  const max = Math.max(1, ...clock)
  return (
    <div className="heat" role="img" aria-label={`${label}: minutes by weekday and hour`}>
      <span />
      {Array.from({ length: 24 }, (_, h) => <span key={h} className="hh">{h % 3 === 0 ? (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? h : h - 12) : ''}</span>)}
      {DAYS.map((d, wd) => [
        <span key={d} className="hl">{d}</span>,
        ...Array.from({ length: 24 }, (_, h) => {
          const v = clock[wd * 24 + h]
          const pct = Math.round(Math.sqrt(v / max) * 100)
          return <span key={`${d}${h}`} className={`c${v > 0 ? ' v' : ''}`} style={{ ['--v' as string]: `${pct}%` }} title={`${d} ${fmtHour(h)}: ${fmtN(v)} min`} />
        }),
      ])}
    </div>
  )
}

/** Spotify-style ranked list. */
export function TopList({ rows, metric, action, empty = 'Nothing here yet' }: { rows: TopRow[]; metric: 'ms' | 'plays'; action?: (r: TopRow) => ReactNode; empty?: string }) {
  if (!rows.length) return <p className="muted small">{empty}</p>
  const max = Math.max(...rows.map(r => metric === 'ms' ? r.ms : r.plays)) || 1
  return (
    <ol className="toplist">
      {rows.map(r => {
        const v = metric === 'ms' ? r.ms : r.plays
        return (
          <li key={r.key}>
            <span className="tl-rank">{r.rank}</span>
            <span className="tl-art" aria-hidden="true" style={{ ['--h' as string]: hue(r.sub || r.name) }}>{initials(r.name)}</span>
            <span className="tl-main">
              <b title={r.name}>{r.name}</b>
              {r.sub && <small>{r.sub}</small>}
              <i className="tl-bar"><i style={{ width: `${(v / max) * 100}%` }} /></i>
            </span>
            <span className="tl-val">{metric === 'ms' ? `${fmtMinutes(r.ms)} min` : `${fmtN(r.plays)} plays`}</span>
            {action && <span className="tl-act">{action(r)}</span>}
          </li>
        )
      })}
    </ol>
  )
}

export const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360 }
export const initials = (s: string) => s.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '♪'

/** Vertical bars by month with hover values. */
export function MonthBars({ data, fmt = v => fmtN(v), height = 160, label }: { data: { month: string; value: number; tone?: 'muted' }[]; fmt?: (v: number) => string; height?: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null)
  if (!data.length) return null
  const max = Math.max(1, ...data.map(d => d.value))
  const w = 1000, bw = w / data.length
  const yearTicks = data.map((d, i) => ({ d, i })).filter(({ d, i }) => d.month.endsWith('-01') || i === 0)
  const h = hover !== null ? data[hover] : null
  return (
    <figure className="mbars">
      <figcaption className="row between small"><span className="muted">{label}</span><span className="tab-nums">{h ? `${fmtYm(h.month, true)}: ${fmt(h.value)}` : ''}</span></figcaption>
      <svg viewBox={`0 0 ${w} ${height + 18}`} preserveAspectRatio="none" role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => {
          const bh = (d.value / max) * height
          return <rect key={d.month} x={i * bw + bw * 0.12} width={Math.max(1, bw * 0.76)} y={height - bh} height={Math.max(bh, d.value ? 1.5 : 0)} rx={Math.min(3, bw / 4)} className={`${d.tone ?? ''}${hover === i ? ' on' : ''}`} onMouseEnter={() => setHover(i)}><title>{`${fmtYm(d.month, true)}: ${fmt(d.value)}`}</title></rect>
        })}
        {yearTicks.map(({ d, i }) => <text key={d.month} x={i * bw + 2} y={height + 14} className="tick">{d.month.slice(0, 4)}</text>)}
      </svg>
    </figure>
  )
}

/** Eras as a horizontal timeline. */
export function EraStrip({ eras, onPick }: { eras: Era[]; onPick?: (e: Era) => void }) {
  const total = eras.reduce((a, e) => a + e.months, 0) || 1
  return (
    <div className="eras">
      <div className="era-bar">
        {eras.map(e => (
          <button type="button" key={e.from} style={{ flexGrow: e.months, ['--h' as string]: hue(e.top[0]?.artist ?? '') }} onClick={() => onPick?.(e)} title={`${fmtYm(e.from, true)} to ${fmtYm(e.to, true)}`} aria-label={`The ${e.top[0]?.artist} era, ${fmtYm(e.from, true)} to ${fmtYm(e.to, true)}`}>
            <span>{e.months / total > 0.12 ? e.top[0]?.artist : ''}</span>
          </button>
        ))}
      </div>
      <ol className="era-list">
        {eras.map(e => (
          <li key={e.from} style={{ ['--h' as string]: hue(e.top[0]?.artist ?? '') }}>
            <i aria-hidden="true" />
            <div>
              <b>The {e.top[0]?.artist} era</b>
              <small>{fmtYm(e.from, true)} to {fmtYm(e.to, true)} · {e.months} months · {fmtN(e.ms / 3_600_000)} h</small>
              <small className="muted">{e.top.map(t => `${t.artist} ${Math.round(t.share * 100)}%`).join(' · ')}</small>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function Stat({ label, value, note, was }: { label: string; value: ReactNode; note?: ReactNode; was?: ReactNode }) {
  return <div className="kpi"><small>{label}</small><b>{value}</b>{was !== undefined && <span className="was">{was}</span>}{note && <p>{note}</p>}</div>
}
