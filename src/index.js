// VibeMate entry point: Discord client, command registration, interaction
// dispatch, and process lifecycle.
const { Client, GatewayIntentBits, Events, REST, Routes } = require('discord.js');
const { TOKEN, GUILD_IDS } = require('./config');
const { commands, toJSON } = require('./commands');
const autocomplete = require('./interactions/autocomplete');
const buttons = require('./interactions/buttons');
const selects = require('./interactions/selects');
const modals = require('./interactions/modals');
const player = require('./player/player');
const ytdlp = require('./services/ytdlp');
const { replyEphemeral, safeEditReply, ephemeral } = require('./ui/messages');
const { log, warn, error } = require('./logger');

if (!TOKEN) {
    error('BOOT', 'DISCORD_TOKEN is not set. Put it in .env (see .env.example) or the environment.');
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

async function registerCommands() {
    const body = toJSON();
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        if (GUILD_IDS.length > 0) {
            for (const guildId of GUILD_IDS) {
                await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body });
            }
            log('BOOT', `Registered ${body.length} commands to ${GUILD_IDS.length} guild(s)`);
        } else {
            await rest.put(Routes.applicationCommands(client.user.id), { body });
            log('BOOT', `Registered ${body.length} commands globally`);
        }
    } catch (err) {
        error('BOOT', 'Could not register commands:', err);
    }
}

async function dispatch(interaction) {
    if (interaction.isAutocomplete()) return autocomplete.handle(interaction);
    if (!interaction.inGuild()) {
        if (interaction.isRepliable()) await replyEphemeral(interaction, 'This bot only works inside a server.');
        return;
    }
    if (interaction.isChatInputCommand()) {
        const command = commands.get(interaction.commandName);
        if (!command) {
            await replyEphemeral(interaction, '⚠️ Unknown command.');
            return;
        }
        return command.execute(interaction);
    }
    if (interaction.isButton()) return buttons.handle(interaction);
    if (interaction.isStringSelectMenu()) return selects.handle(interaction);
    if (interaction.isModalSubmit()) return modals.handle(interaction);
}

async function reportError(interaction, err) {
    error('COMMAND', `${interaction.commandName || interaction.customId || 'interaction'} failed:`, err);
    if (interaction.isAutocomplete()) return;
    const content = '⚠️ An error occurred. Please try again.';
    try {
        if (interaction.isMessageComponent() && (interaction.deferred || interaction.replied)) {
            // Never overwrite the panel the button lives on; whisper to the clicker instead.
            await interaction.followUp(ephemeral(content));
        } else if (interaction.deferred || interaction.replied) {
            await safeEditReply(interaction, { content });
        } else {
            await replyEphemeral(interaction, content);
        }
    } catch (replyErr) {
        error('COMMAND', 'Could not send error response:', replyErr.message);
    }
}

client.once(Events.ClientReady, async () => {
    log('BOOT', `Bot ready! Logged in as ${client.user.tag}`);
    player.cleanupAllTmp();
    try {
        log('BOOT', `yt-dlp version ${await ytdlp.version()}`);
    } catch (err) {
        warn('BOOT', 'yt-dlp not found or not working:', err.message);
    }
    await registerCommands();
});

client.on(Events.InteractionCreate, async interaction => {
    try {
        await dispatch(interaction);
    } catch (err) {
        await reportError(interaction, err);
    }
});

client.on(Events.Error, err => error('CLIENT', err));
client.on(Events.Warn, msg => warn('CLIENT', msg));

process.on('unhandledRejection', err => error('PROCESS', 'Unhandled rejection:', err));
process.on('uncaughtException', err => {
    error('PROCESS', 'Uncaught exception:', err);
});

let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log('PROCESS', `${signal} received, shutting down`);
    try {
        player.shutdownAll();
    } catch (err) {
        error('PROCESS', 'Error during shutdown:', err.message);
    }
    client.destroy();
    setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

client.login(TOKEN).catch(err => {
    error('BOOT', 'Login failed:', err.message);
    process.exit(1);
});
