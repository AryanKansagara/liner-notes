import { useMemo, useState } from 'react'
import { compareSnapshots, snapshot, type Snapshot } from './engine/analyze.ts'
import type { Prepared } from './projectData.ts'
import type { Project } from './store.ts'
import { uuid } from './store.ts'
import { deleteSnapshotCloud } from './sync.ts'
import { Empty, fmtDate, fmtN, signed, toast } from './ui.tsx'

export default function History({ project, update, prep }: { project: Project; update(p: Partial<Project>): void; prep: Prepared | null }) {
  const snaps = useMemo(() => [...project.snapshots].sort((a, b) => a.at - b.at), [project.snapshots])
  const [aId, setA] = useState<string | null>(null)
  const [bId, setB] = useState<string | null>(null)
  const b = snaps.find(s => s.id === bId) ?? snaps.at(-1)
  const a = snaps.find(s => s.id === aId) ?? snaps.filter(s => s !== b).at(-1)
  const diff = useMemo(() => a && b && a !== b ? compareSnapshots(a, b) : null, [a, b])

  const saveNow = () => {
    if (!prep?.ctx.s.length) { toast('Import data first', { tone: 'error' }); return }
    const s = snapshot(prep.ctx, uuid(), `Snapshot of ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`)
    update({ snapshots: [...project.snapshots, s] })
    toast('Snapshot saved', { tone: 'ok', undo: () => update({ snapshots: project.snapshots }) })
  }
  const remove = (s: Snapshot) => {
    const prev = project.snapshots
    update({ snapshots: prev.filter(x => x.id !== s.id) })
    void deleteSnapshotCloud(s.id)
    toast(`Deleted ${s.label}`, { undo: () => update({ snapshots: prev }) })
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>Snapshots</h2>
          <button type="button" className="btn outline sm" onClick={saveNow}>Save a snapshot now</button>
        </div>
        <p className="muted small">One is saved automatically for each import. A snapshot keeps totals, the top 25 artists and tracks and minutes per month (with the rules active at the time), never the raw rows, so it can sync and outlive the files.</p>
        {snaps.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Snapshot</th><th>Covers</th><th className="num">Streams</th><th className="num">Hours</th><th className="num">Artists</th><th>Top artist</th><th /></tr></thead>
            <tbody>{[...snaps].reverse().map(s => (
              <tr key={s.id}>
                <th>{s.label}<small className="muted block">saved {fmtDate(s.at)}</small></th>
                <td>{s.from ? `${fmtDate(s.from)} to ${fmtDate(s.to)}` : '—'}</td>
                <td className="num">{fmtN(s.streams)}</td>
                <td className="num">{fmtN(s.ms / 3_600_000)}</td>
                <td className="num">{fmtN(s.artists)}</td>
                <td>{s.topArtists[0]?.name ?? '—'}</td>
                <td><button type="button" className="btn danger-ghost sm" onClick={() => remove(s)} aria-label={`Delete ${s.label}`}>Delete</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title="No snapshots yet"><p className="muted small">Import your history and one will be saved automatically.</p></Empty>}
      </div>

      {snaps.length >= 2 && a && b && (
        <div className="panel">
          <div className="panel-head">
            <h2>What changed since the last request</h2>
            <div className="row gap-sm wrap">
              <select aria-label="Older snapshot" value={a.id} onChange={e => setA(e.target.value)}>{snaps.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
              <span className="muted">→</span>
              <select aria-label="Newer snapshot" value={b.id} onChange={e => setB(e.target.value)}>{snaps.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
            </div>
          </div>
          {!diff ? <p className="muted">Pick two different snapshots.</p> : (
            <>
              <div className="kpis">
                <div className="kpi"><small>Streams</small><b>{signed(diff.addedStreams, fmtN)}</b><p>{fmtN(b.streams)} in total</p></div>
                <div className="kpi"><small>Hours</small><b>{signed(diff.addedMs / 3_600_000, v => fmtN(v))}</b><p>{diff.newMonths.length} new month{diff.newMonths.length === 1 ? '' : 's'} of data</p></div>
                <div className="kpi"><small>Artists</small><b>{signed(diff.addedArtists, fmtN)}</b><p>{fmtN(b.artists)} in total</p></div>
                <div className="kpi"><small>Tracks</small><b>{signed(diff.addedTracks, fmtN)}</b><p>{fmtN(b.tracks)} in total</p></div>
              </div>
              {diff.changedMonths.length > 0 && <div className="banner warn small">Months already covered by the older snapshot changed: {diff.changedMonths.join(', ')}. That usually means Spotify re-sent data it had missed, or your rules changed between snapshots.</div>}
              <div className="grid-3">
                <div><h3>New in your top 10</h3>{diff.entered.length ? <ul className="plain">{diff.entered.map(c => <li key={c.name}><b>#{c.after}</b> {c.name}</li>)}</ul> : <p className="muted small">No newcomers.</p>}</div>
                <div><h3>Moved</h3>{diff.moved.length ? <ul className="plain">{diff.moved.slice(0, 8).map(c => <li key={c.name}><span className={c.delta! > 0 ? 'good-text' : 'diff-up'}>{c.delta! > 0 ? '▲' : '▼'} {Math.abs(c.delta!)}</span> {c.name} <small className="muted">#{c.before} → #{c.after}</small></li>)}</ul> : <p className="muted small">Same order.</p>}</div>
                <div><h3>Dropped out</h3>{diff.left.length ? <ul className="plain">{diff.left.map(c => <li key={c.name}>{c.name} <small className="muted">was #{c.before}</small></li>)}</ul> : <p className="muted small">Nobody left the top 10.</p>}</div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
