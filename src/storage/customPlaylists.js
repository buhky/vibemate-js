// User-made playlists. A playlist lives either in `public` (anyone can add
// songs) or under `users[<ownerId>]` (only the owner can add songs). A "scope"
// is the string 'public' or an owner id, and together with the name it
// identifies one playlist unambiguously.
const { CUSTOM_PLAYLISTS_FILE } = require('../config');
const { readJson, writeJson } = require('./jsonFile');
const { extractVideoId } = require('../util');

const EMPTY = { public: {}, users: {} };

function load() {
    const data = readJson(CUSTOM_PLAYLISTS_FILE, EMPTY);
    if (!data || typeof data !== 'object') return structuredClone(EMPTY);
    if (!data.public || typeof data.public !== 'object') data.public = {};
    if (!data.users || typeof data.users !== 'object') data.users = {};
    return data;
}

function save(data) {
    return writeJson(CUSTOM_PLAYLISTS_FILE, data);
}

function bucket(data, scope) {
    if (scope === 'public') return data.public;
    return data.users[scope] || null;
}

function entryFor(playlist, scope) {
    return { playlist, scope, isPublic: scope === 'public', ownerId: playlist.owner };
}

function get(name, scope) {
    const data = load();
    const b = bucket(data, scope);
    const playlist = b ? b[name] : null;
    return playlist ? entryFor(playlist, scope) : null;
}

// Find a playlist by name when the scope is unknown: the user's own first,
// then public, then anyone else's (those can be queued but not edited).
function findByName(name, userId) {
    const data = load();
    if (data.users[userId]?.[name]) return entryFor(data.users[userId][name], userId);
    if (data.public[name]) return entryFor(data.public[name], 'public');
    for (const [uid, lists] of Object.entries(data.users)) {
        if (lists[name]) return entryFor(lists[name], uid);
    }
    return null;
}

function create(name, userId, isPublic) {
    const data = load();
    const playlist = { type: 'custom', owner: userId, isPublic, songs: [] };
    if (isPublic) {
        data.public[name] = playlist;
    } else {
        if (!data.users[userId]) data.users[userId] = {};
        data.users[userId][name] = playlist;
    }
    return save(data);
}

function canEdit(entry, userId) {
    return entry.isPublic || entry.ownerId === userId;
}

// A playlist song record built from a queue track.
function songFromTrack(track, addedBy) {
    return {
        title: track.title,
        url: track.url,
        thumbnail: track.thumbnail || null,
        duration: track.durationStr || 'Unknown',
        videoId: extractVideoId(track.url),
        addedBy,
        addedAt: Date.now(),
    };
}

// Create a playlist already filled with songs (duplicates by video id dropped).
// If the name is taken, " (2)", " (3)"... is appended. Returns the final name.
function createWithSongs(name, userId, isPublic, songs) {
    const data = load();
    const target = isPublic ? data.public : (data.users[userId] = data.users[userId] || {});
    let finalName = name;
    for (let n = 2; target[finalName]; n++) finalName = `${name} (${n})`;

    const seen = new Set();
    const unique = [];
    for (const song of songs) {
        const key = song.videoId || song.url;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(song);
    }
    target[finalName] = { type: 'custom', owner: userId, isPublic, songs: unique };
    return save(data) ? { name: finalName, count: unique.length } : null;
}

function addSong(name, scope, song) {
    const data = load();
    const b = bucket(data, scope);
    const playlist = b ? b[name] : null;
    if (!playlist) return { success: false, error: 'not_found' };

    const newId = song.videoId || extractVideoId(song.url);
    if (newId && playlist.songs.some(s => (s.videoId || extractVideoId(s.url)) === newId)) {
        return { success: false, error: 'duplicate' };
    }
    playlist.songs.push(song);
    return save(data) ? { success: true } : { success: false, error: 'save_failed' };
}

function remove(name, userId) {
    const data = load();
    if (data.public[name] && data.public[name].owner === userId) {
        delete data.public[name];
        return save(data);
    }
    if (data.users[userId]?.[name]) {
        delete data.users[userId][name];
        return save(data);
    }
    return false;
}

// Playlists the user owns (personal + public ones they created).
function listOwned(userId) {
    const data = load();
    const out = [];
    for (const [name, playlist] of Object.entries(data.users[userId] || {})) {
        out.push({ name, scope: userId, isPublic: false, ownerId: userId, songCount: playlist.songs.length });
    }
    for (const [name, playlist] of Object.entries(data.public)) {
        if (playlist.owner === userId) {
            out.push({ name, scope: 'public', isPublic: true, ownerId: userId, songCount: playlist.songs.length });
        }
    }
    return out;
}

// Every playlist, flagged with whether this user may add songs to it.
function listAll(userId) {
    const data = load();
    const out = [];
    for (const [name, playlist] of Object.entries(data.public)) {
        out.push({ name, scope: 'public', isPublic: true, ownerId: playlist.owner, songCount: playlist.songs.length, canEdit: true });
    }
    for (const [uid, lists] of Object.entries(data.users)) {
        for (const [name, playlist] of Object.entries(lists)) {
            out.push({ name, scope: uid, isPublic: false, ownerId: uid, songCount: playlist.songs.length, canEdit: uid === userId });
        }
    }
    return out;
}

module.exports = { get, findByName, create, createWithSongs, songFromTrack, canEdit, addSong, remove, listOwned, listAll };
