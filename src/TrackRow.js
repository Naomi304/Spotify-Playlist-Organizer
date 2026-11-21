import React from 'react';
import { artistNames, formatDuration } from './playlistTools';

// Short labels for smart shuffle tags; group numbers show as letters (A, B, C...)
const groupLetter = (number) => String.fromCharCode(64 + number);
const tagChips = (tags = {}) => [
  tags.pin && '📌 Stays put',
  tags.opening && '▶ Opening',
  tags.ending && '⏹ Ending',
  tags.priority && '⬆ Priority',
  tags.slow && '🐢 Slow',
  tags.favorite && `⭐ ×${tags.favorite}`,
  tags.together && `🔗 Together ${groupLetter(tags.together)}`,
  tags.apart && `↔ Apart ${groupLetter(tags.apart)}`,
].filter(Boolean);

const TrackRow = ({
  item,
  index,
  total,
  canEdit,
  busy,
  selected,
  dropSide,  // 'before' or 'after' while something is dragged over this row
  onToggleSelect,
  onMoveTo,
  onRemove,
  dragHandlers,
  tags,
  genre,
}) => {
  const { track } = item;
  const name = track?.name || 'Unavailable track';
  const albumArt = track?.album?.images?.[track.album.images.length - 1]?.url;
  const spotifyUrl = track?.external_urls?.spotify;

  // Called when the position box loses focus (Enter also blurs it)
  const handlePositionChange = (event) => {
    const newPosition = Number(event.target.value);
    if (Number.isInteger(newPosition) && newPosition >= 1 && newPosition <= total) {
      onMoveTo(newPosition);
    } else {
      event.target.value = index + 1;
    }
  };

  const classes = ['track-row', selected && 'is-selected', dropSide && `drop-${dropSide}`].filter(Boolean).join(' ');

  return (
    <li className={classes} draggable={canEdit && !busy} {...(canEdit ? dragHandlers : {})}>
      <span className="row-controls">
        {canEdit && <span className="drag-handle" aria-hidden="true" title="Drag to move">⋮⋮</span>}
        <input
          type="checkbox"
          className="row-checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${name}`}
        />
      </span>

      {canEdit ? (
        <input
          // Changing the key resets the box to the new number after a move
          key={`${item.uid}-${index}`}
          className="position-input"
          type="number"
          min="1"
          max={total}
          defaultValue={index + 1}
          aria-label={`Position of ${name}`}
          disabled={busy}
          onBlur={handlePositionChange}
          onKeyDown={(event) => event.key === 'Enter' && event.target.blur()}
        />
      ) : (
        <span className="position-number">{index + 1}</span>
      )}

      {albumArt ? (
        <img className="track-art" src={albumArt} alt="" loading="lazy" draggable="false" />
      ) : (
        <span className="track-art playlist-cover--empty" aria-hidden="true">♪</span>
      )}

      <span className="track-text">
        {spotifyUrl ? (
          <a className="track-name" href={spotifyUrl} target="_blank" rel="noopener noreferrer" draggable="false">{name}</a>
        ) : (
          <span className="track-name">{name}</span>
        )}
        <span className="track-artist">{artistNames(track)}</span>
        {(genre || tags) && (
          <span className="track-tags">
            {genre && <span className="chip chip--genre">{genre}</span>}
            {tagChips(tags).map((chip) => <span key={chip} className="chip">{chip}</span>)}
          </span>
        )}
      </span>

      <span className="track-album">{track?.album?.name}</span>
      <span className="track-duration">{track ? formatDuration(track.duration_ms) : ''}</span>

      {canEdit && (
        <span className="move-buttons">
          <button className="move-button" aria-label={`Move ${name} up`} disabled={busy || index === 0} onClick={() => onMoveTo(index)}>
            ▲
          </button>
          <button className="move-button" aria-label={`Move ${name} down`} disabled={busy || index === total - 1} onClick={() => onMoveTo(index + 2)}>
            ▼
          </button>
          <button className="move-button remove-button" aria-label={`Remove ${name}`} disabled={busy} onClick={onRemove}>
            ✕
          </button>
        </span>
      )}
    </li>
  );
};

export default TrackRow;
