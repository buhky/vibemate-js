const { getState } = require('../state');
const player = require('../player/player');
const customPlaylists = require('../storage/customPlaylists');
const albumSelection = require('./albumSelection');
const { queueAlbum } = require('../player/sources');
const { ensureConnected } = require('../commands/_shared');
const { createReporter, ephemeral, safeEditReply } = require('../ui/messages');
const { md, truncate, splitOnce, extractVideoId } = require('../util');

async function onAddSongToPlaylist(interaction, state) {
    const [scope, name] = splitOnce(interaction.values[0], ':');
    const track = state.current;
    if (!track) {
        await interaction.update({ content: '❌ No song is currently playing.', components: [] });
        return;
    }
    const videoId = extractVideoId(track.url);
    if (!videoId) {
        await interaction.update({ content: '❌ Can only add YouTube songs to playlists.', components: [] });
        return;
    }
    const entry = customPlaylists.get(name, scope);
    if (!entry || !customPlaylists.canEdit(entry, interaction.user.id)) {
        await interaction.update({ content: "❌ That playlist doesn't exist or you can't add songs to it.", components: [] });
        return;
    }

    const song = {
        title: track.title,
        url: track.url,
        thumbnail: track.thumbnail || null,
        duration: track.durationStr || 'Unknown',
        videoId,
        addedBy: interaction.user.id,
        addedAt: Date.now(),
    };
    const result = customPlaylists.addSong(name, scope, song);
    const title = md(truncate(track.title, 120));
    let content;
    if (result.success) content = `✅ Added **"${title}"** to **${md(name)}**!`;
    else if (result.error === 'duplicate') content = `⚠️ **"${title}"** is already in **${md(name)}**!`;
    else content = '❌ Failed to add song to playlist.';
    await interaction.update({ content, components: [] });
}

async function onJumpSelect(interaction, state) {
    await interaction.deferUpdate();
    const index = parseInt(interaction.values[0], 10);
    const target = state.queue[index];
    if (!target) {
        await safeEditReply(interaction, { content: '❌ That song is no longer in the queue.', embeds: [], components: [] });
        return;
    }
    await safeEditReply(interaction, { content: `⏭️ **Jumping to:** ${md(truncate(target.title, 120))}`, embeds: [], components: [] });
    await player.jumpTo(state, index);
}

async function onAlbumSelect(interaction, state, key) {
    const entry = albumSelection.get(key);
    const album = entry?.albums.find(a => a.releaseGroupId === interaction.values[0]);
    if (!entry || !album) {
        await interaction.update({ content: '⚠️ This album list has expired. Run the command again.', components: [] });
        return;
    }
    await interaction.update({ content: `🎵 **Queueing:** ${md(album.title)}${entry.shuffle ? ' (shuffled)' : ''}`, components: [] });

    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
        await interaction.followUp(ephemeral('❌ You need to be in a voice channel first!'));
        return;
    }
    await ensureConnected(interaction, voiceChannel);

    // Progress goes to a public channel message, since the picker was ephemeral.
    const status = await interaction.channel.send({ content: `📥 **Fetching album:** ${md(album.title)} by ${md(entry.artistName)}` });
    const reporter = createReporter({ message: status, channel: interaction.channel });
    await queueAlbum(state, reporter, {
        artistName: entry.artistName,
        albumTitle: album.title,
        releaseGroupId: album.releaseGroupId,
        shuffle: entry.shuffle,
        member: interaction.member,
    });
}

async function handle(interaction) {
    const state = getState(interaction.guildId);
    const id = interaction.customId;

    if (id === 'add-song-to-playlist') return onAddSongToPlaylist(interaction, state);
    if (id === 'jump_select') return onJumpSelect(interaction, state);
    if (id.startsWith('album_select:')) return onAlbumSelect(interaction, state, id.slice('album_select:'.length));
    await interaction.deferUpdate().catch(() => {});
}

module.exports = { handle };
