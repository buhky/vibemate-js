// /play-album and /play-album-shuffle. With an album name the album is queued
// directly; with only an artist a dropdown of their albums is shown.
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { requireVoiceChannel, ensureConnected } = require('./_shared');
const musicbrainz = require('../services/musicbrainz');
const albumSelection = require('../interactions/albumSelection');
const { queueAlbum } = require('../player/sources');
const { createReporter, ephemeral, safeEditReply } = require('../ui/messages');
const { md, truncate } = require('../util');

const PAGE_SIZE = 25; // Discord's select menu limit

function buildAlbumMenu(key, entry, page = 0) {
    const { artistName, albums, shuffle } = entry;
    const totalPages = Math.max(1, Math.ceil(albums.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const pageItems = albums.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`album_select:${key}`)
        .setPlaceholder(truncate(`Select an album by ${artistName}${shuffle ? ' (shuffled)' : ''} (Page ${safePage + 1}/${totalPages})`, 150));

    for (const album of pageItems) {
        menu.addOptions({
            label: truncate(album.title, 100),
            description: truncate(`${album.type} • ${album.year}`, 100),
            value: album.releaseGroupId,
        });
    }

    const components = [new ActionRowBuilder().addComponents(menu)];
    if (totalPages > 1) {
        const nav = new ActionRowBuilder();
        if (safePage > 0) {
            nav.addComponents(new ButtonBuilder().setCustomId(`album_page:${key}:${safePage - 1}`).setLabel('◀ Previous').setStyle(ButtonStyle.Secondary));
        }
        if (safePage < totalPages - 1) {
            nav.addComponents(new ButtonBuilder().setCustomId(`album_page:${key}:${safePage + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary));
        }
        components.push(nav);
    }
    return {
        content: `🎵 **Select an album by ${md(artistName)}${shuffle ? ' (will be shuffled)' : ''}:**`,
        components,
    };
}

function makeAlbumCommand({ name, description, shuffle }) {
    return {
        data: new SlashCommandBuilder()
            .setName(name)
            .setDescription(description)
            .addStringOption(option =>
                option.setName('artist').setDescription('Artist name (e.g., "Drake")').setRequired(true))
            .addStringOption(option =>
                option.setName('album').setDescription('Album name (optional - if not provided, shows all albums by artist)').setRequired(false)),

        async execute(interaction) {
            const voiceChannel = await requireVoiceChannel(interaction);
            if (!voiceChannel) return;

            const artist = interaction.options.getString('artist').trim();
            const album = interaction.options.getString('album')?.trim();

            if (album) {
                await interaction.deferReply();
                const state = await ensureConnected(interaction, voiceChannel);
                const reporter = createReporter({ interaction });
                await reporter.update(`🔎 **Looking up:** ${md(album)} by ${md(artist)}`);

                const match = await musicbrainz.findAlbum(artist, album);
                if (!match) {
                    await reporter.finish(`❌ Couldn't find **${md(album)}** by **${md(artist)}** on MusicBrainz.`);
                    return;
                }
                await queueAlbum(state, reporter, {
                    artistName: match.artistName,
                    albumTitle: match.title,
                    releaseGroupId: match.releaseGroupId,
                    shuffle,
                    member: interaction.member,
                });
                return;
            }

            await interaction.deferReply(ephemeral({}));
            const result = await musicbrainz.getArtistAlbums(artist);
            if (!result.albums.length) {
                await safeEditReply(interaction, { content: `❌ Couldn't find any albums for **${md(artist)}**.` });
                return;
            }
            const entry = { artistName: result.artistName, albums: result.albums, shuffle };
            const key = albumSelection.remember(entry);
            await safeEditReply(interaction, buildAlbumMenu(key, entry, 0));
        },
    };
}

module.exports = [
    makeAlbumCommand({ name: 'play-album', description: 'Search and queue an entire album', shuffle: false }),
    makeAlbumCommand({ name: 'play-album-shuffle', description: 'Search and queue an entire album (shuffled)', shuffle: true }),
];
module.exports.buildAlbumMenu = buildAlbumMenu;
