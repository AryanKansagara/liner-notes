import { lazy, Suspense, useEffect, useState } from 'react'
import type { Settings, Stream } from './engine/types.ts'
import { usePrepared, useProject, type Prepared } from './projectData.ts'
import type { Project } from './store.ts'
import { Empty, fmtDate, fmtN, go, isTyping, Link, Modal, SyntheticBadge } from './ui.tsx'

const Tabs = lazy(() => import('./Tabs.tsx'))
const Fix = lazy(() => import('./Fix.tsx'))
const Review = lazy(() => import('./Review.tsx'))
const History = lazy(() => import('./History.tsx'))
const DataTab = lazy(() => import('./Import.tsx'))

export const TABS = [['overview', 'Overview'], ['top', 'Top lists'], ['habits', 'Habits'], ['rediscover', 'Rediscover'], ['fix', 'Fix my Wrapped'], ['review', 'Year in review'], ['history', 'History'], ['data', 'Data']] as const
export type Tab = (typeof TABS)[number][0]

export interface TabProps {
  project: Project
  ds: Stream[]
  prep: Prepared
  setSettings(p: Partial<Settings>): void
  update(p: Partial<Project>): void
}

export default function ProjectView({ id, tab: rawTab }: { id: string; tab: string }) {
  const { loading, project, ds, setSettings, update } = useProject(id)
  const tab = (TABS.some(t => t[0] === rawTab) ? rawTab : 'overview') as Tab
  const prep = usePrepared(ds, project?.settings)
  const [help, setHelp] = useState(false)

  useEffect(() => { if (project) document.title = `${project.name} · Liner Notes` }, [project?.name])
  const setTab = (t: Tab) => go(`/app/p/${id}${t === 'overview' ? '' : '/' + t}`, { keepScroll: true })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= TABS.length) { e.preventDefault(); setTab(TABS[n - 1][0]) }
      else if (e.key === '?') setHelp(true)
      else if (e.key === 'f') setTab('fix')
      else if (e.key === 'b') go(`/app/p/${id}/booklet`)
      else if (e.key === '/') { e.preventDefault(); if (tab !== 'rediscover') setTab('rediscover'); setTimeout(() => document.getElementById('first-q')?.focus(), 60) }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  if (loading) return <div className="boot" role="status"><span className="spinner" /> Loading listening history</div>
  if (!project) return (
    <section className="page narrow center">
      <Empty title="Listener not found"><p className="muted">It may have been deleted, or it lives on another device.</p><Link href="/app" className="btn primary">All listeners</Link></Empty>
    </section>
  )
  const empty = !ds?.length
  const activeRules = project.settings.rules.filter(r => r.on).length

  return (
    <section className="page">
      <div className="proj-head">
        <div>
          <div className="eyebrow"><Link href="/app">Listeners</Link></div>
          <h1 className="row gap wrap">{project.name} {project.sampleId && <SyntheticBadge />}</h1>
          {prep && !empty && <p className="muted small" style={{ margin: 0 }}>{fmtN(ds!.length)} streams · {fmtDate(ds![0].ts)} to {fmtDate(ds!.at(-1)!.ts)} · times in {project.settings.tz}</p>}
        </div>
        {!empty && (
          <div className="toolbar">
            <Link href={`/app/p/${id}/fix`} className={`rules-pill${activeRules ? ' on' : ''}`} title="Exclusion rules (F)">
              {activeRules ? `${activeRules} exclusion${activeRules > 1 ? 's' : ''} on · ${fmtN((prep?.removedMs ?? 0) / 3_600_000)} h hidden` : 'No exclusions'}
            </Link>
            <Link href={`/app/p/${id}/review`} className="btn outline">Story card</Link>
            <Link href={`/app/p/${id}/booklet`} className="btn primary" title="Printable booklet (B)">Booklet</Link>
          </div>
        )}
      </div>
      <nav className="tabs" aria-label="Listener sections">
        {TABS.map(([t, l], i) => <Link key={t} href={`/app/p/${id}${t === 'overview' ? '' : '/' + t}`} aria-current={t === tab ? 'page' : undefined} title={`${l} (${i + 1})`}>{l}</Link>)}
      </nav>
      {project.dataMissing && empty && <div className="banner warn">This listener was synced from another device. Its raw history stays where it was imported; drop the same files here to explore it. Snapshots are available under History.</div>}
      <Suspense fallback={<div className="boot"><span className="spinner" /></div>}>
        {tab === 'data' || (empty && tab !== 'history')
          ? <DataTab project={project} ds={ds ?? []} update={update} />
          : tab === 'history' ? <History project={project} update={update} prep={prep} />
            : prep && ds && (
              tab === 'fix' ? <Fix project={project} ds={ds} prep={prep} setSettings={setSettings} update={update} />
                : tab === 'review' ? <Review project={project} ds={ds} prep={prep} setSettings={setSettings} update={update} />
                  : <Tabs tab={tab} project={project} ds={ds} prep={prep} setSettings={setSettings} update={update} />
            )}
      </Suspense>
      <Modal open={help} onClose={() => setHelp(false)} title="Keyboard shortcuts">
        <dl className="shortcuts">
          <div><dt><kbd>1</kbd>&ndash;<kbd>8</kbd></dt><dd>Switch sections</dd></div>
          <div><dt><kbd>F</kbd></dt><dd>Fix my Wrapped</dd></div>
          <div><dt><kbd>B</kbd></dt><dd>Printable booklet</dd></div>
          <div><dt><kbd>/</kbd></dt><dd>Search first listens</dd></div>
          <div><dt><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>Undo the last delete or rule change</dd></div>
        </dl>
      </Modal>
    </section>
  )
}
