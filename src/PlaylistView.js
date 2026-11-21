import React, { useState, useEffect, useCallback, useRef } from 'react';
import TrackRow from './TrackRow';
import { AddSongsPanel, SortPanel, DuplicatesPanel, StatsPanel, MorePanel, SmartShufflePanel, TAGS } from './PlaylistPanels';
import { SORTS, broadGenre, formatDuration, matchesSearch, moveNextTo, moveToPosition, slownessScore, smartShuffle, sortItems } from './playlistTools';
import { appendUris, fetchAllPlaylistItems, isEditable, syncPlaylist, withUid } from './spotifySync';

const MAX_UNDO = 20;

const describeError = (error) => {
  if (error.status === 403) {
    return "Spotify didn't allow that change. Try logging out and back in so the app can edit your playlists.";
  }
  if (error.status === 404) {
    return "Spotify couldn't find that playlist. It may have been deleted.";
  }
  return 'Something went wrong talking to Spotify. Please try again.';
};

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const uriList = (items) => items.map((item) => item.track?.uri).join('|');
const sameOrder = (a, b) => a.length === b.length && a.every((item, index) => item.uid === b[index].uid);

const PlaylistView = ({ playlist, playlists, userId, callSpotify, onBack, onOpenPlaylist, onPlaylistsChanged }) => {
  const [tracks, setTracks] = useState(null);  // null while loading
  const [history, setHistory] = useState([]);  // Earlier track lists, for undo
  const [progress, setProgress] = useState(null);  // { done, total } while saving
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);  // { message, playlistId? }
  const [search, setSearch] = useState('');
  const [selectedUids, setSelectedUids] = useState([]);
  const [panel, setPanel] = useState(null);
  const [moveForm, setMoveForm] = useState({ from: '', to: '' });
  const [copyTargetId, setCopyTargetId] = useState('');
  const [dropTarget, setDropTarget] = useState(null);  // { uid, after } while dragging
  const dragUidsRef = useRef([]);
  // Song tempos for smart shuffle: 'idle', 'loading', 'available' or 'unavailable'
  const [tempo, setTempo] = useState('idle');
  const slownessRef = useRef(new Map());  // Spotify track id -> slowness score
  const [genres, setGenres] = useState({ status: 'idle', list: [] });  // list: [[genre, song count], ...]
  const genreRef = useRef(new Map());  // Spotify track id -> broad genre
  const tagsKey = `shuffleTags:${playlist.id}`;
  // Smart shuffle tags, by song link: { [uri]: { pin, opening, ending, priority, slow, favorite: count, together: group, apart: group } }
  const [tags, setTags] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem(tagsKey)) || {};
    } catch (storageError) {
      return {};
    }
  });

  const busy = progress !== null;
  // Spotify only lets you change playlists you own or that are collaborative
  const canEdit = playlist.owner?.id === userId || playlist.collaborative;
  const cover = playlist.images?.[0]?.url;
  const copyTargets = playlists.filter(
    (other) => other.id !== playlist.id && (other.owner?.id === userId || other.collaborative)
  );

  const loadTracks = useCallback(() => fetchAllPlaylistItems(callSpotify, playlist.id), [callSpotify, playlist.id]);

  useEffect(() => {
    let cancelled = false;
    loadTracks()
      .then((items) => !cancelled && setTracks(items))
      .catch((loadError) => {
        console.error('Error loading tracks:', loadError);
        if (!cancelled) {
          setTracks([]);
          setError(describeError(loadError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadTracks]);

  // Shows progress and errors for any task that talks to Spotify
  const run = async (task) => {
    if (busy) {
      return;
    }
    setProgress({ done: 0, total: 0 });
    setError('');
    setNotice(null);
    try {
      await task();
    } catch (taskError) {
      console.error('Error saving to Spotify:', taskError);
      setError(describeError(taskError));
    } finally {
      setProgress(null);
    }
  };

  // Makes `target` the new track list, here and on Spotify
  const saveChange = async (target, message, { undoing = false } = {}) => {
    const previous = tracks;
    setTracks(target);  // Show the result straight away while Spotify catches up
    let steps;
    try {
      steps = await syncPlaylist(callSpotify, playlist.id, previous, target, (done, total) => setProgress({ done, total }));
    } catch (syncError) {
      // Spotify may have made only some of the changes, so show what it really has now
      setTracks(await loadTracks().catch(() => previous));
      setHistory([]);
      throw syncError;
    }
    setHistory((current) => (undoing ? current.slice(0, -1) : [...current.slice(-(MAX_UNDO - 1)), previous]));
    setNotice({ message });
    onPlaylistsChanged();

    // After bigger changes, double-check Spotify ended up with exactly what we expect
    if (steps > 1) {
      const fresh = await loadTracks();
      if (uriList(fresh) !== uriList(target)) {
        setTracks(fresh);
        setHistory([]);
        setError('The playlist changed on Spotify while saving, so it has been reloaded.');
      }
    }
  };

  const applyChange = (target, message, options) => run(() => saveChange(target, message, options));

  const nameOf = (uid) => tracks.find((item) => item.uid === uid)?.track?.name || 'Song';

  const moveTracks = (uids, position) => {
    const target = moveToPosition(tracks, uids, position);
    if (sameOrder(target, tracks)) {
      return;
    }
    const spot = target.findIndex((item) => item.uid === uids[0]) + 1;
    applyChange(target, uids.length === 1 ? `Moved "${nameOf(uids[0])}" to spot ${spot}.` : `Moved ${uids.length} songs to spot ${spot}.`);
  };

  const removeTracks = (uids) => {
    const removable = tracks.filter((item) => uids.includes(item.uid) && isEditable(item));
    if (!removable.length) {
      setError("Local files can't be removed through Spotify's API.");
      return;
    }
    const removableUids = removable.map((item) => item.uid);
    setSelectedUids((current) => current.filter((uid) => !removableUids.includes(uid)));
    applyChange(
      tracks.filter((item) => !removableUids.includes(item.uid)),
      removable.length === 1 ? `Removed "${removable[0].track.name}".` : `Removed ${removable.length} songs.`
    );
  };

  const addTrack = (track) => {
    applyChange([...tracks, withUid({ track, added_at: new Date().toISOString() })], `Added "${track.name}" at spot ${tracks.length + 1}.`);
  };

  const sortTracks = (sortKey) => {
    applyChange(sortItems(tracks, sortKey), `Sorted by ${SORTS[sortKey].label.toLowerCase()}.`);
  };

  // Asks Spotify for tempo and energy the first time the smart shuffle panel opens.
  // Spotify stopped sharing these with apps created after November 2024, so this often fails.
  useEffect(() => {
    if (panel !== 'smart' || tempo !== 'idle' || !tracks) {
      return;
    }
    setTempo('loading');
    const ids = [...new Set(tracks.filter(isEditable).map((item) => item.track.id).filter(Boolean))];
    (async () => {
      for (let i = 0; i < ids.length; i += 100) {
        const response = await callSpotify((api) => api.getAudioFeaturesForTracks(ids.slice(i, i + 100)));
        response.audio_features.filter(Boolean).forEach((features) => slownessRef.current.set(features.id, slownessScore(features)));
      }
    })()
      .then(() => setTempo(slownessRef.current.size ? 'available' : 'unavailable'))
      .catch(() => setTempo('unavailable'));
  }, [panel, tempo, tracks, callSpotify]);

  // Looks up genres the first time the smart shuffle panel opens. Spotify gives genres to
  // artists, not songs, so each song gets its main artist's genre.
  useEffect(() => {
    if (panel !== 'smart' || genres.status !== 'idle' || !tracks) {
      return;
    }
    setGenres({ status: 'loading', list: [] });
    const artistIds = [...new Set(tracks.map((item) => item.track?.artists?.[0]?.id).filter(Boolean))];
    const genresOfArtist = new Map();
    (async () => {
      try {
        for (let i = 0; i < artistIds.length; i += 50) {
          const response = await callSpotify((api) => api.getArtists(artistIds.slice(i, i + 50)));
          response.artists.filter(Boolean).forEach((artist) => genresOfArtist.set(artist.id, artist.genres));
        }
      } catch (batchError) {
        // Some apps can't ask for many artists at once, so try them one by one
        for (const id of artistIds.slice(0, 200)) {
          const artist = await callSpotify((api) => api.getArtist(id));
          genresOfArtist.set(artist.id, artist.genres);
        }
      }
    })()
      .then(() => {
        genreRef.current = new Map(tracks.map((item) => [item.track?.id, broadGenre(genresOfArtist.get(item.track?.artists?.[0]?.id))]));
        const counts = new Map();
        genreRef.current.forEach((genre) => genre && counts.set(genre, (counts.get(genre) || 0) + 1));
        const list = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        setGenres({ status: list.length ? 'available' : 'unavailable', list });
      })
      .catch(() => setGenres({ status: 'unavailable', list: [] }));
  }, [panel, genres.status, tracks, callSpotify]);

  const saveTags = (next) => {
    setTags(next);
    try {
      window.localStorage.setItem(tagsKey, JSON.stringify(next));
    } catch (storageError) {
      // Tags still work for this visit if the browser won't save them
    }
  };

  // Tags are stored by song (its Spotify link), so they survive reloads and reshuffles
  const tagSelected = (kind, value) => {
    const uris = [...new Set(tracks.filter((item) => selectedUids.includes(item.uid) && item.track?.uri).map((item) => item.track.uri))];
    const next = { ...tags };
    let groupNumber = 1;
    if (kind === 'together' || kind === 'apart') {
      groupNumber = 1 + Math.max(0, ...Object.values(tags).map((songTags) => songTags[kind] || 0));
    }
    uris.forEach((uri) => {
      next[uri] = { ...next[uri], [kind]: kind === 'favorite' ? value : kind === 'together' || kind === 'apart' ? groupNumber : true };
    });
    saveTags(next);
    setNotice({ message: `Tagged ${plural(uris.length, 'song')} ${TAGS[kind].button}${kind === 'favorite' ? ` ×${value}` : ''}.` });
  };

  const clearSelectedTags = () => {
    const next = { ...tags };
    tracks.filter((item) => selectedUids.includes(item.uid)).forEach((item) => delete next[item.track?.uri]);
    saveTags(next);
  };

  const tagCounts = Object.fromEntries(Object.keys(TAGS).map((kind) => [kind, 0]));
  Object.values(tags).forEach((songTags) => Object.keys(songTags).forEach((kind) => {
    if (songTags[kind] && kind in tagCounts) {
      tagCounts[kind] += 1;
    }
  }));

  const smartShuffleTracks = ({ slowLast, ...rules }) => {
    const tagOf = (item) => tags[item.track?.uri] || {};
    const uidsTagged = (kind) => tracks.filter((item) => tagOf(item)[kind]).map((item) => item.uid);
    const groups = (kind) => {
      const byNumber = new Map();
      tracks.forEach((item) => {
        const number = tagOf(item)[kind];
        if (number) {
          byNumber.set(number, [...(byNumber.get(number) || []), item.uid]);
        }
      });
      return [...byNumber.values()].filter((group) => group.length > 1);
    };
    let slowness = {};
    if (slowLast && tempo === 'available') {
      slowness = { slowScores: new Map(tracks.map((item) => [item.uid, slownessRef.current.get(item.track?.id) || 0])) };
    } else if (slowLast) {
      slowness = { slowUids: new Set(uidsTagged('slow')) };
    }
    const favorites = new Map(Object.entries(tags).filter(([, songTags]) => songTags.favorite > 1).map(([uri, songTags]) => [uri, songTags.favorite]));

    const { items, artistRepeats, genreRepeats, notes } = smartShuffle(tracks, {
      ...rules,
      ...slowness,
      genreOf: genres.status === 'available' ? genreRef.current : null,
      pinnedUids: uidsTagged('pin'),
      openingUids: uidsTagged('opening'),
      endingUids: uidsTagged('ending'),
      priorityUids: uidsTagged('priority'),
      togetherGroups: groups('together'),
      apartGroups: groups('apart'),
      favorites,
    });
    const extra = [...notes];
    if (rules.noRepeatArtists && artistRepeats) {
      extra.push(`${plural(artistRepeats, 'artist repeat')} couldn't be avoided (too many songs by one artist).`);
    }
    if (genreRepeats) {
      extra.push(`${plural(genreRepeats, 'genre repeat')} couldn't be avoided.`);
    }
    applyChange(items, ['Shuffled with your rules.', ...extra].join(' '));
  };

  const undo = () => applyChange(history[history.length - 1], 'Undid your last change.', { undoing: true });

  // Copies the selected songs to another playlist, and optionally takes them out of this one
  const copySelected = (alsoRemove) => {
    const destination = copyTargets.find((other) => other.id === copyTargetId);
    const chosen = tracks.filter((item) => selectedUids.includes(item.uid) && isEditable(item));
    if (!destination || !chosen.length) {
      return;
    }
    run(async () => {
      await appendUris(callSpotify, destination.id, chosen.map((item) => item.track.uri));
      const summary = `${plural(chosen.length, 'song')} ${alsoRemove ? 'moved' : 'copied'} to "${destination.name}".`;
      if (alsoRemove) {
        const chosenUids = chosen.map((item) => item.uid);
        setSelectedUids([]);
        await saveChange(tracks.filter((item) => !chosenUids.includes(item.uid)), summary);
      } else {
        setNotice({ message: summary, playlistId: destination.id });
        onPlaylistsChanged();
      }
    });
  };

  const mergeIn = (sourceId, skipExisting) => {
    const source = playlists.find((other) => other.id === sourceId);
    run(async () => {
      const existing = new Set(tracks.map((item) => item.track?.uri));
      const incoming = (await fetchAllPlaylistItems(callSpotify, sourceId))
        .filter(isEditable)
        .filter((item) => !skipExisting || !existing.has(item.track.uri));
      if (!incoming.length) {
        setNotice({ message: `Every song from "${source.name}" is already here.` });
        return;
      }
      await saveChange([...tracks, ...incoming], `Added ${plural(incoming.length, 'song')} from "${source.name}".`);
    });
  };

  const duplicatePlaylist = () => {
    run(async () => {
      const copy = await callSpotify((api) => api.createPlaylist(userId, {
        name: `${playlist.name} (copy)`,
        description: `Copy of ${playlist.name}`,
        public: false,
      }));
      const uris = tracks.filter(isEditable).map((item) => item.track.uri);
      await appendUris(callSpotify, copy.id, uris);
      onPlaylistsChanged();
      setNotice({ message: `Made "${copy.name}" with ${plural(uris.length, 'song')}.`, playlistId: copy.id });
    });
  };

  const handleMoveForm = (event) => {
    event.preventDefault();
    const from = Number(moveForm.from);
    const to = Number(moveForm.to);
    const valid = (value) => Number.isInteger(value) && value >= 1 && value <= tracks.length;
    if (!valid(from) || !valid(to)) {
      setError(`Song and spot numbers need to be between 1 and ${tracks.length}.`);
      return;
    }
    moveTracks([tracks[from - 1].uid], to);
    setMoveForm({ from: '', to: '' });
  };

  const toggleSelected = (uid) =>
    setSelectedUids((current) => (current.includes(uid) ? current.filter((other) => other !== uid) : [...current, uid]));

  // Whether the pointer is over the bottom half of a row, i.e. the drop goes after it
  const isAfter = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientY > box.top + box.height / 2;
  };

  const dragHandlersFor = (item) => ({
    onDragStart: (event) => {
      // Dragging a selected song moves every selected song with it
      dragUidsRef.current = selectedUids.includes(item.uid)
        ? tracks.filter((other) => selectedUids.includes(other.uid)).map((other) => other.uid)
        : [item.uid];
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.track?.name || '');
    },
    onDragOver: (event) => {
      event.preventDefault();
      const after = isAfter(event);
      if (dropTarget?.uid !== item.uid || dropTarget.after !== after) {
        setDropTarget({ uid: item.uid, after });
      }
    },
    onDrop: (event) => {
      event.preventDefault();
      const uids = dragUidsRef.current;
      setDropTarget(null);
      const target = moveNextTo(tracks, uids, item.uid, isAfter(event));
      if (!sameOrder(target, tracks)) {
        const spot = target.findIndex((other) => other.uid === uids[0]) + 1;
        applyChange(target, uids.length === 1 ? `Moved "${nameOf(uids[0])}" to spot ${spot}.` : `Moved ${uids.length} songs to spot ${spot}.`);
      }
    },
    onDragEnd: () => setDropTarget(null),
  });

  const togglePanel = (name) => setPanel((current) => (current === name ? null : name));
  const toolButton = (name, label) => (
    <button className={`tool-button${panel === name ? ' is-active' : ''}`} onClick={() => togglePanel(name)} aria-expanded={panel === name}>
      {label}
    </button>
  );

  const totalDuration = (tracks || []).reduce((sum, item) => sum + (item.track?.duration_ms || 0), 0);
  // Keep each track's real position, so numbers stay correct while searching
  const visibleTracks = (tracks || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => matchesSearch(item.track, search));
  const selectedCount = selectedUids.length;
  const allVisibleSelected = visibleTracks.length > 0 && visibleTracks.every(({ item }) => selectedUids.includes(item.uid));

  return (
    <section className="card playlist-view">
      <button className="back-button" onClick={onBack}>← All playlists</button>

      <div className="playlist-header">
        {cover ? (
          <img className="playlist-header-cover" src={cover} alt="" />
        ) : (
          <div className="playlist-header-cover playlist-cover--empty" aria-hidden="true">♪</div>
        )}
        <div className="playlist-header-text">
          <h2 className="section-title">{playlist.name}</h2>
          <p className="playlist-meta">
            {playlist.owner?.display_name && `By ${playlist.owner.display_name} · `}
            {tracks ? `${plural(tracks.length, 'song')} · ${formatDuration(totalDuration)}` : 'Loading songs...'}
          </p>
          {playlist.external_urls?.spotify && (
            <a className="spotify-link" href={playlist.external_urls.spotify} target="_blank" rel="noopener noreferrer">
              Open in Spotify ↗
            </a>
          )}
          {!canEdit && <p className="playlist-note">This playlist isn't yours, so it can't be changed. You can still copy songs from it or duplicate it.</p>}
        </div>
      </div>

      {tracks === null ? (
        <p className="loading" role="status">
          <span className="equalizer" aria-hidden="true"><span /><span /><span /></span>
          Loading ahhhh...
        </p>
      ) : (
        <>
          <div className="toolbar">
            {canEdit && toolButton('add', '＋ Add songs')}
            {canEdit && toolButton('sort', '⇅ Sort')}
            {canEdit && toolButton('smart', '🎲 Smart shuffle')}
            {canEdit && toolButton('duplicates', '⧉ Duplicates')}
            {toolButton('stats', '📊 Stats')}
            {toolButton('more', '⋯ More')}
            {canEdit && (
              <button className="tool-button" disabled={busy || !history.length} onClick={undo}>
                ↶ Undo{history.length ? ` (${history.length})` : ''}
              </button>
            )}
          </div>

          {panel === 'add' && (
            <AddSongsPanel
              callSpotify={callSpotify}
              onAdd={addTrack}
              disabled={busy}
              existingIds={new Set(tracks.map((item) => item.track?.id))}
            />
          )}
          {panel === 'sort' && <SortPanel onSort={sortTracks} disabled={busy} />}
          {panel === 'smart' && (
            <SmartShufflePanel
              trackCount={tracks.length}
              checkedCount={selectedUids.length}
              tempo={tempo}
              genres={genres}
              tagCounts={tagCounts}
              onTag={tagSelected}
              onClearTags={clearSelectedTags}
              onShuffle={smartShuffleTracks}
              disabled={busy}
            />
          )}
          {panel === 'duplicates' && <DuplicatesPanel items={tracks} onRemoveDuplicates={removeTracks} disabled={busy} />}
          {panel === 'stats' && <StatsPanel items={tracks} />}
          {panel === 'more' && (
            <MorePanel
              playlists={playlists}
              currentId={playlist.id}
              canEdit={canEdit}
              onMerge={mergeIn}
              onDuplicate={duplicatePlaylist}
              disabled={busy}
            />
          )}

          <div className="status-area" aria-live="polite">
            {busy && (
              <p className="saving-message">
                Saving to Spotify{progress.total > 1 ? `... ${progress.done} of ${progress.total}` : '...'}
              </p>
            )}
            {error && <p className="error-message" role="alert">{error}</p>}
            {notice && !busy && (
              <p className="notice-message">
                {notice.message}
                {notice.playlistId && (
                  <button className="link-button" onClick={() => onOpenPlaylist(notice.playlistId)}>Open it</button>
                )}
              </p>
            )}
          </div>

          {canEdit && tracks.length > 1 && (
            <form className="move-form" onSubmit={handleMoveForm}>
              <label>
                Move song #
                <input
                  className="small-number"
                  type="number"
                  min="1"
                  max={tracks.length}
                  value={moveForm.from}
                  onChange={(event) => setMoveForm({ ...moveForm, from: event.target.value })}
                />
              </label>
              <label>
                to spot #
                <input
                  className="small-number"
                  type="number"
                  min="1"
                  max={tracks.length}
                  value={moveForm.to}
                  onChange={(event) => setMoveForm({ ...moveForm, to: event.target.value })}
                />
              </label>
              <button className="pill-button" disabled={busy || !moveForm.from || !moveForm.to}>Move</button>
            </form>
          )}

          <input
            className="search-input"
            type="search"
            placeholder="Search this playlist"
            aria-label="Search this playlist"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          {selectedCount > 0 && (
            <div className="selection-bar">
              <span className="selection-count">{selectedCount} selected</span>
              {canEdit && (
                <form
                  className="inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const spot = Number(new FormData(event.currentTarget).get('spot'));
                    if (spot >= 1) {
                      moveTracks(tracks.filter((item) => selectedUids.includes(item.uid)).map((item) => item.uid), spot);
                    }
                  }}
                >
                  <input className="small-number" name="spot" type="number" min="1" max={tracks.length} placeholder="#" aria-label="Spot to move selected songs to" />
                  <button className="pill-button pill-button--small" disabled={busy}>Move to spot</button>
                </form>
              )}
              {copyTargets.length > 0 && (
                <span className="inline-form">
                  <select className="text-input text-input--small" aria-label="Playlist to copy to" value={copyTargetId} onChange={(event) => setCopyTargetId(event.target.value)}>
                    <option value="">Copy or move to...</option>
                    {copyTargets.map((other) => (
                      <option key={other.id} value={other.id}>{other.name}</option>
                    ))}
                  </select>
                  <button className="pill-button pill-button--small" disabled={busy || !copyTargetId} onClick={() => copySelected(false)}>Copy there</button>
                  {canEdit && (
                    <button className="pill-button pill-button--small" disabled={busy || !copyTargetId} onClick={() => copySelected(true)}>Move there</button>
                  )}
                </span>
              )}
              {canEdit && (
                <button className="pill-button pill-button--small pill-button--danger" disabled={busy} onClick={() => removeTracks(selectedUids)}>
                  Remove
                </button>
              )}
              <button className="link-button" onClick={() => setSelectedUids([])}>Clear</button>
            </div>
          )}

          {visibleTracks.length === 0 ? (
            <p className="playlist-note">{search ? 'No songs match your search.' : 'This playlist is empty.'}</p>
          ) : (
            <>
              <label className="checkbox-label select-all">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={() => {
                    const visibleUids = visibleTracks.map(({ item }) => item.uid);
                    setSelectedUids((current) => (allVisibleSelected
                      ? current.filter((uid) => !visibleUids.includes(uid))
                      : [...new Set([...current, ...visibleUids])]));
                  }}
                />
                Select all{search ? ' shown' : ''}
              </label>
              {canEdit && <p className="playlist-note hint">Tip: drag songs by the ⋮⋮ handle, type a new number in a song's box, or select several and move them together.</p>}
              <ol className="track-list">
                {visibleTracks.map(({ item, index }) => (
                  <TrackRow
                    key={item.uid}
                    item={item}
                    index={index}
                    total={tracks.length}
                    canEdit={canEdit}
                    busy={busy}
                    selected={selectedUids.includes(item.uid)}
                    dropSide={dropTarget?.uid === item.uid ? (dropTarget.after ? 'after' : 'before') : null}
                    onToggleSelect={() => toggleSelected(item.uid)}
                    onMoveTo={(position) => moveTracks([item.uid], position)}
                    onRemove={() => removeTracks([item.uid])}
                    dragHandlers={dragHandlersFor(item)}
                    tags={tags[item.track?.uri]}
                    genre={genres.status === 'available' ? genreRef.current.get(item.track?.id) : null}
                  />
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
};

export default PlaylistView;
