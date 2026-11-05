// Saved-playlist management: /clear-saved-playlists, /create-playlist,
// /my-playlists, /delete-playlist.
const { SlashCommandBuilder } = require('discord.js');
const { MAX_PLAYLIST_NAME_LENGTH } = require('../config');
const savedPlaylists = require('../storage/playlists');
const customPlaylists = require('../storage/customPlaylists');
const { replyEphemeral } = require('../ui/messages');
const { md } = require('../util');

module.exports = [
    {
        data: new SlashCommandBuilder()
            .setName('clear-saved-playlists')
            .setDescription('Clear all saved YouTube playlists'),

        async execute(interaction) {
            const ok = savedPlaylists.clear();
            await replyEphemeral(interaction, ok ? '✅ All saved playlists have been cleared.' : '❌ Failed to clear saved playlists.');
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('create-playlist')
            .setDescription('Create a new custom playlist')
            .addStringOption(option =>
                option.setName('name').setDescription('Name for your playlist').setRequired(true))
            .addBooleanOption(option =>
                option.setName('public').setDescription('Make playlist public (anyone can add songs)').setRequired(false)),

        async execute(interaction) {
            const name = interaction.options.getString('name').trim();
            const isPublic = interaction.options.getBoolean('public') || false;
            const userId = interaction.user.id;

            if (!name || name.length > MAX_PLAYLIST_NAME_LENGTH) {
                await replyEphemeral(interaction, `❌ Playlist names must be 1-${MAX_PLAYLIST_NAME_LENGTH} characters.`);
                return;
            }
            const existing = isPublic ? customPlaylists.get(name, 'public') : customPlaylists.get(name, userId);
            if (existing) {
                await replyEphemeral(interaction, `❌ A playlist named "${md(name)}" already exists.`);
                return;
            }
            if (!customPlaylists.create(name, userId, isPublic)) {
                await replyEphemeral(interaction, '❌ Failed to create playlist.');
                return;
            }
            await replyEphemeral(interaction, `✅ Created ${isPublic ? 'public' : 'personal'} playlist **"${md(name)}"**! Use the "➕ Add to Playlist" button to add songs.`);
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('my-playlists')
            .setDescription('List your custom playlists'),

        async execute(interaction) {
            const owned = customPlaylists.listOwned(interaction.user.id);
            if (owned.length === 0) {
                await replyEphemeral(interaction, "📭 You don't have any playlists yet. Use `/create-playlist` to create one!");
                return;
            }
            const lines = owned.map(p => `${p.isPublic ? '🌐' : '👤'} **${md(p.name)}** - ${p.songCount} songs`);
            await replyEphemeral(interaction, `**Your Playlists:**\n\n${lines.join('\n')}`);
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('delete-playlist')
            .setDescription('Delete one of your custom playlists')
            .addStringOption(option =>
                option.setName('name').setDescription('Name of the playlist to delete').setRequired(true).setAutocomplete(true)),

        async execute(interaction) {
            const name = interaction.options.getString('name');
            if (customPlaylists.remove(name, interaction.user.id)) {
                await replyEphemeral(interaction, `✅ Deleted playlist **"${md(name)}"**!`);
            } else {
                await replyEphemeral(interaction, '❌ Failed to delete playlist. Make sure you own the playlist and the name is correct.');
            }
        },
    },
];
