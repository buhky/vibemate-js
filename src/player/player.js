// Playback engine. One AudioPlayer per guild, one serialized "play next"
// pipeline per guild, and local files only: every track is downloaded by
// yt-dlp before it starts and deleted once nothing references it any more.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    StreamType,
    NoSubscriberBehavior,
} = require('@discordjs/voice');
const { FFMPEG_PATH, BUFFER_AHEAD, TMP_DIR } = require('../config');
const { getState, allStates } = require('../state');
const ytdlp = require('../services/ytdlp');
const autosave = require('../storage/autosave');
const { getActiveConnection, voiceEvents } = require('../voice/connection');
const panel = require('../ui/panel');
const { shuffleInPlace } = require('../util');
const { log, warn, error } = require('../logger');

// ---------- files ----------
function safeDelete(filePath) {
    if (!filePath) return;
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            log('CLEANUP', 'Deleted', filePath);
        }
    } catch (err) {
        error('CLEANUP', 'Could not delete', filePath, err.message);
    }
}

function isReferenced(state, filePath) {
    return state.queue.some(item => item.filePath === filePath);
}

function releaseFile(state, filePath) {
    if (filePath && !isReferenced(state, filePath)) safeDelete(filePath);
}

function cleanupGuildTmp(guildId) {
    const dir = path.join(TMP_DIR, String(guildId));
    if (!fs.existsSync(dir)) return;
    let count = 0;
    for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        if (ytdlp.isDownloading(file)) continue;
        try {
            fs.rmSync(file, { recursive: true, force: true });
            count++;
        } catch (err) {
            error('CLEANUP', 'Could not delete', file, err.message);
        }
    }
    log('CLEANUP', `Removed ${count} file(s) for guild ${guildId}`);
}

function cleanupAllTmp() {
    try {
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch (err) {
        error('CLEANUP', 'Could not clear temp directory:', err.message);
    }
    fs.mkdirSync(TMP_DIR, { recursive: true });
}

// ---------- autosave ----------
const autosaveTimers = new Map(); // guildId -> timeout

function stripTrack(track) {
    const { filePath, ...rest } = track;
    return rest;
}

// Write the current track + queue to disk shortly after any change. Only a
// non-empty state is written, so the last real queue survives /end and crashes.
function scheduleAutosave(state) {
    clearTimeout(autosaveTimers.get(state.guildId));
    autosaveTimers.set(state.guildId, setTimeout(() => {
        autosaveTimers.delete(state.guildId);
        if (!state.current && state.queue.length === 0) return;
        const snapshot = {
            savedAt: Date.now(),
            current: state.current ? stripTrack(state.current) : null,
            queue: state.queue.map(stripTrack),
        };
        if (!autosave.save(state.guildId, snapshot)) warn('AUTOSAVE', `Could not write snapshot for guild ${state.guildId}`);
    }, 2000).unref());
}

// ---------- audio ----------
function createResource(filePath, offsetSeconds = 0) {
    if (offsetSeconds <= 0) {
        // The downloaded file is already Ogg Opus: hand it straight to the demuxer.
        return createAudioResource(fs.createReadStream(filePath), { inputType: StreamType.OggOpus });
    }
    // Seeking: let ffmpeg start at the offset and re-mux to Ogg Opus.
    const ff = spawn(FFMPEG_PATH, [
        '-loglevel', 'error',
        '-ss', String(offsetSeconds),
        '-i', filePath,
        '-vn', '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2',
        '-f', 'opus', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    ff.on('error', err => error('FFMPEG', err.message));
    ff.stdout.on('close', () => {
        if (ff.exitCode === null) ff.kill('SIGKILL');
    });
    return createAudioResource(ff.stdout, { inputType: StreamType.OggOpus });
}

function stopPlayer(state) {
    if (!state.player) return;
    state.suppressAutoAdvance = true;
    try {
        state.player.stop(true);
    } finally {
        state.suppressAutoAdvance = false;
    }
}

function ensurePlayer(state, connection) {
    if (!state.player) {
        const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
        player.on('error', err => error('PLAYER', `Guild ${state.guildId}:`, err.message));
        player.on('stateChange', (oldState, newState) => {
            if (newState.status !== AudioPlayerStatus.Idle || oldState.status === AudioPlayerStatus.Idle) return;
            if (state.suppressAutoAdvance || state.pendingPlays > 0 || !state.current) return;
            playNext(state.guildId).catch(err => error('PLAYER', 'Auto-advance failed:', err));
        });
        state.player = player;
    }
    const subscription = connection.state.subscription;
    if (!subscription || subscription.player !== state.player) connection.subscribe(state.player);
    return state.player;
}

// ---------- play pipeline ----------
function playNext(guildId) {
    const state = getState(guildId);
    state.pendingPlays++;
    const run = state.playChain
        .then(() => doPlayNext(state), () => doPlayNext(state))
        .finally(() => { state.pendingPlays--; });
    state.playChain = run.catch(() => {});
    return run;
}

async function doPlayNext(state) {
    const { guildId } = state;
    const token = ++state.playToken;

    const finished = state.current;
    if (finished && !state.goingBack) state.history.unshift(finished);
    state.goingBack = false;
    state.current = null;
    state.playback = null;
    state.skipVotes.clear();
    state.votesNeeded = 0;
    if (finished?.filePath) releaseFile(state, finished.filePath);

    if (!getActiveConnection(guildId)) {
        log('PLAY', `Not connected in guild ${guildId}; nothing to play into`);
        stopPlayer(state);
        return;
    }
    if (state.queue.length === 0) {
        await handleQueueEnd(state);
        return;
    }

    const item = state.queue.shift();
    state.current = item;
    scheduleAutosave(state);
    log('PLAY', `Loading: ${item.title}`);

    let filePath;
    try {
        filePath = await ytdlp.download(item.url, guildId);
    } catch (err) {
        error('PLAY', `Could not download "${item.title}", skipping:`, err.message);
        if (token !== state.playToken) return;
        state.current = null;
        return doPlayNext(state);
    }
    if (token !== state.playToken) {
        log('PLAY', 'Playback was stopped while loading; discarding');
        return;
    }
    item.filePath = filePath;

    const connection = getActiveConnection(guildId);
    if (!connection) {
        state.current = null;
        return;
    }
    const player = ensurePlayer(state, connection);
    state.playback = { filePath, offset: 0, startedAt: Date.now(), duration: item.durationSecs || 0 };
    player.play(createResource(filePath));
    log('PLAY', `Now playing: ${item.title} (${item.url})`);

    await panel.refresh(state);
    bufferAhead(state);
}

async function handleQueueEnd(state) {
    log('QUEUE', `Queue ended for guild ${state.guildId}`);
    stopPlayer(state);
    const lastFile = state.playback?.filePath;
    state.current = null;
    state.playback = null;
    state.history = [];
    state.skipVotes.clear();
    state.votesNeeded = 0;
    safeDelete(lastFile);
    cleanupGuildTmp(state.guildId);
    await panel.showFinished(state);
}

// Stop everything for a guild: current track, queue, history, temp files.
function stopPlayback(state) {
    state.playToken++;
    stopPlayer(state);
    state.resetPlaybackState();
    cleanupGuildTmp(state.guildId);
}

// Pre-download the next few queued tracks, one at a time.
function bufferAhead(state) {
    if (state.bufferRunning) {
        state.bufferAgain = true;
        return;
    }
    state.bufferRunning = true;
    (async () => {
        do {
            state.bufferAgain = false;
            for (let i = 0; i < BUFFER_AHEAD; i++) {
                const item = state.queue[i];
                if (!item) break;
                if (item.filePath && fs.existsSync(item.filePath)) continue;
                try {
                    item.filePath = await ytdlp.download(item.url, state.guildId);
                } catch (err) {
                    warn('BUFFER', `Could not pre-download "${item.title}":`, err.message);
                }
            }
        } while (state.bufferAgain);
    })().finally(() => { state.bufferRunning = false; });
}

// ---------- queue operations ----------
function addTracks(state, items, { front = false } = {}) {
    if (front) state.queue.unshift(...items);
    else state.queue.push(...items);
    scheduleAutosave(state);
    return front ? 1 : state.queue.length;
}

// Start playing if idle, otherwise just update the panel's "Next Up".
async function startOrRefresh(state) {
    if (!state.isActive) {
        await playNext(state.guildId);
    } else {
        await panel.refresh(state);
        bufferAhead(state);
    }
}

function clearQueue(state) {
    const removed = state.queue.splice(0);
    for (const item of removed) {
        if (item.filePath && item.filePath !== state.playback?.filePath) safeDelete(item.filePath);
    }
    scheduleAutosave(state);
    return removed.length;
}

function shuffleQueue(state) {
    shuffleInPlace(state.queue);
    scheduleAutosave(state);
    bufferAhead(state);
}

async function jumpTo(state, index) {
    if (index < 0 || index >= state.queue.length) return null;
    const [item] = state.queue.splice(index, 1);
    state.queue.unshift(item);
    scheduleAutosave(state);
    await playNext(state.guildId);
    return item;
}

async function previous(state) {
    if (state.history.length === 0 || state.pendingPlays > 0) return false;
    const prev = state.history.shift();
    if (state.current) {
        const current = { ...state.current };
        if (!(state.queue[0] && state.queue[0].url === current.url)) state.queue.unshift(current);
    }
    state.queue.unshift({ ...prev, filePath: null });
    state.goingBack = true;
    scheduleAutosave(state);
    await playNext(state.guildId);
    return true;
}

// Current track, upcoming queue and (optionally) played history, oldest first.
function sessionTracks(state, { includeHistory = false } = {}) {
    const tracks = [];
    if (includeHistory) tracks.push(...[...state.history].reverse());
    if (state.current) tracks.push(state.current);
    tracks.push(...state.queue);
    return tracks.map(stripTrack);
}

// Stop the current track so auto-advance moves on. Ignored while the next
// track is still loading, since that load will replace playback anyway.
function skipCurrent(state) {
    if (!state.current || !state.player || state.pendingPlays > 0) return false;
    state.player.stop();
    return true;
}

// Returns { result: 'nothing' | 'skipped' | 'already' | 'voted', votes, needed }
function voteSkip(state, userId, humanCount) {
    if (!state.current) return { result: 'nothing' };
    if (state.current.requesterId === userId) {
        skipCurrent(state);
        return { result: 'skipped' };
    }
    const needed = Math.floor(humanCount / 2) + 1;
    state.votesNeeded = needed;
    if (state.skipVotes.has(userId)) return { result: 'already', votes: state.skipVotes.size, needed };
    state.skipVotes.add(userId);
    if (state.skipVotes.size >= needed) {
        skipCurrent(state);
        return { result: 'skipped' };
    }
    panel.refresh(state).catch(() => {});
    return { result: 'voted', votes: state.skipVotes.size, needed };
}

function currentPosition(state) {
    const pb = state.playback;
    if (!pb) return 0;
    let pos = pb.offset || 0;
    if (pb.startedAt) pos += (Date.now() - pb.startedAt) / 1000;
    return pos;
}

// 'paused' | 'resumed' | null
async function togglePause(state) {
    const player = state.player;
    const pb = state.playback;
    if (!player || !pb) return null;
    const status = player.state.status;
    let result = null;
    if (status === AudioPlayerStatus.Playing) {
        player.pause();
        pb.offset = currentPosition(state);
        pb.startedAt = null;
        result = 'paused';
    } else if (status === AudioPlayerStatus.Paused) {
        player.unpause();
        pb.startedAt = Date.now();
        result = 'resumed';
    } else {
        return null;
    }
    await panel.refresh(state);
    return result;
}

async function seek(state, deltaSeconds) {
    const player = state.player;
    const pb = state.playback;
    if (!player || !pb || !pb.filePath) return false;
    const status = player.state.status;
    if (status !== AudioPlayerStatus.Playing && status !== AudioPlayerStatus.Paused) return false;

    const wasPaused = status === AudioPlayerStatus.Paused;
    const max = pb.duration > 0 ? pb.duration : Infinity;
    const target = Math.max(0, Math.min(currentPosition(state) + deltaSeconds, max));

    try {
        player.play(createResource(pb.filePath, target));
    } catch (err) {
        error('SEEK', err.message);
        return false;
    }
    pb.offset = target;
    pb.startedAt = wasPaused ? null : Date.now();
    if (wasPaused) player.pause();
    return true;
}

// ---------- connection teardown ----------
voiceEvents.on('destroyed', guildId => {
    const state = getState(guildId);
    if (state.isActive || state.queue.length) stopPlayback(state);
    panel.remove(state).catch(() => {});
});

function shutdownAll() {
    for (const state of allStates()) {
        stopPlayback(state);
    }
    cleanupAllTmp();
}

module.exports = {
    playNext,
    stopPlayback,
    addTracks,
    startOrRefresh,
    clearQueue,
    shuffleQueue,
    jumpTo,
    previous,
    sessionTracks,
    skipCurrent,
    voteSkip,
    togglePause,
    seek,
    bufferAhead,
    cleanupAllTmp,
    shutdownAll,
};
