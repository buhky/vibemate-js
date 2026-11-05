const { SlashCommandBuilder } = require('discord.js');
const { getState } = require('../state');
const player = require('../player/player');
const { humansInBotChannel } = require('./_shared');
const { replyEphemeral, tempReply } = require('../ui/messages');

module.exports = [
    {
        data: new SlashCommandBuilder()
            .setName('skip')
            .setDescription('Skip the current song (the requester skips instantly, others vote)'),

        async execute(interaction) {
            const state = getState(interaction.guildId);
            const result = player.voteSkip(state, interaction.user.id, humansInBotChannel(interaction.guild));
            switch (result.result) {
                case 'nothing':
                    await replyEphemeral(interaction, '❌ Nothing is playing.');
                    break;
                case 'skipped':
                    await tempReply(interaction, '⏭️ **Skipped** the current song.', 5000);
                    break;
                case 'already':
                    await replyEphemeral(interaction, `🗳️ You already voted. ${result.votes}/${result.needed} votes to skip.`);
                    break;
                default:
                    await replyEphemeral(interaction, `🗳️ Vote counted: ${result.votes}/${result.needed} needed to skip.`);
            }
        },
    },
    {
        data: new SlashCommandBuilder()
            .setName('forceskip')
            .setDescription('Force skip the current song without votes'),

        async execute(interaction) {
            const state = getState(interaction.guildId);
            if (!player.skipCurrent(state)) {
                await replyEphemeral(interaction, '❌ Nothing is playing to skip.');
                return;
            }
            await tempReply(interaction, '⏭️ **Force skipped** the current song!', 5000);
        },
    },
];
