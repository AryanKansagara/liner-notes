import { useRef, useState } from 'react'
import { buildCtx, snapshot } from './engine/analyze.ts'
import { KIND_LABEL, mergeStreams, type ParseResult } from './engine/parse.ts'
import type { Stream } from './engine/types.ts'
import type { WorkerOut } from './parse.worker.ts'
import { fmtRequest } from './projectData.ts'
import { putData, uuid, type Project } from './store.ts'
import { ask, fmtDate, fmtN, Link, toast } from './ui.tsx'

type Pending = { result: ParseResult; ignored: string[]; names: string[] }

export default function Import({ project, ds, update }: { project: Project; ds: Stream[]; update(p: Partial<Project>): void }) {
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState<{ message: string; pct: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const run = (files: File[]) => {
    if (!files.length) return
    setErr(null); setPending(null)
    setBusy({ message: 'Starting', pct: 0 })
    const w = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data
      if (m.type === 'progress') setBusy({ message: m.message, pct: m.pct })
      else {
        w.terminate(); setBusy(null)
        if (m.type === 'error') setErr(`Could not read the files: ${m.message}`)
        else if (!m.result.streams.length) setErr((m.result.files.some(f => f.kind !== 'ignored') ? 'No playable streams found in these files.' : 'No streaming history files found. Look for Streaming_History_Audio_*.json (extended) or StreamingHistory_music_*.json (account data).') + (m.ignored.length ? ` Ignored: ${m.ignored.slice(0, 6).join(', ')}` : ''))
        else setPending({ result: m.result, ignored: m.ignored, names: files.map(f => f.name) })
      }
    }
    w.onerror = e => { w.terminate(); setBusy(null); setErr(`The parser crashed: ${e.message}. Very large files may need a desktop browser.`) }
    w.postMessage({ files })
  }

  const commit = async (mode: 'merge' | 'replace') => {
    if (!pending) return
    const before = mode === 'merge' ? ds.length : 0
    const merged = mode === 'merge' ? mergeStreams(ds, pending.result.streams) : pending.result.streams
    await putData(project.id, merged)
    const ctx = buildCtx(merged, project.settings)
    const at = Date.now()
    const snap = snapshot(ctx, uuid(), fmtRequest(at), at)
    const meta = { id: uuid(), files: pending.names, rows: pending.result.streams.length, added: merged.length - before, skipped: pending.result.files.reduce((a, f) => a + f.skipped, 0), at }
    update({ imports: [...(mode === 'merge' ? project.imports : []), meta], snapshots: [...project.snapshots, snap], dataMissing: false })
    toast(`${fmtN(meta.added)} new streams added. Snapshot saved.`, { tone: 'ok' })
    setPending(null)
  }

  if (project.sampleId) return (
    <div className="panel">
      <h2>Synthetic listener</h2>
      <p>This history is generated: every artist and track is invented, with realistic sessions, skips and eras. It is rebuilt in your browser each time instead of being stored.</p>
      <Link href="/app" className="btn primary">Create a listener for your own data</Link>
    </div>
  )

  return (
    <>
      <div
        className={`drop${over ? ' over' : ''}`} role="button" tabIndex={0} aria-label="Choose your Spotify export files"
        onClick={() => input.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
        onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); run([...e.dataTransfer.files]) }}
      >
        <div className="drop-disc" aria-hidden="true" />
        <h3>{ds.length ? 'Add a newer data request' : 'Drop your Spotify data'}</h3>
        <p className="muted">The <b>my_spotify_data.zip</b> file, or the <code>Streaming_History_Audio_*.json</code> / <code>StreamingHistory_music_*.json</code> files inside it. Select several at once.</p>
        <p className="muted small">Parsed in a background worker. Raw history stays on this device. <Link href="/docs" onClick={e => e.stopPropagation()}>How to request it</Link></p>
        <input ref={input} type="file" accept=".zip,.json,application/json,application/zip" multiple hidden onChange={e => { run([...(e.target.files ?? [])]); e.target.value = '' }} />
      </div>

      {busy && <div className="panel" role="status"><div className="row gap"><span className="spinner" /><span>{busy.message}</span></div><div className="progress"><i style={{ width: `${busy.pct}%` }} /></div></div>}
      {err && <div className="banner warn" role="alert">{err}</div>}

      {pending && (
        <div className="panel">
          <div className="panel-head"><h2>Validation report</h2><span className="muted small">{fmtN(pending.result.streams.length)} unique streams after de-duplication</span></div>
          <div className="table-wrap"><table className="report-table">
            <thead><tr><th>File</th><th>Detected as</th><th className="num">Rows</th><th className="num">Kept</th><th className="num">Skipped</th><th>Covers</th></tr></thead>
            <tbody>{pending.result.files.map(f => (
              <tr key={f.file}><th className="break">{f.file.split('/').pop()}</th><td><span className="kind">{KIND_LABEL[f.kind]}</span></td><td className="num">{fmtN(f.rows)}</td><td className="num">{fmtN(f.kept)}</td><td className="num">{fmtN(f.skipped)}</td><td>{f.from ? `${fmtDate(f.from)} to ${fmtDate(f.to!)}` : '—'}</td></tr>
            ))}</tbody>
          </table></div>
          {pending.result.files.some(f => f.kind === 'basic-music') && !pending.result.files.some(f => f.kind === 'extended-audio') && <div className="banner small">This is the basic Account data export: one year, no URIs, no skip or shuffle fields. Request <b>Extended streaming history</b> for your full history and rediscovery playlists.</div>}
          {pending.result.issueCount > 0 && (
            <>
              <h3>{fmtN(pending.result.issueCount)} row{pending.result.issueCount > 1 ? 's' : ''} skipped</h3>
              {pending.result.groups.length > 1 || (pending.result.groups[0]?.count ?? 0) > 1 ? <ul className="small">{pending.result.groups.map(g => <li key={g.msg} className={g.level === 'error' ? 'error-row' : ''}><b>{fmtN(g.count)}</b> × {g.msg}</li>)}</ul> : null}
              {pending.result.groups.some(g => g.msg.startsWith('No track')) && <p className="muted small">Rows without metadata still have play time but no title. Spotify leaves these blank in the export, for example for local files and tracks no longer in the catalogue, so they cannot be named or counted.</p>}
              <div className="issues">{pending.result.issues.map((i, k) => <div key={k} className={i.level === 'error' ? 'error-row' : ''}><span className="ln">{i.file.split('/').pop()}:{i.row}</span><span>{i.msg}</span></div>)}</div>
              {pending.result.issueCount > pending.result.issues.length && <p className="muted small">Showing the first {pending.result.issues.length}.</p>}
            </>
          )}
          {pending.ignored.length > 0 && <p className="muted small">Ignored: {pending.ignored.slice(0, 8).join(', ')}{pending.ignored.length > 8 ? ` and ${pending.ignored.length - 8} more` : ''}</p>}
          <div className="row gap wrap" style={{ marginTop: 14 }}>
            <button type="button" className="btn primary" onClick={() => void commit('merge')}>{ds.length ? 'Add to this history' : 'Import'} </button>
            {ds.length > 0 && <button type="button" className="btn outline" onClick={async () => { if (await ask('Replace the history?', 'The current history on this device is replaced by these files. Snapshots are kept.', 'Replace')) void commit('replace') }}>Replace instead</button>}
            <button type="button" className="btn ghost" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}

      {project.imports.length > 0 && (
        <div className="panel">
          <div className="panel-head"><h2>Imports</h2><span className="muted small">{fmtN(ds.length)} streams on this device</span></div>
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>Files</th><th className="num">Rows</th><th className="num">New</th><th className="num">Skipped</th></tr></thead>
            <tbody>{[...project.imports].reverse().map(i => <tr key={i.id}><td>{fmtDate(i.at)}</td><td className="break small">{i.files.join(', ')}</td><td className="num">{fmtN(i.rows)}</td><td className="num">{fmtN(i.added)}</td><td className="num">{fmtN(i.skipped)}</td></tr>)}</tbody>
          </table></div>
          <p className="muted small">What syncs if you sign in: this listener&rsquo;s name, settings, exclusion rules, this import log and snapshot summaries. The streams themselves never leave this browser.</p>
        </div>
      )}
    </>
  )
}
