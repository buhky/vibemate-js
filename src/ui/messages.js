// Helpers for replying to interactions without letting a deleted message or an
// expired interaction token break the command that was running.
const { MessageFlags } = require('discord.js');
const { warn } = require('../logger');

// Unknown Message, Unknown Interaction, Unknown Webhook, Invalid Webhook Token
const GONE_CODES = new Set([10008, 10062, 10015, 50027]);

function isGone(err) {
    return Boolean(err) && GONE_CODES.has(err.code);
}

function ephemeral(payload) {
    const body = typeof payload === 'string' ? { content: payload } : { ...payload };
    body.flags = (body.flags || 0) | MessageFlags.Ephemeral;
    return body;
}

function autoDelete(message, ms) {
    if (!message) return;
    setTimeout(() => message.delete().catch(() => {}), ms);
}

// Edit the deferred/initial reply; returns the message, or null if it is gone.
async function safeEditReply(interaction, payload) {
    try {
        return await interaction.editReply(payload);
    } catch (err) {
        if (isGone(err)) {
            warn('UI', 'Reply message is gone, skipping edit');
            return null;
        }
        throw err;
    }
}

// Reply (or edit the deferred reply) with a short notice that removes itself.
async function tempReply(interaction, payload, ms = 5000) {
    const body = typeof payload === 'string' ? { content: payload } : payload;
    let message = null;
    try {
        if (interaction.deferred || interaction.replied) {
            message = await interaction.editReply(body);
        } else {
            const response = await interaction.reply({ ...body, withResponse: true });
            message = response?.resource?.message || await interaction.fetchReply();
        }
    } catch (err) {
        if (!isGone(err)) throw err;
        return null;
    }
    autoDelete(message, ms);
    return message;
}

async function replyEphemeral(interaction, payload) {
    const body = ephemeral(payload);
    try {
        if (interaction.deferred || interaction.replied) return await interaction.editReply(body);
        return await interaction.reply(body);
    } catch (err) {
        if (isGone(err)) return null;
        throw err;
    }
}

// A progress reporter for long-running commands. It edits the interaction
// reply while that is possible and transparently falls back to a plain channel
// message once the reply is deleted or the 15-minute interaction token expires.
function createReporter({ interaction = null, message = null, channel = null }) {
    let msg = message;
    const target = channel || interaction?.channel || null;
    let interactionUsable = Boolean(interaction);

    async function update(payload) {
        const body = typeof payload === 'string' ? { content: payload } : payload;
        if (msg) {
            try {
                msg = await msg.edit(body);
                return msg;
            } catch (err) {
                if (!isGone(err)) throw err;
                msg = null;
            }
        }
        if (interactionUsable) {
            const edited = await safeEditReply(interaction, body);
            if (edited) return edited;
            interactionUsable = false;
        }
        if (target) {
            msg = await target.send(body).catch(() => null);
            return msg;
        }
        return null;
    }

    async function finish(payload, autoDeleteMs = 10_000) {
        const sent = await update(payload);
        if (sent && autoDeleteMs > 0) autoDelete(sent, autoDeleteMs);
        return sent;
    }

    return { update, finish, get channel() { return target; } };
}

module.exports = { isGone, ephemeral, autoDelete, safeEditReply, tempReply, replyEphemeral, createReporter };
