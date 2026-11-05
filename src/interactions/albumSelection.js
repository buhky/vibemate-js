// Short-lived cache of album lists shown in a dropdown, so the select menu
// value can be a small key + release group id instead of the full album title
// (Discord caps select values and custom ids at 100 characters).
const crypto = require('crypto');

const TTL_MS = 15 * 60 * 1000;
const pending = new Map();

function prune() {
    const now = Date.now();
    for (const [key, entry] of pending) {
        if (entry.expiresAt < now) pending.delete(key);
    }
}

function remember({ artistName, albums, shuffle }) {
    prune();
    const key = crypto.randomBytes(6).toString('base64url');
    pending.set(key, { artistName, albums, shuffle, expiresAt: Date.now() + TTL_MS });
    return key;
}

function get(key) {
    prune();
    return pending.get(key) || null;
}

module.exports = { remember, get };
