// Building queue items from the different sources: a single search/URL, a
// YouTube playlist, a saved custom playlist, or a MusicBrainz album.
const { ALBUM_SEARCH_BATCH } = require('../config');
const ytdlp = require('../services/ytdlp');
const musicbrainz = require('../services/musicbrainz');
const savedPlaylists = require('../storage/playlists');
const player = require('./player');
const { formatDuration, parseDuration, shuffleInPlace, sleep, isUrl, extractPlaylistId, md } = require('../util');
const { log, error } = require('../logger');

function requesterOf(member) {
    return {
        requesterName: member.displayName || member.user?.username || 'Unknown',
        requesterId: member.id || member.user?.id,
    };
}

function makeTrack(info, member, extra = {}) {
    return {
        url: info.url,
        title: info.title || 'Unknown title',
        thumbnail: info.thumbnail || null,
        durationSecs: info.durationSecs || 0,
        durationStr: formatDuration(info.durationSecs || 0),
        ...requesterOf(member),
        ...extra,
    };
}

// Resolve a search query or video URL to one track. Throws on failure with a
// user-facing message.
async function resolveTrack(query, member) {
    let info;
    if (isUrl(query)) {
        info = await ytdlp.getInfo(query);
    } else {
        info = await ytdlp.search(query);
        if (!info) throw new Error('Could not find that song. Try a different query.');
    }
    return makeTrack(info, member);
}

async function queueYouTubePlaylist(state, reporter, { url, shuffle, member }) {
    const playlistId = extractPlaylistId(url);
    const normalizedUrl = playlistId ? `https://www.youtube.com/playlist?list=${playlistId}` : url;

    const playlist = await ytdlp.getPlaylist(normalizedUrl).catch(err => {
        error('PLAYLIST', err.message);
        return null;
    });
    if (!playlist) {
        await reporter.finish('❌ Failed to read that playlist. Make sure the URL is a valid YouTube playlist.');
        return;
    }
    if (playlist.entries.length === 0) {
        await reporter.finish('❌ Playlist is empty.');
        return;
    }

    if (playlist.title !== 'Unknown Playlist') {
        savedPlaylists.add(playlist.title, normalizedUrl);
        log('PLAYLISTS', `Auto-saved playlist "${playlist.title}"`);
    }

    const entries = shuffle ? shuffleInPlace([...playlist.entries]) : playlist.entries;
    const items = entries.map(info => makeTrack(info, member, { playlistName: playlist.title }));
    player.addTracks(state, items);

    await reporter.finish(`✅ **Queued ${items.length} songs** from **${md(playlist.title)}**${shuffle ? ' (shuffled)' : ''}`);
    await player.startOrRefresh(state);
}

async function queueCustomPlaylist(state, reporter, { name, entry, shuffle, member }) {
    const songs = entry?.playlist?.songs || [];
    if (songs.length === 0) {
        await reporter.finish('❌ Playlist is empty.');
        return;
    }

    const ordered = shuffle ? shuffleInPlace([...songs]) : songs;
    const items = ordered
        .filter(song => song && song.url)
        .map(song => makeTrack({
            url: song.url,
            title: song.title,
            thumbnail: song.thumbnail,
            durationSecs: parseDuration(song.duration),
        }, member, { playlistName: name }));
    player.addTracks(state, items);

    await reporter.finish(`✅ **Queued ${items.length} songs** from **${md(name)}**${shuffle ? ' (shuffled)' : ''}`);
    await player.startOrRefresh(state);
}

// Look up the tracklist and cover for a release group, search each track on
// YouTube in small batches, and start playback as soon as a few are queued.
async function queueAlbum(state, reporter, { artistName, albumTitle, releaseGroupId, shuffle, member }) {
    await reporter.update(`🎵 **Getting tracklist for:** ${md(albumTitle)} by ${md(artistName)}${shuffle ? ' (shuffled)' : ''}`);

    const [coverArt, tracks] = await Promise.all([
        musicbrainz.getCoverArt(releaseGroupId),
        musicbrainz.getTracklist(releaseGroupId).catch(err => {
            error('MB', err.message);
            return [];
        }),
    ]);
    if (!tracks.length) {
        await reporter.finish(`❌ Couldn't find a tracklist for **${md(albumTitle)}** by **${md(artistName)}**`);
        return;
    }
    if (shuffle) shuffleInPlace(tracks);
    await reporter.update(`📝 **Found ${tracks.length} tracks!** Searching and queueing${shuffle ? ' (shuffled)' : ''}...`);

    let queued = 0;
    let started = false;
    for (let i = 0; i < tracks.length; i += ALBUM_SEARCH_BATCH) {
        const batch = tracks.slice(i, i + ALBUM_SEARCH_BATCH);
        const results = await Promise.all(batch.map(async track => {
            try {
                const info = await ytdlp.search(`${track} ${artistName}`);
                if (!info) {
                    log('ALBUM', `No result for track: ${track}`);
                    return null;
                }
                return makeTrack({ ...info, thumbnail: coverArt || info.thumbnail }, member, { albumName: albumTitle });
            } catch (err) {
                error('ALBUM', `Search failed for "${track}":`, err.message);
                return null;
            }
        }));

        const items = results.filter(Boolean);
        if (items.length) {
            player.addTracks(state, items);
            queued += items.length;
            if (!started && queued >= 3) {
                started = true;
                await player.startOrRefresh(state);
            } else if (started) {
                player.bufferAhead(state);
            }
        }
        if (i + ALBUM_SEARCH_BATCH < tracks.length) await sleep(500);
    }

    if (queued === 0) {
        await reporter.finish('❌ Failed to queue any tracks from that album.');
        return;
    }
    await reporter.finish(`✅ **Queued ${queued} tracks** from **${md(albumTitle)}**`);
    await player.startOrRefresh(state);
}

module.exports = { makeTrack, resolveTrack, queueYouTubePlaylist, queueCustomPlaylist, queueAlbum };
