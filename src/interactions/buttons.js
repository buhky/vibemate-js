const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { SEEK_STEP_SECONDS } = require('../config');
const { getState } = require('../state');
const player = require('../player/player');
const panel = require('../ui/panel');
const customPlaylists = require('../storage/customPlaylists');
const albumSelection = require('./albumSelection');
const { humansInBotChannel } = require('../commands/_shared');
const { buildQueuePage } = require('../commands/queue');
const { buildJumpMenu } = require('../commands/jump');
const { buildAlbumMenu } = require('../commands/album');
const { buildSaveQueueModal } = require('./modals');
const { replyEphemeral, ephemeral, autoDelete } = require('../ui/messages');
const { md, truncate } = require('../util');
const { log } = require('../logger');

async function onPrevious(interaction, state) {
    await interaction.deferUpdate();
    await player.previous(state);
}

async function onToggle(interaction, state) {
    await interaction.deferUpdate();
    const result = await player.togglePause(state);
    if (result) log('TOGGLE', `${result} playback in guild ${state.guildId}`);
}

async function onSeek(interaction, state, delta) {
    await interaction.deferUpdate();
    await player.seek(state, delta);
}

async function onSkip(interaction, state) {
    await interaction.deferUpdate();
    player.voteSkip(state, interaction.user.id, humansInBotChannel(interaction.guild));
}

async function onShuffle(interaction, state) {
    await interaction.deferUpdate();
    if (state.queue.length < 2) return;
    player.shuffleQueue(state);
    log('SHUFFLE', `Shuffled ${state.queue.length} items in guild ${state.guildId}`);
    await panel.refresh(state);
    const channel = state.textChannel || interaction.channel;
    const msg = await channel?.send({ content: `🔀 **Shuffled queue!** ${state.queue.length} songs reordered.` }).catch(() => null);
    autoDelete(msg, 5000);
}

async function onAddToPlaylist(interaction, state) {
    const track = state.current;
    if (!track) {
        await replyEphemeral(interaction, '❌ No song is currently playing.');
        return;
    }
    const userId = interaction.user.id;
    const editable = customPlaylists.listAll(userId).filter(p => p.canEdit);
    if (editable.length === 0) {
        await replyEphemeral(interaction, "❌ You don't have any playlists yet. Use `/create-playlist` to create one!");
        return;
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId('add-song-to-playlist')
        .setPlaceholder('Select a playlist to add this song to...');
    for (const playlist of editable.slice(0, 25)) {
        menu.addOptions({
            label: truncate(`${playlist.isPublic ? '🌐' : '👤'} ${playlist.name}`, 100),
            description: `${playlist.songCount} songs`,
            value: truncate(`${playlist.scope}:${playlist.name}`, 100),
        });
    }
    await interaction.reply(ephemeral({
        content: `**Add "${md(truncate(track.title, 120))}" to playlist:**`,
        components: [new ActionRowBuilder().addComponents(menu)],
    }));
}

async function onSaveQueue(interaction, state) {
    if (!state.current && state.queue.length === 0) {
        await replyEphemeral(interaction, '❌ Nothing is playing or queued, so there is nothing to save.');
        return;
    }
    await interaction.showModal(buildSaveQueueModal(state));
}

async function handle(interaction) {
    const state = getState(interaction.guildId);
    const id = interaction.customId;

    // Paginated pickers (ephemeral messages owned by the clicking user).
    if (id.startsWith('queue_page:')) {
        await interaction.update(buildQueuePage(state, parseInt(id.split(':')[1], 10) || 0));
        return;
    }
    if (id.startsWith('jump_page:')) {
        if (state.queue.length === 0) {
            await interaction.update({ content: '📭 Queue is empty!', embeds: [], components: [] });
            return;
        }
        await interaction.update(buildJumpMenu(state, parseInt(id.split(':')[1], 10) || 0));
        return;
    }
    if (id.startsWith('album_page:')) {
        const [, key, pageStr] = id.split(':');
        const entry = albumSelection.get(key);
        if (!entry) {
            await interaction.update({ content: '⚠️ This album list has expired. Run the command again.', components: [] });
            return;
        }
        await interaction.update(buildAlbumMenu(key, entry, parseInt(pageStr, 10) || 0));
        return;
    }

    // Now-playing panel controls.
    state.textChannel = interaction.channel;
    switch (id) {
        case 'previous': return onPrevious(interaction, state);
        case 'toggle': return onToggle(interaction, state);
        case 'seek-backward': return onSeek(interaction, state, -SEEK_STEP_SECONDS);
        case 'seek-forward': return onSeek(interaction, state, SEEK_STEP_SECONDS);
        case 'skip': return onSkip(interaction, state);
        case 'shuffle': return onShuffle(interaction, state);
        case 'add-to-playlist': return onAddToPlaylist(interaction, state);
        case 'save-queue': return onSaveQueue(interaction, state);
        default:
            await interaction.deferUpdate().catch(() => {});
    }
}

module.exports = { handle };
