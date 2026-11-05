// Voice connection lifecycle: join, move between channels without dropping the
// player, recover from Discord-side disconnects, and announce destruction so
// playback state can be torn down.
const { EventEmitter } = require('events');
const {
    joinVoiceChannel,
    entersState,
    getVoiceConnection,
    VoiceConnectionStatus,
} = require('@discordjs/voice');
const { log, warn, error } = require('../logger');

const voiceEvents = new EventEmitter();
const handled = new WeakSet();

function isLive(connection) {
    return Boolean(connection) && connection.state.status !== VoiceConnectionStatus.Destroyed;
}

// The guild's connection, or null when there is none or it has been destroyed.
function getActiveConnection(guildId) {
    const connection = getVoiceConnection(guildId);
    return isLive(connection) ? connection : null;
}

function attachHandlers(connection, guildId) {
    if (handled.has(connection)) return;
    handled.add(connection);

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
        // Moved to another channel or a brief network blip: the connection
        // re-enters Signalling/Connecting on its own. Anything else is final.
        try {
            await Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
            log('VOICE', `Reconnecting in guild ${guildId}`);
        } catch {
            if (isLive(connection)) {
                warn('VOICE', `Disconnected in guild ${guildId}, giving up`);
                connection.destroy();
            }
        }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
        log('VOICE', `Connection destroyed in guild ${guildId}`);
        voiceEvents.emit('destroyed', guildId);
    });

    connection.on('error', err => error('VOICE', `Connection error in guild ${guildId}:`, err.message));
}

async function connectToVoice(guild, voiceChannel) {
    const existing = getActiveConnection(guild.id);
    if (existing) {
        if (existing.joinConfig.channelId !== voiceChannel.id) {
            // Move channels while keeping the player subscription intact.
            existing.rejoin({ channelId: voiceChannel.id, selfDeaf: true, selfMute: false });
        }
        try {
            await entersState(existing, VoiceConnectionStatus.Ready, 15_000);
            log('VOICE', `Connected to ${voiceChannel.name}`);
            return existing;
        } catch (err) {
            warn('VOICE', 'Existing connection did not become ready, rejoining:', err.message);
            existing.destroy();
        }
    }

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
    });
    attachHandlers(connection, guild.id);

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    } catch (err) {
        error('VOICE', 'Connection error:', err.message);
        if (isLive(connection)) connection.destroy();
        throw err;
    }
    log('VOICE', `Connected to ${voiceChannel.name}`);
    return connection;
}

function leaveVoice(guildId) {
    const connection = getActiveConnection(guildId);
    if (connection) connection.destroy();
}

module.exports = { connectToVoice, getActiveConnection, leaveVoice, voiceEvents };
