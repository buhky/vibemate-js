// MusicBrainz + Cover Art Archive lookups. All MusicBrainz requests go through
// one throttled, retrying fetch so the 1 request/second policy is respected.
const { log } = require('../logger');
const { sleep } = require('../util');

const MB_BASE = 'https://musicbrainz.org/ws/2';
const HEADERS = { 'User-Agent': 'VibeMate/2.0 (Discord music bot)', Accept: 'application/json' };
const MIN_INTERVAL_MS = 1100;

let chain = Promise.resolve();
let lastRequestAt = 0;

function throttled(work) {
    const run = chain.then(async () => {
        const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
        if (wait > 0) await sleep(wait);
        lastRequestAt = Date.now();
        return work();
    });
    chain = run.catch(() => {});
    return run;
}

async function mbGet(pathAndQuery, retries = 3) {
    return throttled(async () => {
        let lastErr = null;
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const res = await fetch(`${MB_BASE}${pathAndQuery}`, { headers: HEADERS });
                if (res.status === 200) return res.json();
                if (res.status === 404) return null;
                lastErr = new Error(`MusicBrainz responded ${res.status}`);
                if (res.status !== 429 && res.status < 500) throw lastErr;
            } catch (err) {
                lastErr = err;
            }
            if (attempt < retries) await sleep(1000 * attempt);
        }
        throw lastErr;
    });
}

// ---------- fuzzy matching ----------
function levenshtein(a, b) {
    const rows = b.length + 1;
    const cols = a.length + 1;
    const m = Array.from({ length: rows }, (_, i) => [i]);
    for (let j = 0; j < cols; j++) m[0][j] = j;
    for (let i = 1; i < rows; i++) {
        for (let j = 1; j < cols; j++) {
            m[i][j] = b[i - 1] === a[j - 1]
                ? m[i - 1][j - 1]
                : Math.min(m[i - 1][j - 1], m[i][j - 1], m[i - 1][j]) + 1;
        }
    }
    return m[rows - 1][cols - 1];
}

function similarity(a, b) {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    const longer = x.length >= y.length ? x : y;
    if (!longer.length) return 1;
    return (longer.length - levenshtein(x, y)) / longer.length;
}

function closestMatch(query, candidates, cutoff) {
    let best = null;
    let bestScore = cutoff;
    for (const candidate of candidates) {
        const score = similarity(query, candidate);
        if (score > bestScore) {
            bestScore = score;
            best = candidate;
        }
    }
    return best;
}

// ---------- lookups ----------
async function findArtist(name) {
    const data = await mbGet(`/artist/?query=${encodeURIComponent(name)}&fmt=json&limit=10`);
    const artists = data?.artists || [];
    if (!artists.length) return null;
    const bestName = closestMatch(name, artists.map(a => a.name), 0.4);
    if (!bestName) return null;
    return artists.find(a => a.name === bestName) || artists[0];
}

async function getReleaseGroups(artistId) {
    const data = await mbGet(`/release-group?artist=${artistId}&fmt=json&limit=100`);
    return data?.['release-groups'] || [];
}

function yearOf(rg) {
    return rg['first-release-date'] ? rg['first-release-date'].slice(0, 4) : 'Unknown';
}

// Albums and mixtapes by an artist, alphabetical. Returns { artistName, albums }.
async function getArtistAlbums(artistName) {
    const artist = await findArtist(artistName);
    if (!artist) return { artistName, albums: [] };

    const albums = [];
    for (const rg of await getReleaseGroups(artist.id)) {
        const primary = rg['primary-type'] || 'Album';
        const secondary = rg['secondary-types'] || [];
        if (primary === 'Album' && secondary.length === 0) {
            albums.push({ title: rg.title, type: 'Album', year: yearOf(rg), releaseGroupId: rg.id });
        } else if (secondary.includes('Mixtape/Street')) {
            albums.push({ title: rg.title, type: 'Mixtape', year: yearOf(rg), releaseGroupId: rg.id });
        }
    }
    albums.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    return { artistName: artist.name, albums };
}

// Find one album by artist + album name. Returns { artistName, title, releaseGroupId } or null.
async function findAlbum(artistName, albumName) {
    const artist = await findArtist(artistName);
    if (!artist) return null;

    const groups = await getReleaseGroups(artist.id);
    if (!groups.length) return null;

    let bestTitle = closestMatch(albumName, groups.map(rg => rg.title), 0.2);
    if (!bestTitle) {
        const needle = albumName.toLowerCase();
        const partial = groups.find(rg => {
            const t = rg.title.toLowerCase();
            return t.includes(needle) || needle.includes(t);
        });
        bestTitle = partial ? partial.title : null;
    }
    if (!bestTitle) return null;

    const chosen = groups.find(rg => rg.title === bestTitle);
    return { artistName: artist.name, title: chosen.title, releaseGroupId: chosen.id };
}

function pickRelease(releases) {
    const official = releases.filter(r => r.status === 'Official');
    const pool = official.length ? official : releases;
    return pool.find(r => r.country === 'XW')
        || pool.find(r => r.country === 'US')
        || pool[0];
}

async function getTracklist(releaseGroupId) {
    const group = await mbGet(`/release-group/${releaseGroupId}?inc=releases&fmt=json`);
    const releases = group?.releases || [];
    if (!releases.length) return [];

    const release = pickRelease(releases);
    const detail = await mbGet(`/release/${release.id}?inc=recordings&fmt=json`);
    const tracks = [];
    for (const medium of detail?.media || []) {
        for (const track of medium.tracks || []) tracks.push(track.title);
    }
    log('MB', `Found ${tracks.length} tracks for release group ${releaseGroupId}`);
    return tracks;
}

async function getCoverArt(releaseGroupId) {
    try {
        const res = await fetch(`https://coverartarchive.org/release-group/${releaseGroupId}`, { headers: HEADERS });
        if (res.status !== 200) return null;
        const data = await res.json();
        const images = data.images || [];
        const front = images.find(img => img.front === true || (img.types || []).includes('Front'));
        return (front || images[0])?.image || null;
    } catch (err) {
        log('COVER', `No cover art for ${releaseGroupId}:`, err.message);
        return null;
    }
}

module.exports = { getArtistAlbums, findAlbum, getTracklist, getCoverArt };
