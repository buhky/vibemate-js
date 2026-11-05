// Modal (pop-up form) handlers. Currently just "Save Queue".
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { MAX_PLAYLIST_NAME_LENGTH } = require('../config');
const { getState } = require('../state');
const player = require('../player/player');
const customPlaylists = require('../storage/customPlaylists');
const { replyEphemeral } = require('../ui/messages');
const { md } = require('../util');
const { log } = require('../logger');

const DATE_SUFFIX_LENGTH = ' - 2026-01-01'.length;
const MAX_NAME_INPUT = MAX_PLAYLIST_NAME_LENGTH - DATE_SUFFIX_LENGTH;

function todayStamp() {
    return new Date().toISOString().slice(0, 10);
}

function buildSaveQueueModal(state) {
    const count = state.queue.length + (state.current ? 1 : 0);
    return new ModalBuilder()
        .setCustomId('save-queue-modal')
        .setTitle(`Save queue (${count} song${count === 1 ? '' : 's'})`)
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('name')
                    .setLabel('Playlist name (the date is added for you)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Friday vibes')
                    .setRequired(true)
                    .setMinLength(1)
                    .setMaxLength(MAX_NAME_INPUT),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('history')
                    .setLabel('Include songs that already played? (yes/no)')
                    .setStyle(TextInputStyle.Short)
                    .setValue('no')
                    .setRequired(false)
                    .setMaxLength(3),
            ),
        );
}

async function onSaveQueue(interaction, state) {
    const rawName = interaction.fields.getTextInputValue('name').trim();
    const includeHistory = /^y/i.test(interaction.fields.getTextInputValue('history') || '');
    const tracks = player.sessionTracks(state, { includeHistory });
    if (tracks.length === 0) {
        await replyEphemeral(interaction, '❌ Nothing is playing or queued, so there is nothing to save.');
        return;
    }

    const userId = interaction.user.id;
    const name = `${rawName.slice(0, MAX_NAME_INPUT)} - ${todayStamp()}`;
    const songs = tracks.map(track => customPlaylists.songFromTrack(track, userId));
    const result = customPlaylists.createWithSongs(name, userId, true, songs);
    if (!result) {
        await replyEphemeral(interaction, '❌ Could not save the queue.');
        return;
    }
    log('SAVE', `${interaction.user.tag} saved ${result.count} songs as "${result.name}" in guild ${state.guildId}`);
    await replyEphemeral(interaction,
        `💾 Saved **${result.count} songs** as public playlist **${md(result.name)}**.\n`
        + 'Bring it back any time with `/play-playlist` or `/play-playlist-shuffle` (it is in the dropdown).');
}

async function handle(interaction) {
    const state = getState(interaction.guildId);
    if (interaction.customId === 'save-queue-modal') return onSaveQueue(interaction, state);
    await replyEphemeral(interaction, '⚠️ Unknown form.');
}

module.exports = { handle, buildSaveQueueModal };
