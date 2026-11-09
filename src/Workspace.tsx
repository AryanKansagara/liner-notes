import { useEffect, useState } from 'react'
import { SAMPLES } from './engine/sample.ts'
import { createBlankProject, createSampleProject } from './projectData.ts'
import { deleteProject, saveProject, useProjects, type Project } from './store.ts'
import { useSync } from './sync.ts'
import { ask, fmtDate, fmtN, go, Link, SyntheticBadge, toast } from './ui.tsx'

export default function Workspace() {
  const list = useProjects()
  const sync = useSync()
  const [busy, setBusy] = useState<string | null>(null)

  // /app?sample=acme opens (or creates) the sample straight away.
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const s = q.get('sample')
    const tab = q.get('tab')?.replace(/[^a-z]/g, '')
    if (!s || list === null || busy) return
    if (!SAMPLES.some(x => x.id === s)) return
    setBusy(s)
    void createSampleProject(s).then(p => go(`/app/p/${p.id}${tab ? '/' + tab : ''}`, { replace: true }))
  }, [list, busy])

  const openSample = async (id: string) => { setBusy(id); const p = await createSampleProject(id); go(`/app/p/${p.id}`) }
  const newProject = async () => {
    const name = (list?.some(p => !p.sampleId) ? `My history ${(list?.filter(p => !p.sampleId).length ?? 0) + 1}` : 'My history')
    const p = await createBlankProject(name)
    go(`/app/p/${p.id}/data`)
  }

  if (list === null || busy) return <div className="boot" role="status"><span className="spinner" /> {busy ? 'Generating a synthetic listening history' : 'Opening your listeners'}</div>

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Listeners</h1>
          <p className="muted">One per Spotify account (yours, a partner&rsquo;s, the family plan). Each keeps its history, exclusion rules and a snapshot per data request. {sync.user ? 'Settings and summaries sync to your account; raw history stays here.' : 'Stored on this device.'}</p>
        </div>
        {list.length > 0 && <div className="row gap"><button type="button" className="btn primary" onClick={newProject}>New listener</button></div>}
      </div>

      {list.length === 0 ? (
        <div className="onboard">
          <article className="onboard-card feature-card">
            <div className="eyebrow">Two minutes</div>
            <h2>Try the sample</h2>
            <p>Synthetic listeners with realistic histories: one whose Wrapped is all rain loops and kids&rsquo; songs, one with five years and four eras. Every artist and track is invented.</p>
            <div className="stack-sm">
              {SAMPLES.map(s => (
                <button key={s.id} type="button" className="sample-btn" onClick={() => void openSample(s.id)}>
                  <span><strong>{s.name}</strong><small>{s.blurb}</small></span><span aria-hidden="true">&rarr;</span>
                </button>
              ))}
            </div>
          </article>
          <article className="onboard-card">
            <div className="eyebrow">Your history</div>
            <h2>Import your data</h2>
            <p>Drop the zip Spotify emails you (Extended streaming history or the basic Account data). Files are detected, merged, de-duplicated and validated, with every unreadable row reported.</p>
            <div className="row gap wrap">
              <button type="button" className="btn primary" onClick={newProject}>Import your data</button>
              <Link href="/docs" className="btn ghost">How to request it</Link>
            </div>
            <p className="muted small">Parsed in a background worker in your browser. Your raw history never leaves this device.</p>
          </article>
        </div>
      ) : (
        <>
          <div className="project-grid">
            {list.map(p => <ProjectCard key={p.id} p={p} />)}
          </div>
          <div className="samples-row">
            <span className="muted small">Samples:</span>
            {SAMPLES.map(s => <button key={s.id} type="button" className="linkish small" onClick={() => void openSample(s.id)}>{s.name}</button>)}
          </div>
        </>
      )}
    </section>
  )
}

function ProjectCard({ p }: { p: Project }) {
  const [renaming, setRenaming] = useState(false)
  const last = [...p.snapshots].sort((a, b) => a.at - b.at).at(-1)
  return (
    <article className="project-card">
      <div className="row between">
        {renaming ? (
          <form onSubmit={e => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('n')).trim(); if (v) void saveProject({ ...p, name: v }); setRenaming(false) }}>
            <input name="n" defaultValue={p.name} autoFocus aria-label="Project name" onBlur={e => e.currentTarget.form?.requestSubmit()} />
          </form>
        ) : <h3><Link href={`/app/p/${p.id}`}>{p.name}</Link></h3>}
        {p.sampleId && <SyntheticBadge />}
      </div>
      <dl className="mini-stats">
        <div><dt>Hours</dt><dd>{last ? fmtN(last.ms / 3_600_000) : '—'}</dd></div>
        <div><dt>Artists</dt><dd>{last ? fmtN(last.artists) : '—'}</dd></div>
        <div><dt>From</dt><dd>{last?.from ? new Date(last.from).getUTCFullYear() : '—'}</dd></div>
        <div><dt>Rules</dt><dd>{p.settings.rules.filter(r => r.on).length}</dd></div>
      </dl>
      {last?.topArtists[0] && <p className="muted small" style={{ margin: 0 }}>Top artist <b>{last.topArtists[0].name}</b> · last data {fmtDate(last.to)}</p>}
      {p.dataMissing && <p className="warn-text small">The raw history lives on another device. Import the same files here to explore it.</p>}
      <div className="row between">
        <span className="muted small">Updated {new Date(p.updatedAt).toLocaleDateString()}</span>
        <div className="row gap-sm">
          <button type="button" className="btn ghost sm" onClick={() => setRenaming(true)}>Rename</button>
          <button type="button" className="btn danger-ghost sm" onClick={async () => {
            if (!(await ask(`Delete “${p.name}”?`, 'Removes the listener, its history and its snapshots from this device (and the cloud, if you are signed in). You can undo for a few seconds.', 'Delete listener'))) return
            const undo = await deleteProject(p.id)
            toast(`Deleted ${p.name}`, { undo: () => void undo() })
          }}>Delete</button>
        </div>
      </div>
    </article>
  )
}

