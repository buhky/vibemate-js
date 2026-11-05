// One state object per guild instead of a dozen parallel Maps.
//
// Track item shape (queue, history, current):
//   { url, title, thumbnail, durationSecs, durationStr,
//     requesterName, requesterId, playlistName?, albumName?, filePath? }

class GuildState {
    constructor(guildId) {
        this.guildId = guildId;

        this.queue = [];
        this.history = [];          // past tracks, most recent first (excludes current)
        this.current = null;        // track item now playing / being loaded
        this.playback = null;       // { filePath, offset, startedAt, duration }

        this.player = null;         // AudioPlayer, created once and reused
        this.playChain = Promise.resolve();
        this.pendingPlays = 0;      // playNext calls queued but not finished loading
        this.playToken = 0;         // bumped by stopPlayback so stale loads abort
        this.suppressAutoAdvance = false;
        this.goingBack = false;     // next playNext must not push current into history
        this.bufferRunning = false;
        this.bufferAgain = false;

        this.skipVotes = new Set();
        this.votesNeeded = 0;

        this.textChannel = null;    // where the panel and notices go
        this.panelMessage = null;   // the now-playing message
        this.lastVoiceChannelId = null;
    }

    get isActive() {
        return this.current !== null || this.pendingPlays > 0;
    }

    resetPlaybackState() {
        this.queue = [];
        this.history = [];
        this.current = null;
        this.playback = null;
        this.goingBack = false;
        this.skipVotes.clear();
        this.votesNeeded = 0;
    }
}

const states = new Map();

function getState(guildId) {
    let state = states.get(guildId);
    if (!state) {
        state = new GuildState(guildId);
        states.set(guildId, state);
    }
    return state;
}

function allStates() {
    return [...states.values()];
}

module.exports = { GuildState, getState, allStates };
