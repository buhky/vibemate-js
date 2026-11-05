// /play-playlist and /play-playlist-shuffle. The autocomplete offers saved
// YouTube playlists ("youtube:<url>") and custom playlists
// ("custom:<scope>:<name>"); a raw URL or a plain playlist name also works.
const { SlashCommandBuilder } = require('discord.js');
const { requireVoiceChannel, ensureConnected } = require('./_shared');
const { queueYouTubePlaylist, queueCustomPlaylist } = require('../player/sources');
const customPlaylists = require('../storage/customPlaylists');
const autosave = require('../storage/autosave');
const { createReporter } = require('../ui/messages');
const { isUrl, splitOnce, md } = require('../util');

// Turn the rolling autosave snapshot into something queueCustomPlaylist understands.
function autosaveAsPlaylist(guildId) {
    const snapshot = autosave.get(guildId);
    if (!snapshot) return null;
    const tracks = [snapshot.current, ...(snapshot.queue || [])].filter(Boolean);
    const songs = tracks.map(t => ({ url: t.url, title: t.title, thumbnail: t.thumbnail, duration: t.durationStr }));
    return { playlist: { songs }, savedAt: snapshot.savedAt };
}

function makePlaylistCommand({ name, description, shuffle }) {
    return {
        data: new SlashCommandBuilder()
            .setName(name)
            .setDescription(description)
            .addStringOption(option =>
                option.setName('url')
                    .setDescription('YouTube playlist URL or saved playlist name')
                    .setRequired(true)
                    .setAutocomplete(true)),

        async execute(interaction) {
            const voiceChannel = await requireVoiceChannel(interaction);
            if (!voiceChannel) return;
            await interaction.deferReply();

            const input = interaction.options.getString('url').trim();
            const state = await ensureConnected(interaction, voiceChannel);
            const reporter = createReporter({ interaction });
            const member = interaction.member;

            if (input === 'autosave:' || input.toLowerCase() === autosave.NAME.toLowerCase()) {
                const entry = autosaveAsPlaylist(interaction.guildId);
                if (!entry) {
                    await reporter.finish('❌ There is no saved queue for this server yet.');
                    return;
                }
                await reporter.update(`💾 **Restoring the last queue** (saved ${new Date(entry.savedAt).toUTCString()})...`);
                await queueCustomPlaylist(state, reporter, { name: autosave.NAME, entry, shuffle, member });
                return;
            }

            if (input.startsWith('custom:')) {
                const [scope, playlistName] = splitOnce(input.slice('custom:'.length), ':');
                const entry = customPlaylists.get(playlistName, scope);
                if (!entry) {
                    await reporter.finish(`❌ Playlist "${md(playlistName)}" not found.`);
                    return;
                }
                await reporter.update(`📝 **Queueing:** ${md(playlistName)}...`);
                await queueCustomPlaylist(state, reporter, { name: playlistName, entry, shuffle, member });
                return;
            }

            const url = input.startsWith('youtube:') ? input.slice('youtube:'.length) : input;
            if (isUrl(url)) {
                await reporter.update('📝 **Reading playlist...** This may take a moment.');
                await queueYouTubePlaylist(state, reporter, { url, shuffle, member });
                return;
            }

            // Not a URL: treat it as a custom playlist name typed by hand.
            const entry = customPlaylists.findByName(input, interaction.user.id);
            if (!entry) {
                await reporter.finish(`❌ "${md(input)}" is neither a YouTube playlist URL nor a saved playlist name.`);
                return;
            }
            await reporter.update(`📝 **Queueing:** ${md(input)}...`);
            await queueCustomPlaylist(state, reporter, { name: input, entry, shuffle, member });
        },
    };
}

module.exports = [
    makePlaylistCommand({ name: 'play-playlist', description: 'Queue a YouTube playlist, a saved playlist, or the last queue', shuffle: false }),
    makePlaylistCommand({ name: 'play-playlist-shuffle', description: 'Queue a YouTube playlist, a saved playlist, or the last queue (shuffled)', shuffle: true }),
];
