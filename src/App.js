import React, { useState, useEffect } from 'react';
import './App.css';
import SpotifyWebApi from 'spotify-web-api-js';

const spotifyApi = new SpotifyWebApi();



const SpotifyLogin = () => {
  const [authToken, setAuthToken] = useState('');
  const [playlists, setPlaylists] = useState([]);
  const [refreshToken, setRefreshToken] = useState('');  // Store the refresh token

  const CLIENT_ID = process.env.REACT_APP_SPOTIFY_CLIENT_ID;//key in .env file 
  const REDIRECT_URI = process.env.REACT_APP_SPOTIFY_REDIRECT_URI;

  const handleAuth = () => {
    console.log('Triggering Spotify login');
    const AUTH_URL = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=token&redirect_uri=${REDIRECT_URI}&scope=playlist-read-private playlist-read-collaborative`;
    window.location.href = AUTH_URL;
  };

  const fetchPlaylists = async () => {
    try {
      console.log('Fetching playlists with token:', authToken);  // Debug log
      const playlistsResponse = await spotifyApi.getUserPlaylists();
      console.log('Fetched playlists response:', playlistsResponse); // Debug log
      setPlaylists(playlistsResponse.items); // Update playlists state with fetched data
    } catch (error) {
      console.error('Error fetching playlists:', error);
      if (error.status === 401 && refreshToken) {
        // If token expired, try refreshing the token
        await refreshAccessToken();
      }
    }
  };

  const refreshAccessToken = async () => {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);
    params.append('client_id', 'your_client_id');  // Replace with your Spotify Client ID
    params.append('client_secret', 'your_client_secret');  // Replace with your Spotify Client Secret

    try {
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      });

      const data = await response.json();
      if (data.access_token) {
        console.log('New access token:', data.access_token);
        spotifyApi.setAccessToken(data.access_token);
        window.localStorage.setItem('spotify_auth_token', data.access_token);  // Save new access token
        setAuthToken(data.access_token);
        fetchPlaylists();  // Retry fetching playlists
      } else {
        console.error('Error refreshing token:', data);
      }
    } catch (error) {
      console.error('Error refreshing token:', error);
    }
  };

  useEffect(() => {

    window.localStorage.removeItem('spotify_auth_token');

    // Check for token in the URL after redirect
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash.includes('access_token')) {
        const urlParams = new URLSearchParams(hash.replace('#', '?'));
        const newAuthToken = urlParams.get('access_token');
        const newRefreshToken = urlParams.get('refresh_token');  // Get the refresh token
        setAuthToken(newAuthToken);
        setRefreshToken(newRefreshToken);  // Store the refresh token
        window.localStorage.setItem('spotify_auth_token', newAuthToken);  // Save access token in local storage
        spotifyApi.setAccessToken(newAuthToken);
        fetchPlaylists();
      }
    };

    // Check if token exists in URL (after redirect from Spotify)
    const hash = window.location.hash;
    if (hash) {
      handleHashChange();
    } else {
      // If no token in URL, show login button
      setAuthToken('');
    }
    

    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [authToken]);

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