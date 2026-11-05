const { escapeMarkdown } = require('discord.js');

function formatDuration(seconds) {
    if (!seconds || seconds < 0) return 'Unknown';
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const mm = hours > 0 ? String(mins).padStart(2, '0') : String(mins);
    const prefix = hours > 0 ? `${hours}:` : '';
    return `${prefix}${mm}:${String(secs).padStart(2, '0')}`;
}

// "5:30" or "1:02:03" -> seconds
function parseDuration(str) {
    if (!str || str === 'Unknown') return 0;
    const parts = String(str).split(':').map(p => parseInt(p, 10));
    if (parts.some(Number.isNaN)) return 0;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function truncate(text, max) {
    if (!text) return '';
    return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function isUrl(str) {
    return /^https?:\/\//i.test(str || '');
}

function extractVideoId(url) {
    if (!url) return null;
    const m = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
}

function extractPlaylistId(url) {
    const m = (url || '').match(/[?&]list=([^&#]+)/);
    return m ? m[1] : null;
}

function md(text) {
    return escapeMarkdown(String(text ?? ''));
}

// Split "scope:rest" at the first separator only, so the rest may contain it.
function splitOnce(str, sep) {
    const i = str.indexOf(sep);
    return i < 0 ? [str, ''] : [str.slice(0, i), str.slice(i + sep.length)];
}

module.exports = {
    formatDuration,
    parseDuration,
    shuffleInPlace,
    sleep,
    truncate,
    isUrl,
    extractVideoId,
    extractPlaylistId,
    md,
    splitOnce,
};
