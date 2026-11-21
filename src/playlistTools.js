// Pure helpers for working with a list of playlist items ({ track, added_at, uid }).
import { withUid } from './spotifySync';

export const artistNames = (track) => (track?.artists || []).map((artist) => artist.name).join(', ');

export const releaseYear = (track) => {
  const year = parseInt(track?.album?.release_date, 10);
  return Number.isNaN(year) ? null : year;
};

export const formatDuration = (ms) => {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours ? `${hours} hr ${minutes} min` : `${minutes}:${seconds}`;
};

export const matchesSearch = (track, search) => {
  if (!search) {
    return true;
  }
  const text = [track?.name, track?.album?.name, artistNames(track)].join(' ').toLowerCase();
  return text.includes(search.toLowerCase());
};

// Moves `uids` (kept in their current order) so the first one lands at `position` (1 = top)
export const moveToPosition = (items, uids, position) => {
  const moving = items.filter((item) => uids.includes(item.uid));
  const rest = items.filter((item) => !uids.includes(item.uid));
  const index = Math.min(Math.max(position - 1, 0), rest.length);
  return [...rest.slice(0, index), ...moving, ...rest.slice(index)];
};

// Moves `uids` to just before (or after) the track `anchorUid`
export const moveNextTo = (items, uids, anchorUid, after) => {
  if (uids.includes(anchorUid)) {
    return items;
  }
  const rest = items.filter((item) => !uids.includes(item.uid));
  const anchorIndex = rest.findIndex((item) => item.uid === anchorUid);
  return moveToPosition(items, uids, anchorIndex + (after ? 2 : 1));
};

const compareText = (a, b) => (a || '').localeCompare(b || '', undefined, { sensitivity: 'base' });

export const SORTS = {
  title: { label: 'Song title (A–Z)', compare: (a, b) => compareText(a.track?.name, b.track?.name) },
  artist: {
    label: 'Artist (A–Z)',
    compare: (a, b) => compareText(artistNames(a.track), artistNames(b.track)) || compareText(a.track?.album?.name, b.track?.album?.name),
  },
  album: {
    label: 'Album (A–Z)',
    // Within an album, keep the album's own track order
    compare: (a, b) => compareText(a.track?.album?.name, b.track?.album?.name)
      || (a.track?.disc_number || 0) - (b.track?.disc_number || 0)
      || (a.track?.track_number || 0) - (b.track?.track_number || 0),
  },
  newestRelease: { label: 'Release date (newest first)', compare: (a, b) => compareText(b.track?.album?.release_date, a.track?.album?.release_date) },
  oldestRelease: { label: 'Release date (oldest first)', compare: (a, b) => compareText(a.track?.album?.release_date, b.track?.album?.release_date) },
  newestAdded: { label: 'Date added (newest first)', compare: (a, b) => compareText(b.added_at, a.added_at) },
  oldestAdded: { label: 'Date added (oldest first)', compare: (a, b) => compareText(a.added_at, b.added_at) },
  shortest: { label: 'Length (shortest first)', compare: (a, b) => (a.track?.duration_ms || 0) - (b.track?.duration_ms || 0) },
  longest: { label: 'Length (longest first)', compare: (a, b) => (b.track?.duration_ms || 0) - (a.track?.duration_ms || 0) },
  reverse: { label: 'Reverse current order' },
  shuffle: { label: 'Shuffle' },
};

export const sortItems = (items, sortKey) => {
  if (sortKey === 'reverse') {
    return [...items].reverse();
  }
  if (sortKey === 'shuffle') {
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
  // Array sort keeps ties in their current order
  return [...items].sort(SORTS[sortKey].compare);
};

// Groups copies of the same song. Songs count as the same if they're the exact same
// Spotify track, or have the same title and main artist (e.g. single vs album version).
export const findDuplicates = (items) => {
  const groups = new Map();
  items.forEach((item, index) => {
    const { track } = item;
    if (!track) {
      return;
    }
    const key = `${(track.name || '').trim().toLowerCase()}|${(track.artists?.[0]?.name || '').toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push({ item, position: index + 1 });
  });
  return [...groups.values()].filter((group) => group.length > 1);
};

export const playlistStats = (items) => {
  const tracks = items.map((item) => item.track).filter(Boolean);
  const artistCounts = new Map();
  const decadeCounts = new Map();
  tracks.forEach((track) => {
    (track.artists || []).forEach((artist) => artistCounts.set(artist.name, (artistCounts.get(artist.name) || 0) + 1));
    const year = releaseYear(track);
    if (year) {
      const decade = Math.floor(year / 10) * 10;
      decadeCounts.set(decade, (decadeCounts.get(decade) || 0) + 1);
    }
  });
  const years = tracks.map(releaseYear).filter(Boolean);
  return {
    songCount: tracks.length,
    totalMs: tracks.reduce((sum, track) => sum + (track.duration_ms || 0), 0),
    artistCount: artistCounts.size,
    topArtists: [...artistCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    decades: [...decadeCounts.entries()].sort((a, b) => a[0] - b[0]),
    oldestYear: years.length ? Math.min(...years) : null,
    newestYear: years.length ? Math.max(...years) : null,
  };
};

// ---------- Genres ----------

// Spotify gives artists very specific genres ("melodic rap", "dance pop"), so they're
// folded into broad families. Checked in order, so "pop rap" counts as hip-hop.
const GENRE_FAMILIES = [
  ['Hip-hop', ['hip hop', 'hip-hop', 'rap', 'trap', 'drill', 'grime']],
  ['R&B', ['r&b', 'rnb', 'soul', 'funk']],
  ['Metal', ['metal', 'hardcore']],
  ['Country', ['country', 'bluegrass', 'americana']],
  ['Latin', ['latin', 'reggaeton', 'salsa', 'bachata', 'cumbia', 'corrido']],
  ['Jazz', ['jazz', 'swing', 'bossa']],
  ['Classical', ['classical', 'orchestra', 'baroque', 'opera', 'soundtrack', 'score']],
  ['Reggae', ['reggae', 'dancehall', 'ska', 'dub']],
  ['Folk', ['folk', 'singer-songwriter', 'acoustic']],
  ['Indie', ['indie', 'alternative', 'shoegaze', 'bedroom']],
  ['Rock', ['rock', 'punk', 'grunge', 'emo']],
  ['Pop', ['pop']],
  ['Electronic', ['electronic', 'edm', 'house', 'techno', 'trance', 'dubstep', 'electro', 'dance', 'disco', 'drum and bass']],
];

// Genres that sound alike sit next to each other in this list
export const GENRE_CHAIN = ['Classical', 'Jazz', 'R&B', 'Hip-hop', 'Pop', 'Electronic', 'Latin', 'Reggae', 'Folk', 'Country', 'Indie', 'Rock', 'Metal', 'Other'];

export const broadGenre = (artistGenres) => {
  if (!artistGenres?.length) {
    return null;  // Spotify doesn't know this artist's genre
  }
  const lower = artistGenres.map((genre) => genre.toLowerCase());
  const family = GENRE_FAMILIES.find(([, keywords]) => lower.some((genre) => keywords.some((keyword) => genre.includes(keyword))));
  return family ? family[0] : 'Other';
};

// ---------- Smart shuffle ----------

const shuffled = (items) => sortItems(items, 'shuffle');
const firstArtist = (item) => (item?.track?.artists?.[0]?.name || '').toLowerCase();

const weightedPick = (options, weightOf) => {
  const total = options.reduce((sum, option) => sum + weightOf(option), 0);
  let roll = Math.random() * total;
  for (const option of options) {
    roll -= weightOf(option);
    if (roll <= 0) {
      return option;
    }
  }
  return options[options.length - 1];
};

// Rearranges `items` following the chosen rules. Every option is optional:
//   keepFirst          number of songs at the top that stay where they are
//   pinnedUids         songs that stay exactly where they are ("stay put")
//   openingUids        songs that go first;  endingUids: songs that go last
//   togetherGroups     arrays of uids that stay next to each other, in their current order
//   apartGroups        arrays of uids that stay at least `apartDistance` songs apart
//   priorityUids       songs that tend to come earlier
//   favorites          Map of track uri -> how many times it should be in the playlist (copies are spread out)
//   keepAlbums         songs from the same album stay together
//   noRepeatArtists    never the same artist twice in a row
//   slowScores / slowUids   slow songs go toward the end (see SmartShufflePanel)
//   genreOf            Map of track id -> broad genre, needed by every genre rule below
//   genreMode          'off', 'spread' (no genre twice in a row), 'alternate', 'group', 'similar' or 'custom'
//   genreOrder         genre order for 'custom', e.g. ['Pop', 'R&B', 'Hip-hop']
//   genreLimit         { genre, percent }: removes songs of that genre above the limit
//   boostRareGenres    songs from less common genres tend to come earlier
// Rules can conflict, so it tries many arrangements and keeps the one that breaks the fewest.
export const smartShuffle = (items, options = {}) => {
  const {
    keepFirst = 0, pinnedUids = [], openingUids = [], endingUids = [], togetherGroups = [], apartGroups = [],
    apartDistance = 5, priorityUids = [], favorites = new Map(), keepAlbums = false, noRepeatArtists = false,
    slowScores = null, slowUids = null, genreOf = null, genreMode = 'off', genreOrder = [], genreLimit = null,
    boostRareGenres = false,
  } = options;
  const notes = [];
  const genreOfItem = (item) => (genreOf && item ? genreOf.get(item.track?.id) || null : null);

  // Songs that stay put remember their current spot
  const fixedIndex = new Map();
  items.forEach((item, index) => {
    if (index < keepFirst || pinnedUids.includes(item.uid)) {
      fixedIndex.set(item.uid, index);
    }
  });
  const tagged = new Set([...openingUids, ...endingUids, ...priorityUids, ...togetherGroups.flat(), ...apartGroups.flat()]);

  // Favorites: make sure each one is in the playlist the requested number of times
  let list = [...items];
  favorites.forEach((count, uri) => {
    const copies = list.filter((item) => item.track?.uri === uri);
    if (!copies.length) {
      return;
    }
    if (copies.length < count) {
      const extras = Array.from({ length: count - copies.length }, () => withUid({ track: copies[0].track, added_at: new Date().toISOString() }));
      list.push(...extras);
      notes.push(`Added ${extras.length} more ${extras.length === 1 ? 'copy' : 'copies'} of "${copies[0].track.name}".`);
    } else if (copies.length > count) {
      const removable = new Set(copies.filter((item) => !fixedIndex.has(item.uid)).slice(count - copies.length).map((item) => item.uid));
      list = list.filter((item) => !removable.has(item.uid));
    }
  });

  // Genre limit: take out songs of a genre above its share of the playlist
  if (genreLimit && genreOf && genreLimit.percent < 100) {
    const share = Math.max(genreLimit.percent, 0) / 100;
    const ofGenre = list.filter((item) => genreOfItem(item) === genreLimit.genre);
    const needed = Math.ceil((ofGenre.length - share * list.length) / (1 - share) - 1e-9);
    if (needed > 0) {
      const removable = shuffled(ofGenre.filter((item) => !fixedIndex.has(item.uid) && !tagged.has(item.uid) && !favorites.has(item.track?.uri)));
      const dropped = new Set(removable.slice(0, needed).map((item) => item.uid));
      list = list.filter((item) => !dropped.has(item.uid));
      if (dropped.size) {
        notes.push(`Removed ${dropped.size} ${genreLimit.genre} ${dropped.size === 1 ? 'song' : 'songs'} to keep it near ${genreLimit.percent}%.`);
      }
      if (dropped.size < needed) {
        notes.push(`${genreLimit.genre} is still over ${genreLimit.percent}%, because the rest are songs you tagged.`);
      }
    }
  }

  const length = list.length;
  const fixedSlots = new Array(length).fill(null);
  list
    .filter((item) => fixedIndex.has(item.uid))
    .sort((a, b) => fixedIndex.get(a.uid) - fixedIndex.get(b.uid))
    .forEach((item) => {
      let slot = Math.min(fixedIndex.get(item.uid), length - 1);
      while (fixedSlots[slot]) {
        slot = (slot + 1) % length;
      }
      fixedSlots[slot] = item;
    });
  const movable = list.filter((item) => !fixedIndex.has(item.uid));

  // Build units: songs that must stay together (same album, or tagged "together") move as one
  const parent = new Map(movable.map((item) => [item.uid, item.uid]));
  const root = (uid) => (parent.get(uid) === uid ? uid : root(parent.get(uid)));
  const join = (a, b) => parent.has(a) && parent.has(b) && parent.set(root(a), root(b));
  if (keepAlbums) {
    const firstOfAlbum = new Map();
    movable.forEach((item) => {
      const key = item.track?.album?.id || item.track?.album?.name || item.uid;
      if (firstOfAlbum.has(key)) {
        join(item.uid, firstOfAlbum.get(key));
      } else {
        firstOfAlbum.set(key, item.uid);
      }
    });
  }
  togetherGroups.forEach((group) => group.slice(1).forEach((uid) => join(uid, group[0])));
  const unitSongs = new Map();
  movable.forEach((item) => {
    const key = root(item.uid);
    if (!unitSongs.has(key)) {
      unitSongs.set(key, []);
    }
    unitSongs.get(key).push(item);
  });

  const genreCounts = new Map();
  movable.forEach((item) => {
    const genre = genreOfItem(item);
    if (genre) {
      genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    }
  });
  const biggestGenre = Math.max(1, ...genreCounts.values());
  const priority = new Set(priorityUids);

  let units = [...unitSongs.values()].map((songs) => {
    const has = (uids) => songs.some((item) => uids.includes(item.uid));
    const genre = genreOfItem(songs[0]);
    let weight = songs.some((item) => priority.has(item.uid)) ? 4 : 1;
    if (boostRareGenres && genre) {
      weight *= Math.sqrt(biggestGenre / genreCounts.get(genre));
    }
    return {
      songs,
      weight,
      genre,
      firstArtist: firstArtist(songs[0]),
      lastArtist: firstArtist(songs[songs.length - 1]),
      lastGenre: genreOfItem(songs[songs.length - 1]),
      phase: has(openingUids) ? 'opening' : has(endingUids) ? 'ending' : 'middle',
      slowness: slowScores ? songs.reduce((sum, item) => sum + (slowScores.get(item.uid) || 0), 0) / songs.length : 0,
    };
  });

  // Slow songs go after the main part, before any "ending" songs
  if (slowScores) {
    const ranked = units.filter((unit) => unit.phase === 'middle').sort((a, b) => a.slowness - b.slowness);
    ranked.slice(ranked.length - Math.round(ranked.length * 0.3)).forEach((unit) => { unit.phase = 'slow'; });
  } else if (slowUids?.size) {
    units.filter((unit) => unit.phase === 'middle' && unit.songs.some((item) => slowUids.has(item.uid)))
      .forEach((unit) => { unit.phase = 'slow'; });
  }

  const apartGroupOf = new Map();
  apartGroups.forEach((group, index) => group.forEach((uid) => apartGroupOf.set(uid, index)));
  const favoriteSpacing = new Map([...favorites].map(([uri, count]) => [uri, Math.max(1, Math.floor((length / count) * 0.6))]));
  const presentGenres = [...genreCounts.keys()];

  // One attempt: fill the free spots from the top, each time picking the unit that
  // breaks the fewest rules there (randomly among equally good ones)
  const arrange = () => {
    const slots = [...fixedSlots];
    const free = slots.map((item, index) => (item ? -1 : index)).filter((index) => index >= 0);
    const positionsOf = new Map();  // apart group or favorite uri -> spots used so far
    const remember = (key, position) => positionsOf.set(key, [...(positionsOf.get(key) || []), position]);
    let pointer = 0;
    let broken = 0;

    // Genre order for this attempt, used by the grouping modes
    let rankOf = () => 0;
    if (genreMode === 'group') {
      const order = shuffled(presentGenres);
      rankOf = (genre) => (genre ? order.indexOf(genre) : order.length);
    } else if (genreMode === 'similar') {
      const chain = Math.random() < 0.5 ? GENRE_CHAIN : [...GENRE_CHAIN].reverse();
      rankOf = (genre) => (genre ? chain.indexOf(genre) : chain.length);
    } else if (genreMode === 'custom') {
      const order = [...genreOrder, ...GENRE_CHAIN.filter((genre) => !genreOrder.includes(genre))];
      rankOf = (genre) => (genre ? order.indexOf(genre) : order.length);
    }
    const cycle = shuffled(presentGenres);
    let cycleIndex = 0;

    for (const phase of ['opening', 'middle', 'slow', 'ending']) {
      let remaining = shuffled(units.filter((unit) => unit.phase === phase));
      while (remaining.length) {
        const start = pointer;
        const position = free[start];
        const previous = slots[position - 1];
        let candidates = remaining;

        if (phase === 'middle' && ['group', 'similar', 'custom'].includes(genreMode)) {
          const lowest = Math.min(...candidates.map((unit) => rankOf(unit.genre)));
          candidates = candidates.filter((unit) => rankOf(unit.genre) === lowest);
        }
        if (phase === 'slow' && slowScores) {
          // Wind down: each next song is the least slow one left
          const least = Math.min(...candidates.map((unit) => unit.slowness));
          candidates = candidates.filter((unit) => unit.slowness === least);
        }
        if (noRepeatArtists && candidates.length > 1) {
          // If one artist has more than half of what's left, it has to go now or it won't fit later
          const counts = new Map();
          candidates.forEach((unit) => counts.set(unit.firstArtist, (counts.get(unit.firstArtist) || 0) + 1));
          const [crowded, crowdedCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
          if (crowded !== firstArtist(previous) && crowdedCount > candidates.length - crowdedCount) {
            candidates = candidates.filter((unit) => unit.firstArtist === crowded);
          }
        }
        let target = null;
        if (genreMode === 'alternate' && phase === 'middle') {
          const left = new Set(remaining.map((unit) => unit.genre));
          for (let step = 0; step < cycle.length && !target; step++) {
            const genre = cycle[(cycleIndex + step) % cycle.length];
            if (left.has(genre)) {
              target = genre;
            }
          }
        }

        const costOf = (unit) => {
          const size = unit.songs.length;
          const next = slots[position + size];  // Only filled if it's a song that stays put
          let cost = 0;
          if (size > 1 && free[start + size - 1] !== position + size - 1) {
            cost += 3;  // A song that stays put would split this group
          }
          if (noRepeatArtists) {
            cost += (previous && firstArtist(previous) === unit.firstArtist ? 1 : 0) + (next && firstArtist(next) === unit.lastArtist ? 1 : 0);
          }
          if (genreMode === 'spread' || genreMode === 'alternate') {
            const before = genreOfItem(previous);
            const after = genreOfItem(next);
            cost += (before && before === unit.genre ? 1 : 0) + (after && after === unit.lastGenre ? 1 : 0);
          }
          if (target && unit.genre !== target) {
            cost += 0.5;
          }
          unit.songs.forEach((item, offset) => {
            const spot = position + offset;
            const group = apartGroupOf.get(item.uid);
            if (group !== undefined && (positionsOf.get(`apart${group}`) || []).some((other) => Math.abs(other - spot) < apartDistance)) {
              cost += 2;
            }
            const spacing = favoriteSpacing.get(item.track?.uri);
            if (spacing && (positionsOf.get(item.track.uri) || []).some((other) => Math.abs(other - spot) < spacing)) {
              cost += 1;
            }
          });
          return cost;
        };

        const costs = candidates.map(costOf);
        const best = Math.min(...costs);
        const unit = weightedPick(candidates.filter((_, index) => costs[index] === best), (option) => option.weight);
        broken += best;
        unit.songs.forEach((item, offset) => {
          const spot = free[start + offset];
          slots[spot] = item;
          if (apartGroupOf.has(item.uid)) {
            remember(`apart${apartGroupOf.get(item.uid)}`, spot);
          }
          if (favoriteSpacing.has(item.track?.uri)) {
            remember(item.track.uri, spot);
          }
        });
        pointer += unit.songs.length;
        remaining = remaining.filter((other) => other !== unit);
        if (target) {
          cycleIndex = cycle.indexOf(unit.genre) + 1;
        }
      }
    }
    return { slots, broken };
  };

  // Bigger playlists get fewer attempts so it stays quick
  const attempts = Math.max(1, Math.min(40, Math.floor(400000 / (units.length * units.length + 1))));
  let best = null;
  for (let attempt = 0; attempt < attempts && best?.broken !== 0; attempt++) {
    const result = arrange();
    if (!best || result.broken < best.broken) {
      best = result;
    }
  }
  const result = best ? best.slots : fixedSlots;

  const neighbours = (check) => result.filter((item, index) => index > 0 && check(item, result[index - 1])).length;
  const artistRepeats = noRepeatArtists ? neighbours((item, before) => firstArtist(item) === firstArtist(before)
    // Songs kept together as an album don't count as a broken rule
    && !(keepAlbums && item.track?.album?.name === before.track?.album?.name)) : 0;
  const genreRepeats = genreMode === 'spread' || genreMode === 'alternate'
    ? neighbours((item, before) => genreOfItem(item) && genreOfItem(item) === genreOfItem(before)) : 0;
  return { items: result, artistRepeats, genreRepeats, notes };
};

// Turns Spotify's audio features into a slowness score: low tempo and low energy = slow
export const slownessScore = (features) => (1 - (features.energy ?? 0.5)) * 0.6 + (1 - Math.min((features.tempo || 120) / 200, 1)) * 0.4;
