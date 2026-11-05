const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ACCENT_COLOR, QUEUE_PAGE_SIZE } = require('../config');
const { getState } = require('../state');
const { replyEphemeral, ephemeral } = require('../ui/messages');
const { md, truncate } = require('../util');

function buildQueuePage(state, page = 0) {
    const queue = state.queue;
    const totalPages = Math.max(1, Math.ceil(queue.length / QUEUE_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const start = safePage * QUEUE_PAGE_SIZE;
    const items = queue.slice(start, start + QUEUE_PAGE_SIZE);

    const lines = items.map((item, i) =>
        `**${start + i + 1}.** ${md(truncate(item.title, 80))} — *${md(item.requesterName)}*`);
    if (state.current) lines.unshift(`▶️ **Now:** ${md(truncate(state.current.title, 80))}\n`);

    const embed = new EmbedBuilder()
        .setTitle(`📋 Queue (${queue.length} song${queue.length === 1 ? '' : 's'})`)
        .setDescription(lines.join('\n') || 'Queue is empty.')
        .setColor(ACCENT_COLOR)
        .setFooter({ text: `Page ${safePage + 1}/${totalPages}` });

    const components = [];
    if (totalPages > 1) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`queue_page:${safePage - 1}`).setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
            new ButtonBuilder().setCustomId(`queue_page:${safePage + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1),
        ));
    }
    return { embeds: [embed], components };
}

module.exports = [{
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show the current queue'),

    async execute(interaction) {
        const state = getState(interaction.guildId);
        if (state.queue.length === 0 && !state.current) {
            await replyEphemeral(interaction, '📭 Queue is empty!');
            return;
        }
        await interaction.reply(ephemeral(buildQueuePage(state, 0)));
    },
}];
module.exports.buildQueuePage = buildQueuePage;
