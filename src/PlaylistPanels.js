import React, { useState } from 'react';
import { SORTS, artistNames, findDuplicates, formatDuration, playlistStats } from './playlistTools';

export const AddSongsPanel = ({ callSpotify, onAdd, disabled, existingIds }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');

  const search = async (event) => {
    event.preventDefault();
    if (!query.trim()) {
      return;
    }
    setSearching(true);
    setMessage('');
    try {
      const response = await callSpotify((api) => api.searchTracks(query, { limit: 10 }));
      setResults(response.tracks.items);
      if (!response.tracks.items.length) {
        setMessage('No songs found.');
      }
    } catch (error) {
      console.error('Error searching Spotify:', error);
      setMessage("Couldn't search Spotify. Please try again.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="tool-panel">
      <form className="inline-form" onSubmit={search}>
        <input
          className="text-input"
          type="search"
          placeholder="Search Spotify for a song or artist"
          aria-label="Search Spotify"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="pill-button" disabled={searching}>{searching ? 'Searching...' : 'Search'}</button>
      </form>
      {message && <p className="playlist-note">{message}</p>}
      <ul className="result-list">
        {results.map((track) => (
          <li key={track.id} className="result-row">
            {track.album?.images?.length ? (
              <img className="track-art" src={track.album.images[track.album.images.length - 1].url} alt="" loading="lazy" />
            ) : (
              <span className="track-art playlist-cover--empty" aria-hidden="true">♪</span>
            )}
            <span className="track-text">
              <span className="track-name">{track.name}</span>
              <span className="track-artist">{artistNames(track)}</span>
            </span>
            <button className="pill-button pill-button--small" disabled={disabled} onClick={() => onAdd(track)}>
              {existingIds.has(track.id) ? 'Add again' : 'Add'}
            </button>
          </li>
        ))}
      </ul>
      {results.length > 0 && <p className="playlist-note">Songs are added to the end of the playlist.</p>}
    </div>
  );
};

export const SortPanel = ({ onSort, disabled }) => {
  const [sortKey, setSortKey] = useState('artist');
  return (
    <div className="tool-panel">
      <div className="inline-form">
        <select className="text-input" aria-label="Sort by" value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
          {Object.entries(SORTS).map(([key, { label }]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <button className="pill-button" disabled={disabled} onClick={() => onSort(sortKey)}>Sort playlist</button>
      </div>
      <p className="playlist-note">This changes the order on Spotify. You can undo it afterwards.</p>
    </div>
  );
};

export const DuplicatesPanel = ({ items, onRemoveDuplicates, disabled }) => {
  const groups = findDuplicates(items);
  if (!groups.length) {
    return (
      <div className="tool-panel">
        <p className="playlist-note">No duplicates. Every song in this playlist is only in it once.</p>
      </div>
    );
  }
  const extraCount = groups.reduce((sum, group) => sum + group.length - 1, 0);
  return (
    <div className="tool-panel">
      <p className="tool-panel-intro">
        Found {extraCount} extra {extraCount === 1 ? 'copy' : 'copies'}. The first of each is kept.
      </p>
      <ul className="duplicate-list">
        {groups.map((group) => (
          <li key={group[0].item.uid}>
            <strong>{group[0].item.track.name}</strong> · {artistNames(group[0].item.track)}
            <span className="playlist-note"> (spots {group.map((entry) => entry.position).join(', ')})</span>
          </li>
        ))}
      </ul>
      <button
        className="pill-button"
        disabled={disabled}
        onClick={() => onRemoveDuplicates(groups.flatMap((group) => group.slice(1).map((entry) => entry.item.uid)))}
      >
        Remove {extraCount} {extraCount === 1 ? 'duplicate' : 'duplicates'}
      </button>
    </div>
  );
};

export const StatsPanel = ({ items }) => {
  const stats = playlistStats(items);
  const biggestDecade = Math.max(1, ...stats.decades.map(([, count]) => count));
  return (
    <div className="tool-panel stats-panel">
      <dl className="stat-tiles">
        <div><dt>Songs</dt><dd>{stats.songCount}</dd></div>
        <div><dt>Total length</dt><dd>{formatDuration(stats.totalMs)}</dd></div>
        <div><dt>Artists</dt><dd>{stats.artistCount}</dd></div>
        <div>
          <dt>Years</dt>
          <dd>{stats.oldestYear ? `${stats.oldestYear}–${stats.newestYear}` : '—'}</dd>
        </div>
      </dl>

      {stats.topArtists.length > 0 && (
        <>
          <h3 className="stats-heading">Top artists</h3>
          <ol className="top-artists">
            {stats.topArtists.map(([name, count]) => (
              <li key={name}>{name} <span className="playlist-note">· {count} {count === 1 ? 'song' : 'songs'}</span></li>
            ))}
          </ol>
        </>
      )}

      {stats.decades.length > 0 && (
        <>
          <h3 className="stats-heading">Songs by decade</h3>
          <ul className="decade-bars">
            {stats.decades.map(([decade, count]) => (
              <li key={decade}>
                <span className="decade-label">{decade}s</span>
                <span className="decade-bar" style={{ width: `${(count / biggestDecade) * 100}%` }} />
                <span className="decade-count">{count}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

export const MorePanel = ({ playlists, currentId, canEdit, onMerge, onDuplicate, disabled }) => {
  const others = playlists.filter((playlist) => playlist.id !== currentId);
  const [sourceId, setSourceId] = useState(others[0]?.id || '');
  const [skipExisting, setSkipExisting] = useState(true);

  return (
    <div className="tool-panel">
      {canEdit && others.length > 0 && (
        <div className="tool-section">
          <h3 className="stats-heading">Merge another playlist into this one</h3>
          <div className="inline-form">
            <select className="text-input" aria-label="Playlist to merge in" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
              {others.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>{playlist.name}</option>
              ))}
            </select>
            <button className="pill-button" disabled={disabled || !sourceId} onClick={() => onMerge(sourceId, skipExisting)}>Merge</button>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={skipExisting} onChange={(event) => setSkipExisting(event.target.checked)} />
            Skip songs that are already in this playlist
          </label>
        </div>
      )}

      <div className="tool-section">
        <h3 className="stats-heading">Make a copy</h3>
        <p className="playlist-note">
          Creates a new private playlist in your library with the same songs. Handy before a big reshuffle.
        </p>
        <button className="pill-button" disabled={disabled} onClick={onDuplicate}>Duplicate playlist</button>
      </div>
    </div>
  );
};


// The song tags used by smart shuffle. They're saved per playlist, by song.
export const TAGS = {
  pin: { button: '📌 Stay put', chip: '📌 Stays put', help: 'keeps its exact spot' },
  opening: { button: '▶ Opening', chip: '▶ Opening', help: 'plays first' },
  ending: { button: '⏹ Ending', chip: '⏹ Ending', help: 'plays last' },
  together: { button: '🔗 Keep together', chip: '🔗', help: 'next to each other' },
  apart: { button: '↔ Keep apart', chip: '↔', help: 'spread apart' },
  priority: { button: '⬆ Priority', chip: '⬆ Priority', help: 'tends to come earlier' },
  slow: { button: '🐢 Slow', chip: '🐢 Slow', help: 'goes toward the end' },
  favorite: { button: '⭐ Favorite', chip: '⭐', help: 'extra copies, spread out' },
};

const GENRE_MODES = [
  ['off', 'No genre rule'],
  ['spread', 'Spread genres out (never the same genre twice in a row)'],
  ['alternate', 'Take turns between genres (pop, rock, jazz, pop, rock, jazz...)'],
  ['group', 'Group songs by genre'],
  ['similar', 'Group by genre, with similar genres next to each other'],
  ['custom', 'My own genre order (e.g. pop, then R&B, then hip-hop)'],
];

export const SmartShufflePanel = ({
  trackCount, checkedCount, tempo, genres, tagCounts, onTag, onClearTags, onShuffle, disabled,
}) => {
  const [noRepeatArtists, setNoRepeatArtists] = useState(true);
  const [keepAlbums, setKeepAlbums] = useState(false);
  const [slowLast, setSlowLast] = useState(false);
  const [keepFirst, setKeepFirst] = useState(false);
  const [keepFirstCount, setKeepFirstCount] = useState(5);
  const [genreMode, setGenreMode] = useState('off');
  const [genreOrder, setGenreOrder] = useState([]);
  const [limitOn, setLimitOn] = useState(false);
  const [limitGenre, setLimitGenre] = useState('');
  const [limitPercent, setLimitPercent] = useState(30);
  const [boostRareGenres, setBoostRareGenres] = useState(false);
  const [apartDistance, setApartDistance] = useState(5);
  const [favoriteCount, setFavoriteCount] = useState(2);

  const genreNames = genres.list.map(([name]) => name);
  // The custom order starts with the most common genre first, and keeps any you've already arranged
  const order = [...genreOrder.filter((name) => genreNames.includes(name)), ...genreNames.filter((name) => !genreOrder.includes(name))];
  const moveGenre = (index, step) => {
    const next = [...order];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    setGenreOrder(next);
  };
  const genresReady = genres.status === 'available';
  const firstCount = Math.min(Math.max(Number(keepFirstCount) || 0, 0), trackCount);
  const chosenLimitGenre = limitGenre || genreNames[0];
  const tagSummary = Object.entries(tagCounts).filter(([, count]) => count > 0);

  const shuffle = () => onShuffle({
    noRepeatArtists,
    keepAlbums,
    slowLast,
    keepFirst: keepFirst ? firstCount : 0,
    genreMode: genresReady ? genreMode : 'off',
    genreOrder: order,
    genreLimit: genresReady && limitOn && chosenLimitGenre
      ? { genre: chosenLimitGenre, percent: Math.min(Math.max(Number(limitPercent) || 0, 0), 100) }
      : null,
    boostRareGenres: genresReady && boostRareGenres,
    apartDistance: Math.max(Number(apartDistance) || 2, 2),
  });

  return (
    <div className="tool-panel smart-panel">
      <p className="tool-panel-intro">Shuffle the playlist, but follow your rules. They all work together.</p>

      <fieldset className="rule-group">
        <legend>General</legend>
        <label className="checkbox-label">
          <input type="checkbox" checked={noRepeatArtists} onChange={(event) => setNoRepeatArtists(event.target.checked)} />
          Never play the same artist twice in a row
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={keepAlbums} onChange={(event) => setKeepAlbums(event.target.checked)} />
          Keep songs from the same album together
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={slowLast} onChange={(event) => setSlowLast(event.target.checked)} />
          Put slower songs toward the end
        </label>
        {slowLast && (
          <p className="playlist-note rule-note">
            {tempo === 'loading' && 'Checking song tempos with Spotify...'}
            {tempo === 'available' && "Uses each song's tempo and energy from Spotify. The slowest third ends the playlist, winding down."}
            {tempo === 'unavailable' && (
              <>Spotify doesn't share song tempos with newer apps, so tag your slow songs with 🐢 below. <strong>{tagCounts.slow || 0} tagged.</strong></>
            )}
          </p>
        )}
        <label className="checkbox-label">
          <input type="checkbox" checked={keepFirst} onChange={(event) => setKeepFirst(event.target.checked)} />
          Keep the first
          <input
            className="small-number"
            type="number"
            min="1"
            max={trackCount}
            value={keepFirstCount}
            aria-label="How many songs to keep at the top"
            onChange={(event) => setKeepFirstCount(event.target.value)}
          />
          songs where they are
        </label>
      </fieldset>

      <fieldset className="rule-group" disabled={!genresReady}>
        <legend>Genres</legend>
        {genres.status === 'loading' && <p className="playlist-note rule-note-top">Looking up genres with Spotify...</p>}
        {genres.status === 'unavailable' && (
          <p className="playlist-note rule-note-top">Spotify didn't share genres for these artists, so genre rules are off.</p>
        )}
        {genresReady && (
          <p className="playlist-note rule-note-top">
            Genres come from each song's main artist: {genres.list.map(([name, count]) => `${name} (${count})`).join(', ')}.
          </p>
        )}
        <div className="radio-list">
          {GENRE_MODES.map(([value, label]) => (
            <label key={value} className="checkbox-label">
              <input type="radio" name="genre-mode" value={value} checked={genreMode === value} onChange={() => setGenreMode(value)} />
              {label}
            </label>
          ))}
        </div>
        {genresReady && genreMode === 'custom' && (
          <ol className="genre-order">
            {order.map((name, index) => (
              <li key={name}>
                <span>{index + 1}. {name}</span>
                <span className="move-buttons">
                  <button type="button" className="move-button" aria-label={`Move ${name} earlier`} disabled={index === 0} onClick={() => moveGenre(index, -1)}>▲</button>
                  <button type="button" className="move-button" aria-label={`Move ${name} later`} disabled={index === order.length - 1} onClick={() => moveGenre(index, 1)}>▼</button>
                </span>
              </li>
            ))}
          </ol>
        )}
        <label className="checkbox-label">
          <input type="checkbox" checked={limitOn} onChange={(event) => setLimitOn(event.target.checked)} />
          Limit
          <select className="text-input text-input--small" aria-label="Genre to limit" value={chosenLimitGenre || ''} onChange={(event) => setLimitGenre(event.target.value)}>
            {genreNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          to
          <input className="small-number" type="number" min="0" max="100" value={limitPercent} aria-label="Most this genre can be, in percent" onChange={(event) => setLimitPercent(event.target.value)} />
          % of the playlist
        </label>
        {limitOn && <p className="playlist-note rule-note">Songs over the limit are removed from the playlist. Undo brings them back.</p>}
        <label className="checkbox-label">
          <input type="checkbox" checked={boostRareGenres} onChange={(event) => setBoostRareGenres(event.target.checked)} />
          Play less common genres earlier
        </label>
      </fieldset>

      <fieldset className="rule-group">
        <legend>Song rules</legend>
        <p className="playlist-note rule-note-top">
          Check songs in the list below, then tag them. {checkedCount ? `${checkedCount} checked.` : 'Nothing checked yet.'}
        </p>
        <div className="tag-buttons">
          {['pin', 'opening', 'ending', 'priority', 'slow'].map((kind) => (
            <button key={kind} type="button" className="tool-button" disabled={!checkedCount} title={TAGS[kind].help} onClick={() => onTag(kind)}>
              {TAGS[kind].button}
            </button>
          ))}
          <button type="button" className="tool-button" disabled={checkedCount < 2} title={TAGS.together.help} onClick={() => onTag('together')}>
            {TAGS.together.button}
          </button>
          <button type="button" className="tool-button" disabled={checkedCount < 2} title={TAGS.apart.help} onClick={() => onTag('apart')}>
            {TAGS.apart.button}
          </button>
          <span className="tag-with-number">
            <button type="button" className="tool-button" disabled={!checkedCount} title={TAGS.favorite.help} onClick={() => onTag('favorite', Math.min(Math.max(Number(favoriteCount) || 2, 2), 10))}>
              {TAGS.favorite.button}
            </button>
            ×
            <input className="small-number" type="number" min="2" max="10" value={favoriteCount} aria-label="How many times a favorite should be in the playlist" onChange={(event) => setFavoriteCount(event.target.value)} />
          </span>
          <button type="button" className="link-button" disabled={!checkedCount} onClick={onClearTags}>Clear tags</button>
        </div>
        <label className="checkbox-label">
          Keep ↔ songs at least
          <input className="small-number" type="number" min="2" value={apartDistance} aria-label="Minimum distance between keep-apart songs" onChange={(event) => setApartDistance(event.target.value)} />
          songs apart
        </label>
        <ul className="rule-help">
          <li><strong>📌 Stay put</strong> keeps a song in its exact spot while everything else shuffles around it. Use it to protect favorites or set anchors.</li>
          <li><strong>⭐ Favorite ×N</strong> makes a song play more often by keeping N copies of it, spread through the playlist.</li>
        </ul>
        {tagSummary.length > 0 && (
          <p className="playlist-note">
            Tagged: {tagSummary.map(([kind, count]) => `${TAGS[kind].chip} ${count}`).join(' · ')}
          </p>
        )}
      </fieldset>

      <button className="pill-button" disabled={disabled || (slowLast && tempo === 'loading')} onClick={shuffle}>
        🎲 Shuffle with rules
      </button>
      <p className="playlist-note">Not happy with the result? Press it again, or use Undo.</p>
    </div>
  );
};
