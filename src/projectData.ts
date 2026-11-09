import { useEffect, useMemo, useState } from 'react'
import { addMonths, buildCtx, monthRange, prepare, snapshot, sliceCtx } from './engine/analyze.ts'
import { SAMPLES, generate, sampleRules } from './engine/sample.ts'
import type { Rule, Settings, Stream } from './engine/types.ts'
import { toast } from './ui.tsx'
import { blankSettings, getData, getProjects, saveProject, useProjects, uuid, type Dataset, type Project } from './store.ts'

const sampleCache = new Map<string, Stream[]>()
export function sampleStreams(id: string): Stream[] | null {
  const def = SAMPLES.find(s => s.id === id)
  if (!def) return null
  if (!sampleCache.has(id)) sampleCache.set(id, generate(def))
  return sampleCache.get(id)!
}

export const fmtRequest = (t: number) => `Request of ${new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`

export async function createSampleProject(sampleId: string): Promise<Project> {
  const existing = getProjects().find(p => p.sampleId === sampleId)
  if (existing) return existing
  const def = SAMPLES.find(s => s.id === sampleId)!
  const list = sampleStreams(sampleId)!
  const settings: Settings = { ...blankSettings(), tz: def.tz, rules: sampleRules(def, uuid) }
  // Two data requests, six months apart, so History has something to compare.
  const ctx = buildCtx(list, settings)
  const half = sliceCtx(ctx, undefined, '2026-04')
  const now = Date.now()
  const snapshots = [snapshot(half, uuid(), 'Request of May 2026', Date.UTC(2026, 4, 3)), snapshot(ctx, uuid(), 'Request of Nov 2026', Date.UTC(2026, 10, 2))]
  return saveProject({
    id: uuid(), name: def.name, createdAt: now, updatedAt: now, settings, snapshots, sampleId,
    imports: [{ id: uuid(), files: ['synthetic Streaming_History_Audio_*.json'], rows: list.length, added: list.length, skipped: 0, at: now }],
  })
}

export async function createBlankProject(name: string): Promise<Project> {
  const now = Date.now()
  return saveProject({ id: uuid(), name, createdAt: now, updatedAt: now, settings: blankSettings(), snapshots: [], imports: [] })
}

export function useProject(id: string) {
  const list = useProjects()
  const project = list?.find(p => p.id === id) ?? null
  const [ds, setDs] = useState<Dataset | null>(null)
  const importsKey = project ? project.imports.map(i => i.id).join(',') : ''
  useEffect(() => {
    if (!project) return
    let live = true
    if (project.sampleId) { setDs(sampleStreams(project.sampleId) ?? []); return }
    void getData(project.id).then(d => { if (live) setDs(d ?? []) })
    return () => { live = false }
  }, [project?.id, project?.sampleId, importsKey])
  const update = (patch: Partial<Project>) => project && saveProject({ ...project, ...patch })
  const setSettings = (patch: Partial<Settings>) => project && saveProject({ ...project, settings: { ...project.settings, ...patch } })
  return { loading: list === null || (project !== null && ds === null), project, ds, update, setSettings }
}

/** Rules applied, local times computed. Recomputed whenever data, rules, timezone or thresholds change. */
export function usePrepared(ds: Stream[] | null, settings: Settings | undefined) {
  return useMemo(() => {
    if (!ds || !settings) return null
    const p = prepare(ds, settings)
    return { ...p, range: monthRange(p.ctx) }
  }, [ds, settings])
}
export type Prepared = NonNullable<ReturnType<typeof usePrepared>>

/** The most recent 12 months, ending at the last month of data. */
export const lastYearStart = (range: { from: string; to: string } | null) => {
  if (!range) return ''
  const start = addMonths(range.to, -11)
  return start < range.from ? range.from : start
}

/** Adds or toggles a rule with an undo toast. Matching rules are switched on instead of duplicated. */
export function addRule(project: Project, rule: Omit<Rule, 'id' | 'on'>) {
  const prev = project.settings.rules
  const same = prev.find(r => r.kind === rule.kind && r.value.toLowerCase() === rule.value.toLowerCase())
  const rules = same ? prev.map(r => r === same ? { ...r, on: true } : r) : [...prev, { ...rule, id: uuid(), on: true }]
  void saveProject({ ...project, settings: { ...project.settings, rules } })
  toast(`Excluding ${rule.label || rule.value || rule.kind}. Everything recomputed.`, { tone: 'ok', undo: () => void saveProject({ ...project, settings: { ...project.settings, rules: prev } }) })
}
