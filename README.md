# VibeMate

A self-hosted Discord music bot. Search YouTube, queue whole playlists and
albums, and control everything from a single live "Now Playing" panel.

Every track is **downloaded to a local Opus file before it plays**, and the
next three tracks are pre-downloaded, so playback never stutters because of a
slow or throttled stream.

- YouTube search and links via yt-dlp, which updates itself on every start
- Whole albums via MusicBrainz, with cover art from the Cover Art Archive
- YouTube playlists, auto-remembered for the autocomplete dropdown
- Custom playlists, personal or public, built from the panel with one click
- Save the current queue as a playlist, and a rolling auto-save per server
  so a crash or restart is recoverable
- Vote-to-skip, seeking, pause, previous track, shuffle, jump

## How it works

```
/play-music "song name"
      │
      ▼
 yt-dlp search ──► queue ──► yt-dlp download to .opus ──► Discord voice
                      │                                        ▲
                      └── next 3 tracks pre-downloaded ────────┘
```

1. A command resolves what you asked for into queue entries (title, URL,
   duration, who asked). Playlists and albums are resolved in batches so the
   first songs start while the rest are still being looked up.
2. The player takes the first entry, downloads it with yt-dlp as 128 kbps
   Opus into a per-server temp folder, and hands the file to the voice
   connection as-is. No re-encoding.
3. While that plays, the next three entries are downloaded in the background.
   Finished files are deleted as soon as nothing in the queue needs them.
4. One "Now Playing" message per server is edited in place as things change.

Only the current track plus three pre-downloads ever exist on disk, and the
temp folder is wiped on startup and shutdown.

## Setup

Requirements: Docker with Compose, and a bot application from the
[Discord Developer Portal](https://discord.com/developers/applications).
Invite it with the `bot` and `applications.commands` scopes and give it
View Channels, Send Messages, Embed Links, Manage Messages (for `/clean`),
Connect and Speak.

```bash
git clone https://github.com/buhky/vibemate-js.git
cd vibemate-js
cp .env.example .env        # put your DISCORD_TOKEN in here
docker compose up -d --build
docker compose logs -f
```

Slash commands register globally on first start and can take up to an hour to
appear. Set `GUILD_IDS` in `.env` to your server id for instant registration.

### Configuration

Everything is read from `.env` (see `.env.example`).

| Variable | Required | What it does |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | Bot token |
| `GUILD_IDS` | no | Comma-separated server ids for instant command registration |
| `BOT_LOGO_URL` | no | Image next to the bot name on the panel |
| `YTDLP_COOKIES` | no | Path to a Netscape cookies file for age-restricted or bot-checked videos |
| `YTDLP_EXTRA_ARGS` | no | Extra arguments passed to every yt-dlp call |
| `YTDLP_PATH`, `FFMPEG_PATH` | no | Binary locations (the image sets these) |
| `DATA_DIR`, `TMP_DIR` | no | Where playlists and downloads live (the image sets these) |

### Updating

- Code changes in `src/`: the folder is mounted into the container, so
  `docker compose restart` is enough.
- Dependency or Dockerfile changes: `docker compose up -d --build`, or run
  `./rebuild.sh` for a clean rebuild.

## Commands

### Playback

| Command | What it does |
| --- | --- |
| `/play-music <query>` | Play a song by name or YouTube URL |
| `/play-next <query>` | Add a song to the front of the queue |
| `/join` | Join your voice channel |
| `/skip` | Skip. The requester skips instantly, others vote (majority of humans in the channel) |
| `/forceskip` | Skip without a vote |
| `/end` | Stop, clear the queue and leave voice |
| `/restart` | Reset playback and rejoin the last voice channel |

### Queue

| Command | What it does |
| --- | --- |
| `/queue` | Show the queue, 10 per page |
| `/jump` | Pick a queued song to play next |
| `/clear-queue` | Clear the queue, keep the current song |

### Playlists and albums

| Command | What it does |
| --- | --- |
| `/play-playlist <url or name>` | Queue a YouTube playlist, a saved playlist, a custom playlist, or the auto-saved "Last queue" |
| `/play-playlist-shuffle <url or name>` | Same, shuffled |
| `/play-album <artist> [album]` | Queue an album via MusicBrainz. Without an album name you get a dropdown of the artist's albums |
| `/play-album-shuffle <artist> [album]` | Same, shuffled |
| `/create-playlist <name> [public]` | New custom playlist. Public ones accept songs from anyone |
| `/my-playlists` | List the playlists you own |
| `/delete-playlist <name>` | Delete one of yours |
| `/clear-saved-playlists` | Forget every auto-remembered YouTube playlist |

### Utility

| Command | What it does |
| --- | --- |
| `/clean [minutes]` | Delete messages in the current channel for a while, sparing the panel. Needs Manage Messages |

## The Now Playing panel

One message per server, edited in place.

| Button | Action |
| --- | --- |
| ⏮️ Prev | Go back to the previous track (the current one is re-queued after it) |
| ⏪ / ⏩ | Seek 15 seconds back or forward |
| ⏸️ / ▶️ | Pause or resume |
| Skip ⏭️ | Vote to skip, or skip instantly if you requested the track |
| Open | Open the track on YouTube |
| 🔀 Shuffle | Shuffle the remaining queue |
| ➕ Add to Playlist | Add the current track to one of your playlists |
| 💾 Save Queue | Save the current track and queue as a public playlist, named by you with today's date appended |

### Auto-save

Every queue change is written to `data/queue-autosave.json`, one snapshot per
server. If the bot restarts or crashes, pick **💾 Last queue** in the
`/play-playlist` dropdown to rebuild it.

## Data on disk

| Path | Contents |
| --- | --- |
| `data/yt-savedplaylist.json` | YouTube playlists remembered for autocomplete |
| `data/custom-playlists.json` | Custom playlists and saved queues (titles and URLs only, no audio) |
| `data/queue-autosave.json` | Per-server auto-save snapshots |
| `.vibemate_tmp/` (inside the container) | Downloaded audio, deleted as soon as it is no longer needed |

Playlists and saved queues are shared across every server the bot is in.
The auto-save is per server.

## Project layout

```
src/
  index.js              client, command registration, dispatch, shutdown
  config.js             .env loading and settings
  state.js              one state object per guild (queue, history, player, panel)
  commands/             one file per command group
  interactions/         buttons, select menus, modals, autocomplete
  player/player.js      playback engine: download, play, seek, skip, previous, auto-save
  player/sources.js     building queue entries from search, playlists and albums
  services/ytdlp.js     yt-dlp wrapper (search, info, download with de-duplication)
  services/musicbrainz.js
  storage/              JSON persistence with atomic writes
  ui/panel.js           the Now Playing panel
  ui/messages.js        reply helpers that survive deleted messages and expired interactions
  voice/connection.js   join, move, reconnect, teardown
scripts/check.js        loads every module and lists the commands without logging in
```

`npm run check` is the quickest sanity test after an edit. To run it against
the Docker image:

```bash
docker compose run --rm --no-deps --entrypoint "" -v "$PWD/scripts:/app/scripts:ro" vibemate node scripts/check.js
```

## Troubleshooting

- **Bot joins but no sound:** check Speak permission, and that the channel is
  not full. The log line `[PLAY] Now playing:` confirms the file was handed to
  voice.
- **Downloads failing:** yt-dlp is upgraded on every container start, so a
  restart often fixes it. If YouTube asks for a sign-in, point `YTDLP_COOKIES`
  at a cookies file in `data/`.
- **Commands missing:** global registration can take up to an hour; set
  `GUILD_IDS` for instant registration.
- **Panel looks stale:** every panel edit is logged with the button states
  Discord stored, so `docker compose logs` shows what the bot actually sent.

## License

MIT
