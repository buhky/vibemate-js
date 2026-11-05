const { getState } = require('../state');
const { connectToVoice, getActiveConnection } = require('../voice/connection');
const { replyEphemeral } = require('../ui/messages');

// The caller's voice channel, or null after telling them to join one.
async function requireVoiceChannel(interaction) {
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
        await replyEphemeral(interaction, '❌ You need to be in a voice channel first!');
        return null;
    }
    return voiceChannel;
}

// Join (or stay in) the caller's voice channel and remember where to post
// the panel. Returns the guild state.
async function ensureConnected(interaction, voiceChannel) {
    const state = getState(interaction.guildId);
    state.textChannel = interaction.channel;
    state.lastVoiceChannelId = voiceChannel.id;
    await connectToVoice(interaction.guild, voiceChannel);
    return state;
}

// Humans currently in the bot's voice channel (for skip votes).
function humansInBotChannel(guild) {
    const connection = getActiveConnection(guild.id);
    if (!connection) return 0;
    const channel = guild.channels.cache.get(connection.joinConfig.channelId);
    if (!channel) return 0;
    return channel.members.filter(m => !m.user.bot).size;
}

module.exports = { requireVoiceChannel, ensureConnected, humansInBotChannel };
