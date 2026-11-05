// Loads every module (without logging in to Discord) so a typo or a missing
// require fails here instead of at runtime. Run with: npm run check
const path = require('path');

process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'check-only';

const modules = [
    'config', 'logger', 'util', 'state',
    'storage/jsonFile', 'storage/playlists', 'storage/customPlaylists', 'storage/autosave',
    'services/ytdlp', 'services/musicbrainz',
    'voice/connection',
    'ui/messages', 'ui/panel',
    'player/player', 'player/sources',
    'commands/index',
    'interactions/albumSelection', 'interactions/autocomplete', 'interactions/buttons', 'interactions/selects', 'interactions/modals',
];

for (const name of modules) {
    require(path.join(__dirname, '..', 'src', name));
}

const { commands, toJSON } = require('../src/commands');
const payload = toJSON();
console.log(`OK: ${modules.length} modules loaded, ${commands.size} commands:`);
console.log(payload.map(c => `  /${c.name}`).join('\n'));
