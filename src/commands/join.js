const { SlashCommandBuilder } = require('discord.js');
const { requireVoiceChannel, ensureConnected } = require('./_shared');
const { tempReply } = require('../ui/messages');
const { md } = require('../util');

module.exports = [{
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription("Join the voice channel you're currently in"),

    async execute(interaction) {
        const voiceChannel = await requireVoiceChannel(interaction);
        if (!voiceChannel) return;
        await interaction.deferReply();
        await ensureConnected(interaction, voiceChannel);
        await tempReply(interaction, `✅ Joined **${md(voiceChannel.name)}**!`, 5000);
    },
}];
