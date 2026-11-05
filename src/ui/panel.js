// The "Now Playing" panel: one builder for the embed and both button rows, and
// one refresh function that edits the existing panel or posts a new one.
//
// Refreshes are coalesced: while an edit is in flight, further requests are
// folded into a single follow-up edit. Discord clients can render rapid
// back-to-back edits of the same message out of order, so fewer edits is safer.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { AudioPlayerStatus } = require('@discordjs/voice');
const { EMBED_COLOR, BOT_LOGO_URL } = require('../config');
const { md, truncate, formatDuration } = require('../util');
const { isGone, autoDelete } = require('./messages');
const { log, error } = require('../logger');

const NBSP = ' ';
const MIN_TITLE_WIDTH = 70;     // pad short titles so the embed keeps a steady width
const FOOTER_PAD = NBSP.repeat(80);
const MAX_TITLE = 400;

const chains = new WeakMap();   // state -> promise chain so message operations land in order
const inFlight = new WeakMap(); // state -> running refresh
const queued = new WeakSet();   // states with a refresh waiting behind the running one

function padTitle(text) {
    return text + NBSP.repeat(Math.max(5, MIN_TITLE_WIDTH - text.length));
}

function panelTitle(track) {
    if (track.playlistName) return `Now Playing - ${track.playlistName}`;
    if (track.albumName) return `Now Playing: ${track.albumName} (Album)`;
    return 'Now Playing';
}

function describeButtons(message) {
    return (message?.components || [])
        .map(row => (row.components || []).map(b => `${b.label || b.customId || 'link'}${b.disabled ? '[off]' : ''}`).join(' | '))
        .join(' // ');
}

function buildPanel(state) {
    const track = state.current;
    const next = state.queue[0];
    const isPaused = state.player?.state.status === AudioPlayerStatus.Paused;

    const embed = new EmbedBuilder()
        .setTitle(panelTitle(track))
        .setDescription(`**${padTitle(md(truncate(track.title, MAX_TITLE)))}**`)
        .setColor(EMBED_COLOR)
        .setAuthor(BOT_LOGO_URL
            ? { name: `VibeMate${NBSP.repeat(60)}`, iconURL: BOT_LOGO_URL }
            : { name: `VibeMate${NBSP.repeat(60)}` })
        .addFields(
            { name: 'Duration', value: track.durationStr || formatDuration(track.durationSecs), inline: true },
            { name: 'Requested by', value: `${md(track.requesterName)}${NBSP}`, inline: true },
            { name: 'Next Up', value: next ? `**${padTitle(md(truncate(next.title, MAX_TITLE)))}**` : '—\n\n', inline: false },
        )
        .setFooter({ text: FOOTER_PAD });

    if (state.skipVotes.size > 0 && state.votesNeeded > 0) {
        embed.addFields({ name: 'Votes', value: `${state.skipVotes.size}/${state.votesNeeded} voted to skip`, inline: false });
    }
    if (track.thumbnail) embed.setThumbnail(track.thumbnail);
    if (track.url) embed.setURL(track.url);

    const controls = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('previous').setLabel('⏮️ Prev').setStyle(ButtonStyle.Secondary).setDisabled(state.history.length === 0),
        new ButtonBuilder().setCustomId('seek-backward').setLabel('⏪').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('toggle').setLabel(isPaused ? '▶️' : '⏸️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('seek-forward').setLabel('⏩').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('skip').setLabel('Skip ⏭️').setStyle(ButtonStyle.Secondary),
    );

    const extras = new ActionRowBuilder();
    if (track.url) extras.addComponents(new ButtonBuilder().setLabel('Open').setStyle(ButtonStyle.Link).setURL(track.url));
    extras.addComponents(
        new ButtonBuilder().setCustomId('shuffle').setLabel('🔀 Shuffle').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('add-to-playlist').setLabel('➕ Add to Playlist').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('save-queue').setLabel('💾 Save Queue').setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [controls, extras] };
}

function serialized(state, work) {
    const previous = chains.get(state) || Promise.resolve();
    const run = previous.then(work, work);
    chains.set(state, run.catch(() => {}));
    return run;
}

async function applyPanel(state) {
    if (!state.current) return;
    const payload = buildPanel(state);

    if (state.panelMessage) {
        try {
            state.panelMessage = await state.panelMessage.edit(payload);
            log('PANEL', `Edited: ${describeButtons(state.panelMessage)}`);
            return;
        } catch (err) {
            if (!isGone(err)) {
                error('PANEL', 'Could not edit panel:', err.message);
                return;
            }
            state.panelMessage = null;
        }
    }
    if (!state.textChannel) return;
    try {
        state.panelMessage = await state.textChannel.send(payload);
        log('PANEL', `Posted: ${describeButtons(state.panelMessage)}`);
    } catch (err) {
        error('PANEL', 'Could not post panel:', err.message);
    }
}

// Bring the panel up to date. Concurrent calls collapse into at most one
// follow-up edit after the current one finishes.
function refresh(state) {
    if (inFlight.has(state)) {
        queued.add(state);
        return inFlight.get(state);
    }
    const run = (async () => {
        do {
            queued.delete(state);
            await serialized(state, () => applyPanel(state));
        } while (queued.has(state));
    })().finally(() => {
        inFlight.delete(state);
        if (queued.has(state)) refresh(state).catch(() => {});
    });
    inFlight.set(state, run);
    return run;
}

function remove(state) {
    return serialized(state, async () => {
        const msg = state.panelMessage;
        state.panelMessage = null;
        if (msg) await msg.delete().catch(() => {});
    });
}

// Turn the panel into a short "finished" notice that removes itself. The
// panel reference is cleared immediately so a new track gets a fresh panel.
function showFinished(state) {
    return serialized(state, async () => {
        const msg = state.panelMessage;
        state.panelMessage = null;
        if (!msg) return;
        const embed = new EmbedBuilder()
            .setTitle('🎵 Queue Finished')
            .setDescription('All songs have been played! Use `/play-music` to add more.')
            .setColor(EMBED_COLOR);
        try {
            await msg.edit({ embeds: [embed], components: [] });
            autoDelete(msg, 5000);
        } catch (err) {
            if (!isGone(err)) error('PANEL', 'Could not show finished notice:', err.message);
        }
    });
}

module.exports = { buildPanel, refresh, remove, showFinished };
