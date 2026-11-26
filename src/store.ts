import { useSyncExternalStore } from 'react'
import type { Snapshot } from './engine/analyze.ts'
import type { Rule, Settings, Stream } from './engine/types.ts'

export type Dataset = Stream[]

export interface ImportMeta {
  id: string
  files: string[]
  rows: number
  added: number
  skipped: number
  at: number
}

export interface Project {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  settings: Settings
  /** One per import (or per data request), derived aggregates only */
  snapshots: Snapshot[]
  imports: ImportMeta[]
  /** Built-in synthetic listener; its history is regenerated instead of stored. */
  sampleId?: string
  /** True when this device has no copy of the raw history (synced from another device). */
  dataMissing?: boolean
}

// ---------- Tiny IndexedDB wrapper (falls back to memory in private modes) ----------

const DB = 'liner-notes'
let dbp: Promise<IDBDatabase | null> | null = null
function db(): Promise<IDBDatabase | null> {
  return dbp ??= new Promise(res => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('projects', { keyPath: 'id' })
        req.result.createObjectStore('data')
      }
      req.onsuccess = () => res(req.result)
      req.onerror = () => res(null)
    } catch { res(null) }
  })
}
const mem = { projects: new Map<string, unknown>(), data: new Map<string, unknown>() }

async function tx<T>(store: 'projects' | 'data', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  if (!d) throw new Error('no-idb')
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode)
    const r = fn(t.objectStore(store))
    // A full disk can abort the transaction after the request itself succeeded, so a write only counts once it is complete.
    t.oncomplete = () => res(r.result)
    t.onerror = t.onabort = () => rej(t.error ?? r.error ?? new Error('The browser did not finish the request'))
  })
}

async function idbGetAll<T>(store: 'projects'): Promise<T[]> {
  try { return await tx(store, 'readonly', s => s.getAll()) as T[] } catch { return [...mem[store].values()] as T[] }
}
async function idbGet<T>(store: 'projects' | 'data', key: string): Promise<T | undefined> {
  try { return await tx(store, 'readonly', s => s.get(key)) as T | undefined } catch { return mem[store].get(key) as T | undefined }
}
/** Throws when the browser refuses the write. Memory is only used when there is no database, because reads only look there then. */
async function idbPut(store: 'projects' | 'data', value: unknown, key?: string) {
  if (!await db()) { mem[store].set(key ?? (value as { id: string }).id, value); return }
  await tx(store, 'readwrite', s => key === undefined ? s.put(value) : s.put(value, key))
}
async function idbDel(store: 'projects' | 'data', key: string) {
  try { await tx(store, 'readwrite', s => s.delete(key)) } catch { mem[store].delete(key) }
}

// ---------- In-memory project list with subscribers ----------

let projects: Project[] = []
let loaded = false
const subs = new Set<() => void>()
const emit = () => { projects = [...projects]; subs.forEach(f => f()) }
const changeHooks = new Set<(p: Project) => void>()
const saveErrorHooks = new Set<(p: Project) => void>()

export const onProjectChange = (f: (p: Project) => void) => { changeHooks.add(f); return () => changeHooks.delete(f) }

/** Called when the browser refuses to store a project. The change then only lives until the page is closed. */
export const onSaveError = (f: (p: Project) => void) => { saveErrorHooks.add(f); return () => saveErrorHooks.delete(f) }

export async function loadProjects() {
  projects = (await idbGetAll<Project>('projects')).sort((a, b) => b.updatedAt - a.updatedAt)
  loaded = true
  emit()
}

export function useProjects() {
  return useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => loaded ? projects : null)
}

export const getProjects = () => projects
export const getProject = (id: string) => projects.find(p => p.id === id)

export const saveProject = async (p: Project, opts: { touch?: boolean; silent?: boolean } = {}) => (await trySaveProject(p, opts)).project

/** Like saveProject, and says whether the browser stored it. */
export async function trySaveProject(p: Project, opts: { touch?: boolean; silent?: boolean } = {}) {
  const next = opts.touch === false ? p : { ...p, updatedAt: Date.now() }
  // The list changes before the write, so an edit made meanwhile starts from this one.
  const i = projects.findIndex(x => x.id === p.id)
  if (i >= 0) projects[i] = next
  else projects.unshift(next)
  projects.sort((a, b) => b.updatedAt - a.updatedAt)
  emit()
  let saved = true
  try { await idbPut('projects', next) } catch { saved = false }
  if (!opts.silent) changeHooks.forEach(f => f(next))
  if (!saved) saveErrorHooks.forEach(f => f(next))
  return { project: next, saved }
}

/** Changes part of the project as it is now, not as it was when the caller last saw it. A deleted project stays deleted. */
export async function editProject(id: string, change: (p: Project) => Partial<Project>): Promise<boolean> {
  const p = getProject(id)
  return !!p && (await trySaveProject({ ...p, ...change(p) })).saved
}

/** Like editProject, for the rules. */
export const editRules = (id: string, change: (rules: Rule[]) => Rule[]) => editProject(id, p => ({ settings: { ...p.settings, rules: change(p.settings.rules) } }))

/** Deletes locally; returns an undo function that restores the project and its data. */
export async function deleteProject(id: string): Promise<() => Promise<void>> {
  const p = getProject(id)
  const data = await idbGet<Dataset>('data', id)
  projects = projects.filter(x => x.id !== id)
  emit()
  await idbDel('projects', id)
  await idbDel('data', id)
  addTombstone(id)
  return async () => {
    if (!p) return
    removeTombstone(id)
    let restored = true
    if (data) try { await idbPut('data', data, id) } catch { restored = false }
    await saveProject(p)
    if (!restored) saveErrorHooks.forEach(f => f(p))
  }
}

export const getData = (id: string) => idbGet<Dataset>('data', id)
export const putData = (id: string, ds: Dataset) => idbPut('data', ds, id)

export const uuid = () => crypto.randomUUID()

// Tombstones keep a project deleted offline from coming back on the next sync.
const TOMB = 'liner-notes.tombstones'
export const tombstones = (): string[] => { try { return JSON.parse(localStorage.getItem(TOMB) ?? '[]') } catch { return [] } }
const addTombstone = (id: string) => localStorage.setItem(TOMB, JSON.stringify([...new Set([...tombstones(), id])]))
const removeTombstone = (id: string) => localStorage.setItem(TOMB, JSON.stringify(tombstones().filter(x => x !== id)))
export const clearTombstones = (ids: string[]) => localStorage.setItem(TOMB, JSON.stringify(tombstones().filter(x => !ids.includes(x))))

// ---------- App defaults (settings page) ----------

export interface Defaults { tz: string; minPlaySec: number; sessionGapMin: number }
const DEF_KEY = 'liner-notes.defaults'
export const localTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }
export function getDefaults(): Defaults {
  const base: Defaults = { tz: localTz(), minPlaySec: 30, sessionGapMin: 20 }
  try { return { ...base, ...JSON.parse(localStorage.getItem(DEF_KEY) ?? '{}') } } catch { return base }
}
export const setDefaults = (d: Defaults) => localStorage.setItem(DEF_KEY, JSON.stringify(d))
export const blankSettings = (): Settings => ({ ...getDefaults(), rules: [] })
