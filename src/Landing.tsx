import { useEffect, useMemo, useState } from 'react'
import { clock, peakHour, prepare, top, totals } from './engine/analyze.ts'
import { SAMPLES, SAMPLE_NOISE } from './engine/sample.ts'
import type { Rule, Stream } from './engine/types.ts'
import { Heatmap, TopList } from './charts.tsx'
import { sampleStreams } from './projectData.ts'
import { DAYS, fmtHour, fmtN, Link } from './ui.tsx'

const THEO = SAMPLES.find(s => s.id === 'theo')!

function useDemo() {
  const [list, setList] = useState<Stream[] | null>(null)
  useEffect(() => {
    // Let the page paint first, then generate the synthetic listener.
    const t = setTimeout(() => {
      const all = sampleStreams('theo') ?? []
      const cut = Date.UTC(2025, 10, 1)
      setList(all.filter(s => s.ts >= cut))
    }, 30)
    return () => clearTimeout(t)
  }, [])
  return list
}

export function Landing() {
  const list = useDemo()
  const [sleep, setSleep] = useState(false)
  const [kids, setKids] = useState(false)
  const [touched, setTouched] = useState(false)

  // A gentle auto-demo: flip "exclude sleep sounds" once so the page shows the product working.
  useEffect(() => {
    if (!list || touched || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setTimeout(() => setSleep(true), 2600)
    return () => clearTimeout(t)
  }, [list, touched])

  const view = useMemo(() => {
    if (!list) return null
    const rules: Rule[] = [
      { id: 's', kind: 'keyword', value: 'sleep', on: sleep },
      { id: 'k', kind: 'artist', value: SAMPLE_NOISE.kidsArtist, on: kids },
    ]
    const p = prepare(list, { minPlaySec: 30, tz: THEO.tz, sessionGapMin: 20, rules })
    const cl = clock(p.ctx)
    return { cl, peak: peakHour(cl), top: top(p.ctx, 'track', 'ms', 5), artists: top(p.ctx, 'artist', 'ms', 1), t: totals(p.ctx), removed: p.removedMs }
  }, [list, sleep, kids])

  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div>
            <div className="eyebrow">For your Spotify Extended Streaming History</div>
            <h1>Your listening, <span className="serif">without the sleep&nbsp;sounds.</span></h1>
            <p className="lede">Liner Notes is a private, year-round deep dive into the history Spotify sends you. Top tracks for any dates, the songs you always skip, first listens, lost favourites, eras, and a Wrapped you can actually fix.</p>
            <div className="hero-ctas">
              <Link href="/app?sample=theo" className="btn primary lg">Try the sample</Link>
              <Link href="/app" className="btn outline lg">Import your data</Link>
            </div>
            <p className="hero-note">Your raw history is parsed in your browser and never uploaded. <Link href="/docs">How to request it</Link></p>
          </div>

          <div className="demo" aria-live="polite">
            <div className="demo-head">
              <div>
                <small>Synthetic listener · last 12 months</small>
                <b>Theo&rsquo;s year {view && <span className="muted">· {fmtN(view.t.ms / 60_000)} min</span>}</b>
              </div>
              <span className="badge synthetic">Synthetic</span>
            </div>
            <div className="demo-toggles">
              <label className={`chip-toggle${sleep ? ' on' : ''}`}>
                <span className="switch"><input type="checkbox" checked={sleep} onChange={e => { setTouched(true); setSleep(e.target.checked) }} /><span /></span>
                Exclude sleep sounds
              </label>
              <label className={`chip-toggle${kids ? ' on' : ''}`}>
                <span className="switch"><input type="checkbox" checked={kids} onChange={e => { setTouched(true); setKids(e.target.checked) }} /><span /></span>
                Exclude kids&rsquo; songs
              </label>
            </div>
            {!view ? <div className="demo-skel" role="status"><span className="spinner" /> Generating a synthetic history</div> : (
              <div className="demo-body">
                <div>
                  <div className="row between small demo-cap"><b>Listening clock</b><span className="muted">peak {DAYS[view.peak.weekday]} {fmtHour(view.peak.hour)}</span></div>
                  <Heatmap clock={view.cl} />
                </div>
                <div>
                  <div className="row between small demo-cap"><b>Top 5 tracks</b>{view.removed > 0 && <span className="good-text">{fmtN(view.removed / 60_000)} min excluded</span>}</div>
                  <TopList rows={view.top} metric="ms" />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div className="eyebrow">Why this exists</div>
          <h2>Wrapped is fun for a day. Then the questions start.</h2>
          <p>Paraphrased from threads that come back every December.</p>
        </div>
        <div className="quotes">
          <figure className="quote"><blockquote>&ldquo;My top song is a rain track I fall asleep to. Is anybody else&rsquo;s Wrapped this wrong?&rdquo;</blockquote><span className="src">r/spotifywrapped</span></figure>
          <figure className="quote"><blockquote>&ldquo;Kids&rsquo; songs from my nephew and my partner&rsquo;s playlists ruined my stats. Does anyone actually fix their Wrapped?&rdquo;</blockquote><span className="src">r/spotifywrapped · r/truespotify</span></figure>
          <figure className="quote"><blockquote>&ldquo;I have eight years of extended history. How do I find the first time I listened to a song?&rdquo;</blockquote><span className="src">r/truespotify</span></figure>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div className="eyebrow">What you get</div>
          <h2>Everything in the export, finally readable.</h2>
        </div>
        <div className="features">
          {[
            ['Fix my Wrapped', 'Exclude an artist, a track, a keyword like sleep or kids, a date range, private sessions or podcasts. Every chart recomputes instantly, and the rules sync with you.'],
            ['Any 12 months', 'A year in review that starts wherever you want: your school year, your time abroad, the year since you moved. Top tracks, artists, albums, minutes and plays.'],
            ['First listens and lost favourites', 'Search any song to see the day you first played it and its peak month. See the tracks you played to death and then forgot.'],
            ['Eras', 'Your history split into runs of months dominated by different artists, with a timeline you can share.'],
            ['Skips, streaks, sessions', 'The songs you always skip, your longest daily streak, your longest single-artist streak, and when you actually listen.'],
            ['Actions', '9:16 and square story cards as PNG, rediscovery lists you paste straight into a Spotify playlist, CSV exports and a printable liner-notes booklet.'],
          ].map(([t, d], i) => (
            <article className="feature" key={t}><div className="ico" aria-hidden="true">{String(i + 1).padStart(2, '0')}</div><h3>{t}</h3><p>{d}</p></article>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="steps">
          <div><b>1</b><h3>Request your data</h3><p>Spotify Privacy settings, tick <em>Extended streaming history</em>. It arrives by email, usually within days and at most 30. <Link href="/docs">Step by step</Link></p></div>
          <div><b>2</b><h3>Drop the zip</h3><p>Parsed in a background worker, even at hundreds of thousands of rows. Duplicates between files are removed.</p></div>
          <div><b>3</b><h3>Fix, explore, share</h3><p>Every new request becomes a snapshot, so next time you can see what changed since the last one.</p></div>
        </div>
      </section>

      <section className="cta-band">
        <div className="cta-inner">
          <div><h2>Private by design</h2><p>Raw history stays on this device. Accounts are optional and only sync settings, rules and summaries.</p></div>
          <Link href="/app" className="btn primary lg">Open Liner Notes</Link>
        </div>
      </section>
    </>
  )
}
