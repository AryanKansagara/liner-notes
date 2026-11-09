// Shareable story cards drawn on a canvas, exported as PNG.
import type { Review } from './engine/analyze.ts'

export type CardFormat = 'story' | 'square'
export type CardKind = 'tracks' | 'artists' | 'summary'
export type CardTheme = 'green' | 'night' | 'sunset'

const THEMES: Record<CardTheme, { bg: [string, string]; ink: string; sub: string; accent: string; rank: string }> = {
  green: { bg: ['#1ed760', '#0b5c28'], ink: '#000000', sub: '#08240f', accent: '#000000', rank: '#0d3d1c' },
  night: { bg: ['#1f1f1f', '#050505'], ink: '#ffffff', sub: '#b3b3b3', accent: '#1ed760', rank: '#1ed760' },
  sunset: { bg: ['#ff6437', '#c2185b'], ink: '#ffffff', sub: '#ffe3d9', accent: '#fff4b0', rank: '#ffe08a' },
}

const fmtYm = (ym: string) => new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const n = (v: number) => Math.round(v).toLocaleString('en-US')

function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1)
  return t.trimEnd() + '…'
}

export async function drawCard(canvas: HTMLCanvasElement, r: Review, o: { format: CardFormat; kind: CardKind; theme: CardTheme; name: string; synthetic?: boolean }) {
  const W = 1080, H = o.format === 'story' ? 1920 : 1080
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  try { await Promise.all(['800 96px Figtree', '600 40px Figtree', '400 32px Figtree'].map(f => document.fonts.load(f))) } catch { /* system font fallback */ }
  const th = THEMES[o.theme]
  const F = (w: number, px: number) => `${w} ${px}px Figtree, "Helvetica Neue", Arial, sans-serif`

  const g = ctx.createLinearGradient(0, 0, W * 0.4, H)
  g.addColorStop(0, th.bg[0]); g.addColorStop(1, th.bg[1])
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // Soft record grooves in the corner.
  ctx.save()
  ctx.globalAlpha = 0.09
  ctx.strokeStyle = th.ink
  for (let i = 0; i < 14; i++) { ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(W + 40, -40, 160 + i * 38, 0, Math.PI * 2); ctx.stroke() }
  ctx.restore()

  const pad = 88
  const story = o.format === 'story'
  let y = story ? 190 : 120
  ctx.fillStyle = th.sub
  ctx.font = F(700, 30)
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(`LINER NOTES · ${fmtYm(r.from).toUpperCase()} – ${fmtYm(r.to).toUpperCase()}`, pad, y)
  y += story ? 120 : 92

  const title = o.kind === 'tracks' ? 'Top tracks' : o.kind === 'artists' ? 'Top artists' : 'My year'
  ctx.fillStyle = th.ink
  ctx.font = F(800, story ? 128 : 104)
  ctx.fillText(title, pad - 4, y)
  y += story ? 40 : 26
  ctx.font = F(500, 36)
  ctx.fillStyle = th.sub
  ctx.fillText(fit(ctx, o.name, W - pad * 2), pad, y + 40)
  y += story ? 150 : 110

  if (o.kind === 'summary') {
    const facts: [string, string][] = [
      [n(r.totals.ms / 60_000), 'minutes listened'],
      [r.topArtists[0]?.name ?? '—', 'top artist'],
      [r.topTracks[0]?.name ?? '—', 'top track'],
      [n(r.newArtists), 'new artists discovered'],
      [`${r.streak.longest.days} days`, 'longest streak'],
    ]
    const rows = story ? facts : facts.slice(0, 4)
    const step = story ? 230 : 150
    for (const [big, small] of rows) {
      ctx.fillStyle = th.accent
      ctx.font = F(800, story ? 92 : 70)
      ctx.fillText(fit(ctx, big, W - pad * 2), pad, y + (story ? 70 : 50))
      ctx.fillStyle = th.sub
      ctx.font = F(500, story ? 36 : 30)
      ctx.fillText(small, pad, y + (story ? 124 : 92))
      y += step
    }
  } else {
    const list = (o.kind === 'tracks' ? r.topTracks : r.topArtists).slice(0, 5)
    const step = story ? 200 : 132
    list.forEach((it, i) => {
      ctx.fillStyle = th.rank
      ctx.font = F(800, story ? 96 : 72)
      ctx.fillText(String(i + 1), pad, y + (story ? 80 : 60))
      const x = pad + (story ? 110 : 86)
      ctx.fillStyle = th.ink
      ctx.font = F(800, story ? 58 : 46)
      ctx.fillText(fit(ctx, it.name, W - x - pad), x, y + (story ? 48 : 34))
      ctx.fillStyle = th.sub
      ctx.font = F(500, story ? 36 : 30)
      ctx.fillText(fit(ctx, (it.sub ? it.sub + ' · ' : '') + `${n(it.ms / 60_000)} min`, W - x - pad), x, y + (story ? 100 : 76))
      y += step
    })
    if (!list.length) { ctx.fillStyle = th.sub; ctx.font = F(500, 40); ctx.fillText('No listening in this window', pad, y + 40) }
  }

  // Footer
  ctx.fillStyle = th.ink
  ctx.font = F(800, story ? 64 : 52)
  ctx.fillText(`${n(r.totals.ms / 60_000)} min`, pad, H - (story ? 150 : 96))
  ctx.fillStyle = th.sub
  ctx.font = F(500, 30)
  ctx.fillText(o.synthetic ? 'Synthetic sample data · made with Liner Notes' : 'Made with Liner Notes', pad, H - (story ? 96 : 52))
}

export const canvasBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Could not render the image')), 'image/png'))
