const mongoose = require('mongoose');

const musicSchema = new mongoose.Schema({
  title: { type: String, required: true },
  artist: { type: String, required: true },
  genre: { type: String },
  spotify_url: { type: String, required: true },
});

const Music = mongoose.model('Music', musicSchema);

module.exports = Music;
