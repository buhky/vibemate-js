// /clear-queue, /end and /restart.
const { SlashCommandBuilder } = require('discord.js');
const { getState } = require('../state');
const player = require('../player/player');
const panel = require('../ui/panel');
const { connectToVoice, getActiveConnection, leaveVoice } = require('../voice/connection');
const { replyEphemeral, tempReply, autoDelete } = require('../ui/messages');
const { error } = require('../logger');

async function notice(channel, content, ms = 10_000) {
    if (!channel) return;
    const msg = await channel.send(content).catch(() => null);
    autoDelete(msg, ms);
}

module.exports = [
    {
        data: new SlashCommandBuilder()
            .setName('clear-queue')
            .setDescription('Clear the queue (keeps current song playing)'),

        async execute(interaction) {
            const state = getState(interaction.guildId);
            if (state.queue.length === 0) {
                await replyEphemeral(interaction, '📭 Queue is already empty!');
                return;
            }
            const cleared = player.clearQueue(state);
            await panel.refresh(state);
            await tempReply(interaction, `🗑️ **Cleared ${cleared} song(s) from queue.** Current song will continue playing.`, 5000);
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('end')
            .setDescription('End all songs and stop playback'),

        async execute(interaction) {
            const state = getState(interaction.guildId);
            // Order matters: stop first so the player's Idle event cannot
            // advance the queue, then drop the panel, then leave voice.
            player.stopPlayback(state);
            await panel.remove(state);
            leaveVoice(interaction.guildId);
            await tempReply(interaction, '🛑 **Ended** playback and cleared queue!', 3000);
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('restart')
            .setDescription('Reset playback and rejoin the last voice channel'),

        async execute(interaction) {
            const state = getState(interaction.guildId);
            const connection = getActiveConnection(interaction.guildId);
            const channelId = connection?.joinConfig.channelId || state.lastVoiceChannelId;

            await tempReply(interaction, '🔄 **Restarting...**', 10_000);

            player.stopPlayback(state);
            await panel.remove(state);
            leaveVoice(interaction.guildId);
            state.textChannel = interaction.channel;

            if (!channelId) {
                await notice(interaction.channel, '✅ **Restarted!** Use `/play-music` to play a song.');
                return;
            }
            const channel = interaction.guild.channels.cache.get(channelId);
            if (!channel || !channel.isVoiceBased()) {
                await notice(interaction.channel, "⚠️ **Restarted** but couldn't find the previous voice channel.");
                return;
            }
            try {
                await connectToVoice(interaction.guild, channel);
                state.lastVoiceChannelId = channel.id;
                await notice(interaction.channel, '✅ **Restarted** and rejoined voice channel!');
            } catch (err) {
                error('RESTART', 'Could not rejoin voice:', err.message);
                await notice(interaction.channel, '⚠️ **Restarted** but failed to rejoin voice channel.');
            }
        },
    },
];
