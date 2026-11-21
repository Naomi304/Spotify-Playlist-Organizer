// Helpers for reading playlists from Spotify and saving changes back.
//
// Every edit in the app (moving, sorting, removing, adding, undo) works the same way:
// work out the new track list locally, then call syncPlaylist() to make Spotify match it
// with as few requests as possible. Each track in the app has a `uid`, so even a song that
// appears twice can be told apart.

const PAGE_SIZE = 100;  // The most tracks Spotify accepts or returns in one request

let nextUid = 0;
export const withUid = (item) => ({ ...item, uid: nextUid++ });

// Local files from someone's computer can't be added or removed through Spotify's API
export const isEditable = (item) => Boolean(item.track?.uri) && !item.track.uri.startsWith('spotify:local:');

export const fetchAllPlaylistItems = async (callSpotify, playlistId) => {
  const items = [];
  let total = Infinity;
  while (items.length < total) {
    const offset = items.length;
    const page = await callSpotify((api) => api.getPlaylistTracks(playlistId, { offset, limit: PAGE_SIZE }));
    items.push(...page.items.map(withUid));
    total = page.total;
    if (!page.items.length) {
      break;
    }
  }
  return items;
};

export const fetchAllPlaylists = async (callSpotify) => {
  const playlists = [];
  let total = Infinity;
  while (playlists.length < total) {
    const page = await callSpotify((api) => api.getUserPlaylists({ offset: playlists.length, limit: 50 }));
    playlists.push(...page.items.filter(Boolean));
    total = page.total;
    if (!page.items.length) {
      break;
    }
  }
  return playlists;
};

const chunk = (items, size) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

// Adds tracks to the end of a playlist, 100 at a time
export const appendUris = async (callSpotify, playlistId, uris) => {
  for (const group of chunk(uris, PAGE_SIZE)) {
    await callSpotify((api) => api.addTracksToPlaylist(playlistId, group));
  }
};

// Groups items whose target positions follow on from each other, so each group is one request
const consecutiveRuns = (entries) => {
  const runs = [];
  entries.forEach((entry) => {
    const last = runs[runs.length - 1];
    if (last && entry.position === last.position + last.uris.length && last.uris.length < PAGE_SIZE) {
      last.uris.push(entry.uri);
    } else {
      runs.push({ position: entry.position, uris: [entry.uri] });
    }
  });
  return runs;
};

// Indexes of the longest run of values that are already in increasing order.
// Those tracks can stay put; only the rest need moving.
const longestIncreasingSubsequence = (values) => {
  const tails = [];      // tails[k] = index of the smallest ending value of a run of length k + 1
  const previous = [];
  values.forEach((value, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]] < value) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    previous[index] = low > 0 ? tails[low - 1] : -1;
    tails[low] = index;
  });
  const result = new Set();
  for (let index = tails[tails.length - 1]; index !== undefined && index >= 0; index = previous[index]) {
    result.add(index);
  }
  return result;
};

// Works out the moves that turn `currentUids` into `targetUids` (same tracks, new order).
// Each move is { rangeStart, insertBefore } in Spotify's terms.
export const planMoves = (currentUids, targetUids) => {
  const rankOf = new Map(targetUids.map((uid, rank) => [uid, rank]));
  const order = currentUids.map((uid) => rankOf.get(uid));
  const staying = longestIncreasingSubsequence(order);
  const placed = new Set([...staying].map((index) => order[index]));
  const toMove = order.filter((_, index) => !staying.has(index)).sort((a, b) => a - b);

  const moves = [];
  for (const rank of toMove) {
    const from = order.indexOf(rank);
    order.splice(from, 1);
    // Put it just before the closest track after it that's already in place
    let to = order.findIndex((other) => other > rank && placed.has(other));
    if (to === -1) {
      to = order.length;
    }
    order.splice(to, 0, rank);
    placed.add(rank);
    // Spotify counts insert_before as if the track hadn't been taken out yet
    moves.push({ rangeStart: from, insertBefore: to > from ? to + 1 : to });
  }
  return moves;
};

// Makes the playlist on Spotify match `target`. `onProgress(done, total)` reports progress.
export const syncPlaylist = async (callSpotify, playlistId, current, target, onProgress = () => {}) => {
  const targetUids = new Set(target.map((item) => item.uid));
  const currentUids = new Set(current.map((item) => item.uid));
  const removed = current.filter((item) => !targetUids.has(item.uid));
  let working = current.filter((item) => targetUids.has(item.uid));

  // Spotify removes every copy of a song at once, so copies we're keeping get put back afterwards
  const removedUris = [...new Set(removed.map((item) => item.track.uri))];
  const putBack = working
    .map((item, position) => ({ uri: item.track.uri, position }))
    .filter((entry) => removedUris.includes(entry.uri));
  const putBackRuns = consecutiveRuns(putBack);

  const keptOrder = target.filter((item) => currentUids.has(item.uid)).map((item) => item.uid);
  const moves = planMoves(working.map((item) => item.uid), keptOrder);

  const added = target
    .map((item, position) => ({ item, position }))
    .filter(({ item }) => !currentUids.has(item.uid))
    .map(({ item, position }) => ({ uri: item.track.uri, position }));
  const addRuns = consecutiveRuns(added);

  const removeChunks = chunk(removedUris, PAGE_SIZE);
  const total = removeChunks.length + putBackRuns.length + moves.length + addRuns.length;
  let done = 0;
  const step = () => onProgress(++done, total);

  for (const uris of removeChunks) {
    await callSpotify((api) => api.removeTracksFromPlaylist(playlistId, uris));
    step();
  }
  for (const run of putBackRuns) {
    await callSpotify((api) => api.addTracksToPlaylist(playlistId, run.uris, { position: run.position }));
    step();
  }
  for (const move of moves) {
    await callSpotify((api) => api.reorderTracksInPlaylist(playlistId, move.rangeStart, move.insertBefore));
    step();
  }
  for (const run of addRuns) {
    await callSpotify((api) => api.addTracksToPlaylist(playlistId, run.uris, { position: run.position }));
    step();
  }
  return total;
};
