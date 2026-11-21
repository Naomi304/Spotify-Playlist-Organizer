import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import SpotifyWebApi from 'spotify-web-api-js';

const spotifyApi = new SpotifyWebApi();

const CLIENT_ID = process.env.REACT_APP_SPOTIFY_CLIENT_ID; // set in .env.local
const REDIRECT_URI = process.env.REACT_APP_SPOTIFY_REDIRECT_URI;
const SCOPES = 'playlist-read-private playlist-read-collaborative';
const CODE_VERIFIER_KEY = 'spotify_code_verifier';

// Login uses the Authorization Code flow with PKCE, so no client secret is
// ever needed in the browser. Instead, each login creates a random "code
// verifier", sends its SHA-256 hash to Spotify, and later proves it started
// the login by sending the original verifier.
const base64UrlEncode = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const generateCodeVerifier = () =>
  base64UrlEncode(crypto.getRandomValues(new Uint8Array(64)));

const generateCodeChallenge = async (codeVerifier) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return base64UrlEncode(new Uint8Array(digest));
};

// Exchanges a login code or a refresh token for a new access token
const requestToken = async (params) => {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error);
  }
  return data;
};

const SpotifyLogin = () => {
  const [authToken, setAuthToken] = useState('');
  const [playlists, setPlaylists] = useState([]);
  const refreshTokenRef = useRef('');  // Not shown on screen, so a ref avoids extra re-renders

  const handleAuth = async () => {
    const codeVerifier = generateCodeVerifier();
    window.localStorage.setItem(CODE_VERIFIER_KEY, codeVerifier);  // Needed again after Spotify redirects back

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      code_challenge_method: 'S256',
      code_challenge: await generateCodeChallenge(codeVerifier),
    });
    window.location.href = `https://accounts.spotify.com/authorize?${params}`;
  };

  const saveTokens = useCallback((data) => {
    spotifyApi.setAccessToken(data.access_token);
    setAuthToken(data.access_token);
    // Spotify may send a new refresh token; if it doesn't, keep using the old one
    if (data.refresh_token) {
      refreshTokenRef.current = data.refresh_token;
    }
  }, []);

  const fetchPlaylists = useCallback(async () => {
    try {
      const playlistsResponse = await spotifyApi.getUserPlaylists();
      setPlaylists(playlistsResponse.items); // Update playlists state with fetched data
    } catch (error) {
      if (error.status !== 401 || !refreshTokenRef.current) {
        console.error('Error fetching playlists:', error);
        return;
      }

      // Access tokens expire after an hour, so get a new one and try once more
      try {
        saveTokens(await requestToken({
          grant_type: 'refresh_token',
          refresh_token: refreshTokenRef.current,
        }));
        const playlistsResponse = await spotifyApi.getUserPlaylists();
        setPlaylists(playlistsResponse.items);
      } catch (retryError) {
        console.error('Error refreshing token:', retryError);
      }
    }
  }, [saveTokens]);

  useEffect(() => {
    // After login, Spotify redirects back here with ?code=... in the URL
    const code = new URLSearchParams(window.location.search).get('code');
    if (!code) {
      return;
    }

    // Remove the code from the address bar so refreshing the page doesn't reuse it
    window.history.replaceState({}, document.title, window.location.pathname);
    const codeVerifier = window.localStorage.getItem(CODE_VERIFIER_KEY);
    window.localStorage.removeItem(CODE_VERIFIER_KEY);

    requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    })
      .then((data) => {
        saveTokens(data);
        return fetchPlaylists();
      })
      .catch((error) => console.error('Error logging in:', error));
  }, [saveTokens, fetchPlaylists]);

  return (
    <div className="App">
      <h1>Spotify Playlist Manager</h1>
      {!authToken ? (
        <button onClick={handleAuth}>Log in with Spotify</button>
      ) : (
        <div>
          <h3>Your Playlists</h3>
          {playlists.length > 0 ? (
            <ul>
              {playlists.map((playlist) => (
                <li key={playlist.id}>
                  <h4>{playlist.name}</h4>
                </li>
              ))}
            </ul>
          ) : (
            <p>Loading ahhhh...</p>
          )}
        </div>
      )}
    </div>
  );
};

export default SpotifyLogin;



/*

 const [selectedTrack, setSelectedTrack] = useState(null);
  const [newPosition, setNewPosition] = useState('');

 // Fetch tracks in playlist
 const fetchTracks = async (playlistId) => {
  try {
    const data = await spotifyApi.getPlaylistTracks(playlistId);
    return data.items;
  } catch (error) {
    console.error('Error fetching tracks:', error);
  }
};

  useEffect(() => {
    // Get access token from the URL
    const hash = window.location.hash;
    let authToken = window.localStorage.getItem('spotify_auth_token');
  
    if (!authToken && hash) {
      const urlParams = new URLSearchParams(window.location.hash.replace('#', '?'));
      authToken = urlParams.get('access_token');
      window.localStorage.setItem('spotify_auth_token', authToken); // Save token in local storage
    }
  
    if (authToken) {
      spotifyApi.setAccessToken(authToken);
      setAuthToken(authToken); 
      fetchPlaylists(authToken); // Fetch playlists after authentication
    }
  }, []);
 


  // Track reordering
  const handleReorder = async (playlistId, trackIndex, newPosition) => {
    try {
      const tracks = await fetchTracks(playlistId);
      if (newPosition < 1 || newPosition > tracks.length) {
        alert('Invalid position');
        return;
      }

      const rangeStart = trackIndex;
      const rangeLength = 1;
      const insertBefore = newPosition - 1;

      // Link Spotify API
      await spotifyApi.reorderTracksInPlaylist(playlistId, rangeStart, rangeLength, insertBefore);
      alert(`Moved track to position ${newPosition}`);

      // Re-fetch the updated playlist to reflect the changes
      const updatedTracks = await fetchTracks(playlistId);
      setPlaylists((prevPlaylists) =>
        prevPlaylists.map((playlist) =>
          playlist.id === playlistId ? { ...playlist, tracks: updatedTracks } : playlist
        )
      );
    } catch (error) {
      console.error('Error reordering track:', error);
    }
  };
 */