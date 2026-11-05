// Central configuration. Values come from the environment, with a .env file in
// the project root loaded first (existing environment variables win).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function loadEnvFile(file) {
    if (!fs.existsSync(file)) return;
    for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
        if (quoted) value = value.slice(1, -1);
        if (process.env[key] === undefined) process.env[key] = value;
    }
}

loadEnvFile(path.join(ROOT, '.env'));

const env = process.env;
const DATA_DIR = path.resolve(ROOT, env.DATA_DIR || 'data');

module.exports = {
    ROOT,
    TOKEN: (env.DISCORD_TOKEN || '').trim(),
    GUILD_IDS: (env.GUILD_IDS || '').split(',').map(s => s.trim()).filter(Boolean),

    DATA_DIR,
    TMP_DIR: path.resolve(ROOT, env.TMP_DIR || '.vibemate_tmp'),
    PLAYLISTS_FILE: path.join(DATA_DIR, 'yt-savedplaylist.json'),
    CUSTOM_PLAYLISTS_FILE: path.join(DATA_DIR, 'custom-playlists.json'),

    YTDLP_PATH: env.YTDLP_PATH || 'yt-dlp',
    YTDLP_COOKIES: env.YTDLP_COOKIES || '',
    YTDLP_EXTRA_ARGS: (env.YTDLP_EXTRA_ARGS || '').split(' ').map(s => s.trim()).filter(Boolean),
    FFMPEG_PATH: env.FFMPEG_PATH || 'ffmpeg',

    BOT_LOGO_URL: env.BOT_LOGO_URL || null,
    EMBED_COLOR: 0x2B2D31,
    ACCENT_COLOR: 0x5865F2,

    BUFFER_AHEAD: 3,            // tracks to pre-download ahead of the current one
    SEEK_STEP_SECONDS: 15,
    MAX_PLAYLIST_NAME_LENGTH: 60,
    QUEUE_PAGE_SIZE: 10,
    ALBUM_SEARCH_BATCH: 5,
};
