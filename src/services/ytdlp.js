// Thin wrapper around the yt-dlp binary. Every track is fully downloaded to a
// local .opus file before it is played; nothing is streamed from YouTube.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { YTDLP_PATH, YTDLP_COOKIES, YTDLP_EXTRA_ARGS, TMP_DIR } = require('../config');
const { log, warn, error } = require('../logger');
const { extractVideoId, sleep } = require('../util');

const inflight = new Map(); // finalPath -> Promise<string>

function baseArgs() {
    const args = ['--no-warnings', '--quiet', '--no-progress', '--retries', '10', '--fragment-retries', '10'];
    if (YTDLP_COOKIES && fs.existsSync(YTDLP_COOKIES)) args.push('--cookies', YTDLP_COOKIES);
    args.push(...YTDLP_EXTRA_ARGS);
    return args;
}

function run(args, { json = false, timeoutMs = 10 * 60 * 1000 } = {}) {
    return new Promise((resolve, reject) => {
        execFile(
            YTDLP_PATH,
            [...baseArgs(), ...args],
            { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, windowsHide: true },
            (err, stdout, stderr) => {
                if (err) {
                    const text = (stderr || '').trim() || (err.message || '').replace(/^Command failed:[^\n]*\n?/, '').trim() || err.message;
                    const detail = text.split('\n').slice(-3).join(' | ');
                    const wrapped = new Error(`yt-dlp failed: ${detail}`);
                    wrapped.stderr = stderr;
                    return reject(wrapped);
                }
                if (!json) return resolve(stdout);
                try {
                    resolve(JSON.parse(stdout));
                } catch (parseErr) {
                    reject(new Error(`yt-dlp returned unparsable JSON: ${parseErr.message}`));
                }
            },
        );
    });
}

async function version() {
    return (await run(['--version'])).trim();
}

function pickThumbnail(info) {
    if (info.thumbnail) return info.thumbnail;
    const thumbs = Array.isArray(info.thumbnails) ? info.thumbnails : [];
    if (thumbs.length) return thumbs[thumbs.length - 1].url || thumbs[0].url || null;
    return info.id ? `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg` : null;
}

// Normalise a yt-dlp info dict (full or flat) into the fields the bot uses.
function normalize(info) {
    if (!info || !info.id) return null;
    const url = info.webpage_url
        || (info.url && /^https?:/.test(info.url) ? info.url : null)
        || `https://www.youtube.com/watch?v=${info.id}`;
    return {
        id: info.id,
        url,
        title: info.title || 'Unknown title',
        thumbnail: pickThumbnail(info),
        durationSecs: Number(info.duration) || 0,
    };
}

async function search(query) {
    log('YTDLP', 'Searching for:', query);
    const info = await run([`ytsearch1:${query}`, '--dump-single-json', '--flat-playlist', '--no-playlist'], { json: true, timeoutMs: 60_000 });
    const entry = info?.entries?.find(Boolean) || (info?.id ? info : null);
    return normalize(entry);
}

// Resolve a single video URL. Throws with code 'IS_PLAYLIST' when the URL is a
// playlist rather than a video.
function playlistError() {
    const err = new Error('That link is a playlist. Use /play-playlist for playlists.');
    err.code = 'IS_PLAYLIST';
    return err;
}

async function getInfo(url) {
    // A playlist link with no video in it cannot be played as a single track.
    if (/[?&]list=/.test(url) && !extractVideoId(url)) throw playlistError();
    const info = await run([url, '--dump-single-json', '--no-playlist'], { json: true, timeoutMs: 60_000 });
    if (info && info._type === 'playlist') throw playlistError();
    const track = normalize(info);
    if (!track) throw new Error('No video information returned.');
    return track;
}

async function getPlaylist(url) {
    log('YTDLP', 'Extracting playlist:', url);
    const info = await run([url, '--dump-single-json', '--flat-playlist', '--yes-playlist'], { json: true, timeoutMs: 120_000 });
    if (!info || info._type !== 'playlist' || !Array.isArray(info.entries)) return null;
    const entries = info.entries.map(normalize).filter(Boolean);
    return { title: info.title || 'Unknown Playlist', entries };
}

function guildTmpDir(guildId) {
    const dir = path.join(TMP_DIR, String(guildId));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function fileNameFor(url) {
    const id = extractVideoId(url);
    if (id) return id;
    return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

// Download audio for `url` into this guild's temp directory and resolve the
// path of the finished .opus file. Concurrent requests for the same file share
// one download, and an already finished file is reused.
function download(url, guildId) {
    const dir = guildTmpDir(guildId);
    const name = fileNameFor(url);
    const finalPath = path.join(dir, `${name}.opus`);

    if (fs.existsSync(finalPath)) return Promise.resolve(finalPath);
    if (inflight.has(finalPath)) return inflight.get(finalPath);

    const job = (async () => {
        log('YTDLP', 'Downloading audio for:', url);
        const args = [
            url,
            '--no-playlist',
            '-f', 'bestaudio/best',
            '-x', '--audio-format', 'opus', '--audio-quality', '128K',
            '-o', path.join(dir, `${name}.%(ext)s`),
        ];

        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await run(args);
                break;
            } catch (err) {
                const retryable = /403|Forbidden|HTTP Error 5\d\d|timed out/i.test(err.stderr || err.message);
                error('YTDLP', `Download attempt ${attempt}/${maxAttempts} failed:`, err.message);
                if (!retryable || attempt === maxAttempts) throw err;
                await sleep(1500 * attempt);
            }
        }

        if (!fs.existsSync(finalPath)) {
            // yt-dlp occasionally keeps a different container extension
            const alt = fs.readdirSync(dir).find(f => f.startsWith(`${name}.`) && /\.(opus|ogg|webm|m4a)$/.test(f));
            if (!alt) throw new Error('Downloaded file not found after processing');
            warn('YTDLP', 'Using alternate output file:', alt);
            fs.renameSync(path.join(dir, alt), finalPath);
        }
        log('YTDLP', 'Download complete:', finalPath);
        return finalPath;
    })();

    inflight.set(finalPath, job);
    job.finally(() => inflight.delete(finalPath)).catch(() => {});
    return job;
}

function isDownloading(filePath) {
    return inflight.has(filePath);
}

module.exports = { version, search, getInfo, getPlaylist, download, isDownloading, guildTmpDir };
