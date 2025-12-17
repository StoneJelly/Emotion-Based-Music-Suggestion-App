const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');

const SpotifyWebApi = require('spotify-web-api-node');

const Music = require('./model/music');

const app = express();
const port = 3000;

// Set up middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use('/models', express.static(path.join(__dirname, 'models')));

// Spotify credentials: you can hardcode your client id/secret here
// Replace the placeholder strings below with your actual credentials
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';

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
    // Refresh token shortly before expiry
    setTimeout(spotifyAuth, (data.body['expires_in'] - 60) * 1000);



// Route to add a new music track with song file upload
app.post('/addMusic', upload.single('songFile'), async (req, res) => {
  try {
    const { title, artist, duration, genre } = req.body;
    const filePath = req.file.path; // Get the file path of the uploaded song

    const music = new Music({ title, artist, duration, genre, filePath });
    await music.save();
    res.redirect('/');
  } catch (err) {
    res.status(500).send('Error adding the music track.');
=======
// Spotify credentials: you can hardcode your client id/secret here
// Replace the placeholder strings below with your actual credentials
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';

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
    // Refresh token shortly before expiry
    setTimeout(spotifyAuth, (data.body['expires_in'] - 60) * 1000);
  } catch (error) {
    console.error('Error authenticating with Spotify:', error);
  }
}

// Modified: Root route now redirects to the photo analysis page
app.get('/', (req, res) => {
  // Assuming the main entry point is now the emotion analysis
  res.redirect('/photo');
});

app.get('/photo', (req, res) => {
  res.render('photo'); // Renders the capture.ejs view
});

app.post('/analyzeEmotion', async (req, res) => {
  try {
    const { emotion } = req.body;

    // Map emotions to Spotify-friendly keywords/genres
    let query;
    switch (emotion) {
      case 'happy':
        query = 'happy';
        break;
      case 'neutral':
        query = 'chill';
        break;
      case 'angry':
        query = 'rock';
        break;
      case 'sad':
        query = 'sad';
        break;
      default:
        query = 'pop';
        break;
    }

    // Step 1: Get total number of tracks available for this genre
    const initialResponse = await spotifyApi.searchTracks(`genre:${query}`, { limit: 1 });
    const totalTracks = initialResponse.body.tracks.total;

    // Step 2: Pick a random offset for variety
    const offset = Math.floor(Math.random() * Math.max(totalTracks - 10, 1));

    // Step 3: Fetch 10 tracks starting from the random offset
    const spotifyResponse = await spotifyApi.searchTracks(`genre:${query}`, {
      limit: 10,
      offset,
    });

    const tracks = spotifyResponse.body.tracks.items;

    // Step 4: Shuffle tracks to maximize randomness
    const shuffledTracks = tracks.sort(() => Math.random() - 0.5);

    // Step 5: Map tracks to frontend-friendly format
    const songs = shuffledTracks
      .filter(track => track.preview_url || track.external_urls.spotify) // ensure at least preview or link exists
      .map(track => ({
        title: track.name,
        artist: track.artists.map(a => a.name).join(', '),
        genre: query,
        preview_url: track.preview_url, // 30-sec preview
        spotify_url: track.external_urls.spotify, // full track link
      }));

    console.log("Songs sent to frontend:", songs); // Debug log

    res.json(songs);
  } catch (err) {
    console.error('Error fetching Spotify tracks:', err);
    res.status(500).send('Error analyzing emotion.');
  }
});

async function dbconnection(){
  try {
    await mongoose.connect("mongodb+srv://mishabp9633:98Zqm6FuQBKv1sCw@shobhagold.pjuqog5.mongodb.net/music_player?retryWrites=true&w=majority")
    console.log("monogo db connecetd");
    
  } catch (error) {
    console.log("monogo db not connecttd");

    throw error
  }
}

dbconnection()

// Start the server
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

spotifyAuth();