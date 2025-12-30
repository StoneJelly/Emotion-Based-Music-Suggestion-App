const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const path = require('path');
const SpotifyWebApi = require('spotify-web-api-node');
const cors = require('cors'); // added for Angular API calls

const Music = require('./model/music');
const serviceAccount = require('./serviceAccountKey.json');

const app = express();
const port = 3000;

// Initialize Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// --- Middleware ---
app.use(cors()); // optional: allows Angular frontend to call APIs
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use('/models', express.static(path.join(__dirname, 'models')));

// --- Spotify setup ---
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '0b7cdbcd9614456798ab1816a2490600';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'eddaccc6181c4d918accb82416b71fb7';

const spotifyApi = new SpotifyWebApi({
  clientId: SPOTIFY_CLIENT_ID,
  clientSecret: SPOTIFY_CLIENT_SECRET,
});

if (SPOTIFY_CLIENT_ID.startsWith('YOUR_') || SPOTIFY_CLIENT_SECRET.startsWith('YOUR_')) {
  console.warn('Warning: Spotify client ID/secret are using placeholder values in server.js. Replace them with real credentials.');
}

async function spotifyAuth() {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body['access_token']);
    console.log('Spotify access token acquired');
    setTimeout(spotifyAuth, (data.body['expires_in'] - 60) * 1000);
  } catch (error) {
    console.error('Error authenticating with Spotify:', error);
  }
}

// --- Routes ---

// Root route now redirects to /photo
app.get('/', (req, res) => {
  res.redirect('/photo');
});

// New route to serve photo.ejs for Angular iframe
app.get('/photo', (req, res) => {
  res.render('photo'); // your face/hand detection EJS page
});

// Existing emotion analysis route
app.post('/analyzeEmotion', async (req, res) => {
  try {
    const { emotion } = req.body;

    let query;
    switch (emotion) {
      case 'happy': query = 'happy'; break;
      case 'neutral': query = 'chill'; break;
      case 'angry': query = 'rock'; break;
      case 'sad': query = 'sad'; break;
      default: query = 'pop'; break;
    }

    const initialResponse = await spotifyApi.searchTracks(`genre:${query}`, { limit: 1 });
    const totalTracks = initialResponse.body.tracks.total;
    const offset = Math.floor(Math.random() * Math.max(totalTracks - 10, 1));
    const spotifyResponse = await spotifyApi.searchTracks(`genre:${query}`, { limit: 10, offset });

    const tracks = spotifyResponse.body.tracks.items;
    const shuffledTracks = tracks.sort(() => Math.random() - 0.5);

    const songs = shuffledTracks
      .filter(track => track.preview_url || track.external_urls.spotify)
      .map(track => ({
        title: track.name,
        artist: track.artists.map(a => a.name).join(', '),
        genre: query,
        preview_url: track.preview_url,
        spotify_url: track.external_urls.spotify,
      }));

    console.log("Songs sent to frontend:", songs);
    res.json(songs);
  } catch (err) {
    console.error('Error fetching Spotify tracks:', err);
    res.status(500).send('Error analyzing emotion.');
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

spotifyAuth();
