import React from 'react';
import axios from 'axios';

const App = () => {
  const [accessToken, setAccessToken] = useState(null);
  const [error, setError] = useState(null);

  const handleLogin = async () => {
    const clientId = process.env.REACT_APP_SPOTIFY_CLIENT_ID;
    const redirectUri = 'https://mood-j9zzxxqct-rishabh942s-projects.vercel.app/api/callback';
    const scope = 'user-library-read user-read-private'; // Add desired scopes here
    console.log("test" + clientId);
    // Step 1: Redirect to Spotify Authorization URL
    const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&response_type=token&show_dialog`;
    window.location.href = authUrl;
  };
//https://accounts.spotify.com/authorize?response_type=code&client_id=${2bac9dd24bf34179a1bea64d22e9ff07}&redirect_uri=${encodeURIComponent(https://mood-j9zzxxqct-rishabh942s-projects.vercel.app/api/callback}&scope=${encodeURIComponent(user-library-read user-read-private)}&response_type=token&show_dialog)
  const handleSpotifyCallback = async (code) => {
    try {
      // Step 2: Exchange code for access token
      const response = await axios.post('/api/callback', { code });
      const { accessToken, refreshToken } = response.data;

      setAccessToken(accessToken);
      // Store refreshToken securely if needed for token refreshing
    } catch (error) {
      setError('Error during authentication');
      console.error(error);
    }
  };

  // Step 3: Handle Spotify callback by getting the code from URL params
  React.useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code) {
      handleSpotifyCallback(code);
    }
  }, []);

  return (
    <div>
      <h1>Spotify Login</h1>
      {!accessToken ? (
        <button onClick={handleLogin}>Login with Spotify</button>
      ) : (
        <div>
          <h2>Authenticated!</h2>
          <p>Access Token: {accessToken}</p>
        </div>
      )}
      {error && <p>{error}</p>}
    </div>
  );
};

export default App;
