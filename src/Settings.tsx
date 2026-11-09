import { useState } from 'react'
import { validTz } from './engine/analyze.ts'
import { deleteProject, getDefaults, getProjects, localTz, setDefaults, type Defaults } from './store.ts'
import { exportAll, useSync } from './sync.ts'
import { ask, download, setTheme, toast, useDark } from './ui.tsx'

export default function Settings() {
  const [d, setD] = useState<Defaults>(getDefaults)
  const [tz, setTz] = useState(d.tz)
  const dark = useDark()
  const sync = useSync()
  const save = (p: Partial<Defaults>) => { const next = { ...d, ...p }; setD(next); setDefaults(next); toast('Saved', { tone: 'ok', ttl: 1500 }) }

  return (
    <section className="page narrow settings">
      <div className="eyebrow">Settings</div>
      <h1>Settings</h1>

      <div className="panel">
        <h2>Defaults for new listeners</h2>
        <p className="muted small">Each listener keeps its own copy; change those on the listener&rsquo;s Fix my Wrapped tab.</p>
        <div className="inline-fields">
          <label className="field"><span>Timezone</span>
            <input value={tz} list="tz-list" onChange={e => { setTz(e.target.value); if (validTz(e.target.value)) save({ tz: e.target.value }) }} aria-invalid={!validTz(tz)} />
          </label>
          <label className="field"><span>A play counts from (seconds)</span><input type="number" min="0" max="600" value={d.minPlaySec} onChange={e => save({ minPlaySec: Math.max(0, Math.min(600, Number(e.target.value))) })} /></label>
          <label className="field"><span>New session after a gap of (min)</span><input type="number" min="1" max="720" value={d.sessionGapMin} onChange={e => save({ sessionGapMin: Math.max(1, Number(e.target.value)) })} /></label>
        </div>
        <datalist id="tz-list">{(Intl.supportedValuesOf?.('timeZone') ?? []).map(z => <option key={z} value={z} />)}</datalist>
        {!validTz(tz) && <p className="error small">Unknown timezone. Use an IANA name like Europe/Lisbon. Your browser says {localTz()}.</p>}
      </div>

      <div className="panel">
        <h2>Appearance</h2>
        <div className="seg-control" role="radiogroup" aria-label="Theme">
          <button type="button" role="radio" aria-checked={dark} className={dark ? 'on' : ''} onClick={() => setTheme('dark')}>Dark</button>
          <button type="button" role="radio" aria-checked={!dark} className={!dark ? 'on' : ''} onClick={() => setTheme('light')}>Light</button>
        </div>
      </div>

      <div className="panel">
        <h2>Your data</h2>
        <p>Streaming history lives in this browser (IndexedDB) and is never uploaded. {sync.user ? <>Signed in as <b>{sync.user.email}</b>: listener names, settings, exclusion rules, import notes and snapshot summaries (totals, top 25 artists and tracks, minutes per month) sync to your account.</> : 'Sign in from the account menu (top right) to sync settings, rules and summaries across devices. It is optional.'}</p>
        <div className="row gap wrap">
          <button type="button" className="btn outline" onClick={async () => download(`liner-notes-export-${new Date().toISOString().slice(0, 10)}.json`, await exportAll())}>Export all my data (JSON)</button>
          <button type="button" className="btn danger-ghost" onClick={async () => {
            const list = getProjects()
            if (!list.length) { toast('Nothing to delete'); return }
            if (!(await ask('Delete all listeners?', `Removes ${list.length} listener${list.length > 1 ? 's' : ''} from this browser${sync.user ? ' and from your cloud account' : ''}. You can undo for a few seconds.`, 'Delete everything'))) return
            const undos = await Promise.all(list.map(p => deleteProject(p.id)))
            toast(`Deleted ${list.length} listeners`, { undo: () => { for (const u of undos) void u() } })
          }}>Delete all listeners</button>
        </div>
      </div>

      <div className="panel">
        <h2>Keyboard shortcuts</h2>
        <dl className="shortcuts">
          <div><dt><kbd>1</kbd>&ndash;<kbd>8</kbd></dt><dd>Switch listener sections</dd></div>
          <div><dt><kbd>F</kbd></dt><dd>Fix my Wrapped</dd></div>
          <div><dt><kbd>B</kbd></dt><dd>Printable liner-notes booklet</dd></div>
          <div><dt><kbd>/</kbd></dt><dd>Search first listens</dd></div>
          <div><dt><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>Undo the last delete or rule change</dd></div>
          <div><dt><kbd>?</kbd></dt><dd>Show shortcuts on a listener page</dd></div>
        </dl>
      </div>
    </section>
  )
}
