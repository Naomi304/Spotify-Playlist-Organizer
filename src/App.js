import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import SpotifyWebApi from 'spotify-web-api-js';
import MusicBackground from './MusicBackground';
import PlaylistView from './PlaylistView';
import { fetchAllPlaylists } from './spotifySync';

const spotifyApi = new SpotifyWebApi();

const CLIENT_ID = process.env.REACT_APP_SPOTIFY_CLIENT_ID; // set in .env.local
const REDIRECT_URI = process.env.REACT_APP_SPOTIFY_REDIRECT_URI;
const SCOPES = 'playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public';
const CODE_VERIFIER_KEY = 'spotify_code_verifier';
const REFRESH_TOKEN_KEY = 'spotify_refresh_token';

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

// Waits before retrying when Spotify says we're sending requests too fast
const wait = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

// Which playlist is open is kept in the address bar (?playlist=...), so the
// browser's back button and refreshing the page both work
const playlistIdFromUrl = () => new URLSearchParams(window.location.search).get('playlist');

const SpotifyLogin = () => {
  const [authToken, setAuthToken] = useState('');
  const [playlists, setPlaylists] = useState(null);  // null while loading
  const [selectedId, setSelectedId] = useState(playlistIdFromUrl);
  const [userId, setUserId] = useState('');
  // True while a saved login is being checked, so the login button doesn't flash up
  const [restoring, setRestoring] = useState(() => Boolean(window.localStorage.getItem(REFRESH_TOKEN_KEY)));
  const refreshTokenRef = useRef('');  // Not shown on screen, so a ref avoids extra re-renders
  // React runs startup effects twice in development; a saved login can only be used once
  const loginStartedRef = useRef(false);

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
    // Spotify may send a new refresh token; if it doesn't, keep using the old one.
    // It's saved so you stay logged in after refreshing the page.
    if (data.refresh_token) {
      refreshTokenRef.current = data.refresh_token;
      window.localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
    }
  }, []);

  const handleLogout = () => {
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    refreshTokenRef.current = '';
    spotifyApi.setAccessToken(null);
    setAuthToken('');
    setPlaylists(null);
    setSelectedId(null);
    window.history.replaceState({}, document.title, window.location.pathname);
  };

  // Runs a Spotify request, e.g. callSpotify((api) => api.getMe()).
  // Access tokens expire after an hour, so on a 401 it gets a new one and tries again.
  // If Spotify says to slow down (429), it waits as long as Spotify asks.
  const callSpotify = useCallback(async (request) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await request(spotifyApi);
      } catch (error) {
        if (attempt >= 4) {
          throw error;
        }
        if (error.status === 429) {
          await wait(Number(error.getResponseHeader?.('Retry-After')) || 1);
        } else if (error.status === 401 && refreshTokenRef.current && attempt === 1) {
          saveTokens(await requestToken({
            grant_type: 'refresh_token',
            refresh_token: refreshTokenRef.current,
          }));
        } else {
          throw error;
        }
      }
    }
  }, [saveTokens]);

  const fetchPlaylists = useCallback(async () => {
    try {
      const [me, allPlaylists] = await Promise.all([
        callSpotify((api) => api.getMe()),
        fetchAllPlaylists(callSpotify),
      ]);
      setUserId(me.id);
      setPlaylists(allPlaylists);
    } catch (error) {
      console.error('Error fetching playlists:', error);
      setPlaylists((current) => current || []);
    }
  }, [callSpotify]);

  const openPlaylist = useCallback((playlistId) => {
    window.history.pushState({}, '', `${window.location.pathname}?playlist=${playlistId}`);
    setSelectedId(playlistId);
    window.scrollTo(0, 0);
  }, []);

  const closePlaylist = () => {
    window.history.pushState({}, '', window.location.pathname);
    setSelectedId(null);
  };

  useEffect(() => {
    const handleBackOrForward = () => setSelectedId(playlistIdFromUrl());
    window.addEventListener('popstate', handleBackOrForward);
    return () => window.removeEventListener('popstate', handleBackOrForward);
  }, []);

  useEffect(() => {
    // After login, Spotify redirects back here with ?code=... in the URL
    const code = new URLSearchParams(window.location.search).get('code');
    const savedRefreshToken = window.localStorage.getItem(REFRESH_TOKEN_KEY);
    if (loginStartedRef.current || (!code && !savedRefreshToken)) {
      return;
    }
    loginStartedRef.current = true;

    let login;
    if (code) {
      // Remove the code from the address bar so refreshing the page doesn't reuse it
      window.history.replaceState({}, document.title, window.location.pathname);
      const codeVerifier = window.localStorage.getItem(CODE_VERIFIER_KEY);
      window.localStorage.removeItem(CODE_VERIFIER_KEY);
      login = requestToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      });
    } else {
      login = requestToken({ grant_type: 'refresh_token', refresh_token: savedRefreshToken });
    }

    login
      .then((data) => {
        saveTokens(data);
        return fetchPlaylists();
      })
      .catch((error) => {
        console.error('Error logging in:', error);
        window.localStorage.removeItem(REFRESH_TOKEN_KEY);  // The saved login no longer works
      })
      .finally(() => setRestoring(false));
  }, [saveTokens, fetchPlaylists]);

  const selectedPlaylist = playlists?.find((playlist) => playlist.id === selectedId);

  const loading = (
    <p className="loading" role="status">
      <span className="equalizer" aria-hidden="true"><span /><span /><span /></span>
      Loading ahhhh...
    </p>
  );

  let page;
  if (!authToken) {
    page = restoring ? (
      <section className="card login-card">{loading}</section>
    ) : (
      <section className="card login-card">
        <p>Connect your Spotify account to see your playlists.</p>
        <button className="login-button" onClick={handleAuth}>Log in with Spotify</button>
      </section>
    );
  } else if (selectedId && !playlists) {
    page = <section className="card">{loading}</section>;
  } else if (selectedId && !selectedPlaylist) {
    page = (
      <section className="card playlist-view">
        <button className="back-button" onClick={closePlaylist}>← All playlists</button>
        <p className="playlist-note">That playlist isn't in your library.</p>
      </section>
    );
  } else if (selectedPlaylist) {
    page = (
      <PlaylistView
        key={selectedPlaylist.id}
        playlist={selectedPlaylist}
        playlists={playlists}
        userId={userId}
        callSpotify={callSpotify}
        onBack={closePlaylist}
        onOpenPlaylist={openPlaylist}
        onPlaylistsChanged={fetchPlaylists}
      />
    );
  } else {
    page = (
      <section className="card">
        <h2 className="section-title">Your Playlists</h2>
        {!playlists ? loading : playlists.length === 0 ? (
          <p className="playlist-note">You don't have any playlists yet.</p>
        ) : (
          <ul className="playlist-grid">
            {playlists.map((playlist) => {
              const cover = playlist.images?.[0]?.url;
              const trackCount = playlist.tracks?.total;
              return (
                <li key={playlist.id}>
                  <button className="playlist-card" onClick={() => openPlaylist(playlist.id)}>
                    {cover ? (
                      <img className="playlist-cover" src={cover} alt="" loading="lazy" />
                    ) : (
                      <span className="playlist-cover playlist-cover--empty" aria-hidden="true">♪</span>
                    )}
                    <span className="playlist-name" title={playlist.name}>{playlist.name}</span>
                    {trackCount !== undefined && (
                      <span className="playlist-meta">{trackCount} {trackCount === 1 ? 'track' : 'tracks'}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className="App">
      <MusicBackground />
      <main className="content">
        {authToken && (
          <button className="logout-button" onClick={handleLogout}>Log out</button>
        )}
        <header className="hero">
          <h1 className="title">
            Spotify Playlist <span className="title-accent">Organizer</span>
          </h1>
          <p className="tagline">Bring some order to your playlists.</p>
        </header>

        {page}
      </main>
    </div>
  );
};

export default SpotifyLogin;
