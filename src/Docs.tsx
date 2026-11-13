import { Code, Link } from './ui.tsx'

const EXT_SAMPLE = `[
  {
    "ts": "2025-03-14T07:42:31Z",
    "platform": "ios",
    "ms_played": 213456,
    "conn_country": "PT",
    "ip_addr": "…",
    "master_metadata_track_name": "Northbound",
    "master_metadata_album_artist_name": "Marlow & the Pines",
    "master_metadata_album_album_name": "Paper Harbour",
    "spotify_track_uri": "spotify:track:2xQm7NbKp4TzLc9WvR1dYe",
    "episode_name": null,
    "episode_show_name": null,
    "spotify_episode_uri": null,
    "reason_start": "trackdone",
    "reason_end": "trackdone",
    "shuffle": true,
    "skipped": false,
    "offline": false,
    "offline_timestamp": 1741938138,
    "incognito_mode": false
  }
]`

const BASIC_SAMPLE = `[
  { "endTime": "2025-03-14 07:42", "artistName": "Marlow & the Pines", "trackName": "Northbound", "msPlayed": 213456 }
]`

const FIELDS: [string, string][] = [
  ['ts', 'When the stream ended, in UTC. Liner Notes subtracts ms_played to get the start, then converts to your timezone.'],
  ['ms_played', 'How long it actually played. 30 000 ms or more counts as a play (configurable).'],
  ['platform', 'Device or OS, e.g. ios, android, windows, a smart speaker.'],
  ['conn_country', 'Country of the connection, as a two-letter code.'],
  ['ip_addr', 'The IP address. Dropped while parsing and never stored.'],
  ['master_metadata_track_name / _album_artist_name / _album_album_name', 'Track, artist and album. Null for podcasts and audiobooks. Some exports also have thousands of music rows where every name and URI is null (local files, removed tracks); these are listed once in the validation report with a count.'],
  ['spotify_track_uri', 'spotify:track:… identifier. Used for rediscovery playlists and Open links.'],
  ['episode_name / episode_show_name / spotify_episode_uri', 'Podcast episode fields; the track fields are null on these rows.'],
  ['audiobook_title / audiobook_chapter_title / audiobook_uri', 'Present in newer exports for audiobook listening.'],
  ['reason_start', 'Why it started: trackdone (previous finished), clickrow, fwdbtn, backbtn, playbtn, appload, remote…'],
  ['reason_end', 'Why it ended: trackdone, fwdbtn (you skipped), backbtn, endplay, logout, unexpected-exit…'],
  ['shuffle', 'Whether shuffle was on.'],
  ['skipped', 'Spotify’s own skip flag. Often null in older years, so reason_end = fwdbtn is used as well.'],
  ['offline / offline_timestamp', 'For offline plays, ts is when the play reached Spotify, which can be days later; offline_timestamp (Unix seconds, milliseconds in some older files) is close to when it really started. Liner Notes uses it for offline rows when the two differ by more than 5 minutes, so a flight’s listening lands on the flight.'],
  ['incognito_mode', 'Played in a private session. Spotify leaves these out of Wrapped; add the Private sessions rule to match.'],
]

export default function Docs() {
  return (
    <section className="page narrow docs">
      <div className="eyebrow">Docs · last reviewed 13 November 2026</div>
      <h1>Getting your Spotify data, and what&rsquo;s in it</h1>
      <p className="lede">Spotify gives you two exports. You want <b>Extended streaming history</b>: every stream since you opened the account, with skips, shuffle and track URIs. The basic <b>Account data</b> export works too, but covers about a year with four fields.</p>
      <nav className="toc" aria-label="On this page">
        <a href="#request">Request it</a><a href="#files">The files</a><a href="#fields">Field meanings</a><a href="#definitions">How things are counted</a><a href="#wrapped">Why it differs from Wrapped</a><a href="#playlists">Rediscovery playlists</a><a href="#sources">Sources</a><a href="#privacy">Privacy</a>
      </nav>

      <h2 id="request">1. Request your data</h2>
      <ol>
        <li>In a web browser (not the app), sign in at <b>spotify.com</b> and open <b>Account → Privacy settings</b> (spotify.com/account/privacy).</li>
        <li>Scroll to <b>Download your data</b>. Tick <b>Extended streaming history</b>. You can tick <b>Account data</b> as well; they arrive separately.</li>
        <li>Press <b>Request data</b>, then confirm with the link Spotify emails you. Nothing happens until you click it.</li>
        <li>Wait. Spotify says Account data takes up to 5 days and Extended streaming history up to 30 days; in practice it is often a few days.</li>
        <li>When the &ldquo;your data is ready&rdquo; email arrives, download <code>my_spotify_data.zip</code>. The link expires after about two weeks.</li>
        <li>Open <Link href="/app">Liner Notes</Link>, create a listener and drop the zip (or the JSON files inside) on the Data tab.</li>
      </ol>
      <p className="muted small">These steps and timings are as of the review date above; Spotify occasionally renames the menu items. Request again every few months and import the new zip into the same listener: duplicates are removed and a snapshot shows what changed.</p>

      <h2 id="files">2. The files</h2>
      <ul>
        <li><code>Spotify Extended Streaming History/Streaming_History_Audio_2019-2021_0.json</code> and so on: music, podcasts and audiobooks, split by years and size.</li>
        <li><code>Streaming_History_Video_*.json</code>: video podcasts and clips. Imported as video, kept out of music tops.</li>
        <li>Older extended requests use <code>MyData/endsong_0.json</code> (and <code>endvideo.json</code>) with the same fields; both are read.</li>
        <li><code>Spotify Account Data/StreamingHistory_music_0.json</code> and <code>StreamingHistory_podcast_0.json</code> (Account data): the last year, with only end time, artist, track and ms played. Times are minute-precision UTC and there are no URIs.</li>
        <li>Everything else in the zip (Userdata, Playlists, Inferences, ReadMe.pdf) is ignored.</li>
      </ul>
      <Code label="Extended streaming history (one row)" code={EXT_SAMPLE} />
      <Code label="Account data, StreamingHistory_music_*.json" code={BASIC_SAMPLE} />

      <h2 id="fields">3. Field meanings</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Field</th><th>Meaning</th></tr></thead>
        <tbody>{FIELDS.map(([f, d]) => <tr key={f}><th><code>{f}</code></th><td>{d}</td></tr>)}</tbody>
      </table></div>

      <h2 id="definitions">4. How things are counted</h2>
      <ul>
        <li><b>Play</b>: a stream of at least 30 seconds (Spotify&rsquo;s own threshold). Change it per listener. Minutes always include every stream.</li>
        <li><b>Skip</b>: <code>skipped</code> is true or <code>reason_end</code> is <code>fwdbtn</code>. For the basic export, which has neither, a stream under the play threshold.</li>
        <li><b>Session</b>: streams with gaps of no more than 20 minutes between them (configurable).</li>
        <li><b>Streak</b>: consecutive local days with at least one play. The artist streak is the longest run of days with that artist.</li>
        <li><b>First listen</b>: the first qualifying play of a track in your history. If your history starts in 2016, nothing can be older than 2016.</li>
        <li><b>Peak month</b>: the month with the most plays of a track. <b>Lost favourites</b>: at least 10 plays, then none in the last 6 months of your data (both adjustable).</li>
        <li><b>Discovery rate</b>: artists played for the first time that month, divided by all artists played that month.</li>
        <li><b>Eras</b>: consecutive months whose top-10 artist mix stays similar (cosine similarity of minute shares). One-month blips fold into a neighbour.</li>
        <li><b>Duplicates</b>: rows with the same end minute, ms played and title are one stream, so overlapping requests merge cleanly. The basic export cuts the end time to the minute, so a basic row also matches an extended row (with a URI) in the neighbouring minute; the extended row is kept.</li>
      </ul>

      <h2 id="wrapped">5. Why it differs from Wrapped</h2>
      <ul>
        <li>Wrapped covers roughly 1 January to mid-November and excludes private sessions. Pick any 12 months here, and add the Private sessions rule to match.</li>
        <li>Sleep sounds, white noise, kids&rsquo; music and shared accounts can take over Wrapped. Spotify lets you exclude playlists from your taste profile going forward; the rules in <b>Fix my Wrapped</b> apply to the whole history and can be switched off again.</li>
        <li>Extended history sometimes has gaps (old devices, offline plays reported late). If a request shows months changing, History flags it.</li>
      </ul>

      <h2 id="playlists">6. Rediscovery playlists</h2>
      <ol>
        <li>Press <b>Copy as Spotify URIs</b> on Lost favourites, Top lists or Songs you always skip. You get one <code>spotify:track:…</code> per line.</li>
        <li>In the Spotify <b>desktop</b> app, create a playlist, click inside its (empty) track list and press <kbd>Ctrl</kbd>+<kbd>V</kbd> (Windows) or <kbd>&#8984;</kbd>+<kbd>V</kbd> (Mac).</li>
        <li>The tracks are added in order. The mobile and web players do not support pasting; use CSV export for other tools.</li>
      </ol>

      <h2 id="sources">7. Sources and test files</h2>
      <ul>
        <li>Field list: Spotify, <a href="https://support.spotify.com/us/article/understanding-my-data/" target="_blank" rel="noreferrer">Understanding my data</a> (checked 13 November 2026).</li>
        <li>Real rows with null metadata and <code>offline_timestamp</code> values: <a href="https://community.spotify.com/t5/Other-Podcasts-Partners-etc/Extended-Streaming-History-missing-track-metadata/td-p/6269152" target="_blank" rel="noreferrer">Spotify Community thread</a> (one row is copied into the test fixtures).</li>
        <li>offline_timestamp tracking the real listen time: a user&rsquo;s comparison in a <a href="https://community.spotify.com/t5/Spotify-for-Developers/Clarification-of-Spotify-data-export-structure/td-p/5360082" target="_blank" rel="noreferrer">Spotify for Developers thread</a> (Spotify has not confirmed it, so Liner Notes only applies it to offline rows that are more than 5 minutes out); <code>ts</code> being the end of the stream: <a href="https://community.metabrainz.org/t/spotify-import-from-listening-history-files-switches-start-and-end-times/791458" target="_blank" rel="noreferrer">MetaBrainz community</a>.</li>
        <li>A public basic export (<code>StreamingHistory0.json</code>, 125 rows, 2021) from the <a href="https://github.com/CurtisThompson/spotify-history" target="_blank" rel="noreferrer">CurtisThompson/spotify-history</a> repository imports with no skipped rows. The test suite uses files written to the exact layouts above: the 2024 extended layout, the 2025 layout with audiobook fields, and pretty-printed Account data files with a byte-order mark.</li>
      </ul>

      <h2 id="privacy">8. Privacy</h2>
      <ul>
        <li>Files are parsed in a Web Worker in your browser. IP addresses are discarded. The history is stored in this browser&rsquo;s IndexedDB.</li>
        <li>Accounts are optional. Signed in, Liner Notes syncs listener names, settings, exclusion rules, import logs and snapshot summaries (totals, top 25 artists and tracks, minutes per month). Raw streams are never uploaded.</li>
        <li>The account menu can export everything as JSON, delete your cloud data, or delete the account.</li>
      </ul>
    </section>
  )
}
