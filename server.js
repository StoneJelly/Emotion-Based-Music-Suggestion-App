const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const SpotifyWebApi = require('spotify-web-api-node');

// --- FIREBASE CLIENT SDK SETUP ---
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyDqxcNDYtHwNvmrLcUJvGU5JKJUriyOuug",
  authDomain: "moodtune-4eb91.firebaseapp.com",
  projectId: "moodtune-4eb91",
  storageBucket: "moodtune-4eb91.firebasestorage.app",
  messagingSenderId: "525891194273",
  appId: "1:525891194273:web:96e45098f813f23e330fe0",
  measurementId: "G-KZV8M79YCP"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
// ----------------------------------

const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use('/models', express.static(path.join(__dirname, 'models')));

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '0b7cdbcd9614456798ab1816a2490600';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 'eddaccc6181c4d918accb82416b71fb7';

const spotifyApi = new SpotifyWebApi({
  clientId: SPOTIFY_CLIENT_ID,
  clientSecret: SPOTIFY_CLIENT_SECRET,
});

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

app.get('/', (req, res) => res.redirect('/photo'));
app.get('/photo', (req, res) => res.render('photo'));

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

    const spotifyResponse = await spotifyApi.searchTracks(`genre:${query}`, {
      limit: 10,
      offset,
    });

    const tracks = spotifyResponse.body.tracks.items;
    const songs = tracks
      .filter(track => track.preview_url || track.external_urls.spotify)
      .map(track => ({
        title: track.name,
        artist: track.artists.map(a => a.name).join(', '),
        genre: query,
        preview_url: track.preview_url,
        spotify_url: track.external_urls.spotify,
      }));

    try {
        await addDoc(collection(db, "history"), {
            emotion: emotion,
            timestamp: new Date().toISOString(),
            songCount: songs.length
        });
        console.log("Emotion log saved to Firebase");
    } catch (dbErr) {
        console.error("Firebase log failed:", dbErr.message);
    }

    res.json(songs);
  } catch (err) {
    console.error('Error fetching Spotify tracks:', err);
    res.status(500).send('Error analyzing emotion.');
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

spotifyAuth();