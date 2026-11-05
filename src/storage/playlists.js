// Saved YouTube playlists: { "Playlist name": "https://www.youtube.com/playlist?list=..." }
const { PLAYLISTS_FILE } = require('../config');
const { readJson, writeJson } = require('./jsonFile');

function load() {
    const data = readJson(PLAYLISTS_FILE, {});
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

function save(playlists) {
    return writeJson(PLAYLISTS_FILE, playlists);
}

function add(name, url) {
    const playlists = load();
    playlists[name] = url;
    return save(playlists);
}

function clear() {
    return save({});
}

module.exports = { load, save, add, clear };
