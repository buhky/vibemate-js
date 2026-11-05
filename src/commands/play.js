// /play-music and /play-next share everything except where the track lands.
const { SlashCommandBuilder } = require('discord.js');
const { requireVoiceChannel, ensureConnected } = require('./_shared');
const { resolveTrack } = require('../player/sources');
const player = require('../player/player');
const { tempReply, safeEditReply } = require('../ui/messages');
const { md } = require('../util');
const { error } = require('../logger');

function makePlayCommand({ name, description, optionDescription, front }) {
    return {
        data: new SlashCommandBuilder()
            .setName(name)
            .setDescription(description)
            .addStringOption(option =>
                option.setName('query').setDescription(optionDescription).setRequired(true)),

        async execute(interaction) {
            const voiceChannel = await requireVoiceChannel(interaction);
            if (!voiceChannel) return;
            await interaction.deferReply();

            const query = interaction.options.getString('query').trim();
            const state = await ensureConnected(interaction, voiceChannel);

            let track;
            try {
                track = await resolveTrack(query, interaction.member);
            } catch (err) {
                error('PLAY', `Could not resolve "${query}":`, err.message);
                const msg = err.code === 'IS_PLAYLIST'
                    ? err.message
                    : '❌ Could not find that song. Try a different query or link.';
                await safeEditReply(interaction, { content: msg });
                return;
            }

            const wasActive = state.isActive;
            const position = player.addTracks(state, [track], { front });

            if (wasActive) {
                const where = front ? '⚡ **Added to front of queue:**' : `✅ **Queued at #${position}:**`;
                await tempReply(interaction, `${where} ${md(track.title)}`, 5000);
            } else {
                await tempReply(interaction, `▶️ **Playing:** ${md(track.title)}`, 5000);
            }
            // Playback (and the download it needs) runs independently of the reply above.
            await player.startOrRefresh(state);
        },
    };
}

module.exports = [
    makePlayCommand({
        name: 'play-music',
        description: 'Play a song in your voice channel',
        optionDescription: 'Song name or YouTube URL',
        front: false,
    }),
    makePlayCommand({
        name: 'play-next',
        description: 'Add a song to the front of the queue (plays next)',
        optionDescription: 'Song name or YouTube URL to add to front of queue',
        front: true,
    }),
];
