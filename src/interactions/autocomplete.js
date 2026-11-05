const savedPlaylists = require('../storage/playlists');
const customPlaylists = require('../storage/customPlaylists');
const autosave = require('../storage/autosave');
const { truncate } = require('../util');

const MAX_VALUE = 100;

function autosaveChoice(query, guildId) {
    if (!autosave.NAME.toLowerCase().includes(query)) return null;
    const snapshot = autosave.get(guildId);
    if (!snapshot) return null;
    const count = (snapshot.queue?.length || 0) + (snapshot.current ? 1 : 0);
    const when = new Date(snapshot.savedAt).toISOString().slice(0, 16).replace('T', ' ');
    return { name: `💾 ${autosave.NAME} (${count} songs, auto-saved ${when} UTC)`, value: 'autosave:' };
}

function playlistChoices(query, userId, guildId) {
    const matches = [];

    for (const [name, url] of Object.entries(savedPlaylists.load())) {
        if (!name.toLowerCase().includes(query) && !url.toLowerCase().includes(query)) continue;
        matches.push({ name: truncate(`📺 ${name}`, 100), value: `youtube:${url}` });
    }

    for (const playlist of customPlaylists.listAll(userId)) {
        if (!playlist.name.toLowerCase().includes(query)) continue;
        const prefix = playlist.isPublic ? '🌐' : (playlist.ownerId === userId ? '👤' : '🔒');
        matches.push({
            name: truncate(`${prefix} ${playlist.name} (${playlist.songCount} songs)`, 100),
            value: `custom:${playlist.scope}:${playlist.name}`,
        });
    }

    const sorted = matches
        .filter(m => m.value.length <= MAX_VALUE)
        .sort((a, b) => a.name.localeCompare(b.name));
    const last = autosaveChoice(query, guildId);
    if (last) sorted.unshift(last);
    return sorted.slice(0, 25);
}

function deleteChoices(query, userId) {
    return customPlaylists.listOwned(userId)
        .filter(p => p.name.toLowerCase().includes(query))
        .map(p => ({
            name: truncate(`${p.isPublic ? '🌐' : '👤'} ${p.name} (${p.songCount} songs)`, 100),
            value: p.name,
        }))
        .filter(m => m.value.length <= MAX_VALUE)
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 25);
}

async function handle(interaction) {
    const focused = interaction.options.getFocused(true);
    const query = String(focused.value || '').toLowerCase();
    const userId = interaction.user.id;

    if (focused.name === 'url' && (interaction.commandName === 'play-playlist' || interaction.commandName === 'play-playlist-shuffle')) {
        await interaction.respond(playlistChoices(query, userId, interaction.guildId));
        return;
    }
    if (focused.name === 'name' && interaction.commandName === 'delete-playlist') {
        await interaction.respond(deleteChoices(query, userId));
        return;
    }
    await interaction.respond([]);
}

module.exports = { handle };
