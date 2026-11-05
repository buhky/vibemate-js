// /clean: sweep messages from the current channel for a while, sparing the
// now-playing panel. Behaviour kept as before by request.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { allStates } = require('../state');
const { replyEphemeral, tempReply, autoDelete } = require('../ui/messages');
const { sleep } = require('../util');
const { error } = require('../logger');

function isPanelMessage(message) {
    return allStates().some(state => state.panelMessage?.id === message.id);
}

async function cleanupChannel(channel, durationMinutes) {
    const endTime = Date.now() + durationMinutes * 60_000;
    let deleted = 0;
    try {
        while (Date.now() < endTime) {
            const messages = await channel.messages.fetch({ limit: 50 });
            const targets = [...messages.values()].filter(m => !isPanelMessage(m)).slice(0, 10);
            for (const message of targets) {
                try {
                    await message.delete();
                    deleted++;
                } catch (err) {
                    error('CLEAN', 'Could not delete message:', err.message);
                }
                await sleep(500);
            }
            await sleep(10_000);
        }
        const done = await channel.send(`✅ **Cleanup completed!** Deleted ${deleted} messages over ${durationMinutes} minutes.`).catch(() => null);
        autoDelete(done, 10_000);
    } catch (err) {
        error('CLEAN', 'Cleanup task error:', err);
        await channel.send(`❌ **Cleanup failed:** ${err.message}`).catch(() => {});
    }
}

module.exports = [{
    data: new SlashCommandBuilder()
        .setName('clean')
        .setDescription('Clean up old messages in the current channel')
        .addIntegerOption(option =>
            option.setName('duration')
                .setDescription('How long to run cleanup (in minutes, max 60)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(60)),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            await replyEphemeral(interaction, "❌ You need 'Manage Messages' permission to use this command.");
            return;
        }
        const duration = Math.min(Math.max(interaction.options.getInteger('duration') || 5, 1), 60);
        await tempReply(interaction, `🧹 **Starting cleanup for ${duration} minutes...**\nDeleting up to 10 messages every 10 seconds.`, 10_000);
        cleanupChannel(interaction.channel, duration).catch(err => error('CLEAN', err));
    },
}];
