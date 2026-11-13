// Parses dropped files off the main thread: zips are unpacked with fflate, JSON parsed, rows normalised.
import { unzipSync } from 'fflate'
import { isHistoryName, parseJson, parseMany } from './engine/parse.ts'

export type WorkerIn = { files: File[] }
export type WorkerOut =
  | { type: 'progress'; message: string; pct: number }
  | { type: 'done'; result: ReturnType<typeof parseMany>; ignored: string[] }
  | { type: 'error'; message: string }

const post = (m: WorkerOut) => postMessage(m)
const dec = new TextDecoder()

onmessage = async (e: MessageEvent<WorkerIn>) => {
  try {
    const inputs: { name: string; text: string }[] = []
    const ignored: string[] = []
    const files = e.data.files
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      post({ type: 'progress', message: `Reading ${f.name}`, pct: (i / files.length) * 40 })
      if (/\.zip$/i.test(f.name)) {
        const entries = unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: x => isHistoryName(x.name) })
        for (const [name, bytes] of Object.entries(entries)) inputs.push({ name, text: dec.decode(bytes) })
        if (!Object.keys(entries).length) ignored.push(`${f.name} (no streaming history files inside)`)
      } else if (/\.json$/i.test(f.name)) inputs.push({ name: f.name, text: await f.text() })
      else ignored.push(f.name)
    }
    const parsed: { name: string; rows: unknown }[] = []
    for (let i = 0; i < inputs.length; i++) {
      post({ type: 'progress', message: `Parsing ${inputs[i].name.split('/').pop()}`, pct: 40 + (i / Math.max(1, inputs.length)) * 50 })
      try { parsed.push({ name: inputs[i].name, rows: parseJson(inputs[i].text) }) } catch { ignored.push(`${inputs[i].name} (not valid JSON)`) }
    }
    post({ type: 'progress', message: 'Merging and de-duplicating', pct: 92 })
    const result = parseMany(parsed)
    for (const f of result.files) if (f.kind === 'ignored') ignored.push(`${f.file} (not streaming history)`)
    post({ type: 'done', result, ignored })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
