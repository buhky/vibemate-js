// Rolling per-server snapshot of the current track and queue, written on every
// queue change so a crash or restart can be recovered with /play-playlist.
const path = require('path');
const { DATA_DIR } = require('../config');
const { readJson, writeJson } = require('./jsonFile');

const FILE = path.join(DATA_DIR, 'queue-autosave.json');
const NAME = 'Last queue';

function load() {
    const data = readJson(FILE, {});
    return data && typeof data === 'object' ? data : {};
}

function get(guildId) {
    return load()[guildId] || null;
}

function save(guildId, snapshot) {
    const data = load();
    data[guildId] = snapshot;
    return writeJson(FILE, data);
}

module.exports = { get, save, NAME };
