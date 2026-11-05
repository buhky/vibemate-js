// Every slash command, keyed by name. Each module exports an array of
// { data: SlashCommandBuilder, execute(interaction) }.
const { InteractionContextType } = require('discord.js');

const modules = [
    require('./join'),
    require('./play'),
    require('./playlist'),
    require('./album'),
    require('./queue'),
    require('./jump'),
    require('./skip'),
    require('./control'),
    require('./clean'),
    require('./playlists'),
];

const commands = new Map();
for (const list of modules) {
    for (const command of list) {
        command.data.setContexts(InteractionContextType.Guild);
        commands.set(command.data.name, command);
    }
}

function toJSON() {
    return [...commands.values()].map(c => c.data.toJSON());
}

module.exports = { commands, toJSON };
