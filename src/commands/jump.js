const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { ACCENT_COLOR } = require('../config');
const { getState } = require('../state');
const { getActiveConnection } = require('../voice/connection');
const { replyEphemeral, ephemeral } = require('../ui/messages');
const { truncate } = require('../util');

const PAGE_SIZE = 25;

function buildJumpMenu(state, page = 0) {
    const queue = state.queue;
    const totalPages = Math.max(1, Math.ceil(queue.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const start = safePage * PAGE_SIZE;

    const menu = new StringSelectMenuBuilder()
        .setCustomId('jump_select')
        .setPlaceholder(`Select a song to jump to (Page ${safePage + 1}/${totalPages})`);

    queue.slice(start, start + PAGE_SIZE).forEach((item, i) => {
        const index = start + i;
        menu.addOptions({
            label: truncate(`${index + 1}. ${item.title}`, 100),
            description: truncate(item.requesterName ? `by ${item.requesterName}` : '', 100) || undefined,
            value: String(index),
        });
    });

    const components = [new ActionRowBuilder().addComponents(menu)];
    if (totalPages > 1) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`jump_page:${safePage - 1}`).setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
            new ButtonBuilder().setCustomId(`jump_page:${safePage + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1),
        ));
    }

    const embed = new EmbedBuilder()
        .setTitle('⏭️ Jump to Song')
        .setDescription('Select a song from the queue to jump to. The queue will continue from that song.')
        .setColor(ACCENT_COLOR);

    return { embeds: [embed], components };
}

module.exports = [{
    data: new SlashCommandBuilder()
        .setName('jump')
        .setDescription('Jump to a specific song in the queue'),

    async execute(interaction) {
        const state = getState(interaction.guildId);
        if (state.queue.length === 0) {
            await replyEphemeral(interaction, '📭 Queue is empty! Nothing to jump to.');
            return;
        }
        if (!getActiveConnection(interaction.guildId)) {
            await replyEphemeral(interaction, "❌ I'm not connected to a voice channel. Use `/join` first.");
            return;
        }
        await interaction.reply(ephemeral(buildJumpMenu(state, 0)));
    },
}];
module.exports.buildJumpMenu = buildJumpMenu;
