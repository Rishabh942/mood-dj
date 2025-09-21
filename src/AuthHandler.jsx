// File: /api/callback.js
import axios from 'axios';
import querystring from 'querystring';


export default async function handler(req, res) {
  const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
  const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
  const { code } = req.body; // Authorization code sent by Spotify
  const data = querystring.stringify({
    code,
    redirect_uri: 'https://mood-j9zzxxqct-rishabh942s-projects.vercel.app/api/callback', // Match this with Spotify Dashboard
    grant_type: 'authorization_code',
  });

  const authHeader = `Basic ${Buffer.from(':CLIENT_SECRET').toString('base64')}`;

  try {
    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      data,
      { headers: { Authorization: authHeader } }
    );

    const accessToken = response.data.access_token;
    const refreshToken = response.data.refresh_token;

    res.status(200).json({ accessToken, refreshToken });
  } catch (error) {
    console.error('Error exchanging code for access token:', error);
    res.status(500).send('Authentication failed');
  }
}
