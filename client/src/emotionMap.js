export const EMOTION_TO_FEATURES = {
  happy:     { seed_genres: "pop,dance,edm", target_valence: 0.9, target_energy: 0.7, target_danceability: 0.8, min_tempo: 100 },
  sad:       { seed_genres: "acoustic,ambient,singer-songwriter", target_valence: 0.2, target_energy: 0.2, target_danceability: 0.3, min_tempo: 60 },
  angry:     { seed_genres: "metal,rock,hardstyle", target_valence: 0.3, target_energy: 0.9, target_danceability: 0.6, min_tempo: 120 },
  surprised: { seed_genres: "indie,electro,alternative", target_valence: 0.7, target_energy: 0.8, target_danceability: 0.7, min_tempo: 110 },
  fearful:   { seed_genres: "ambient,classical,soundtrack", target_valence: 0.2, target_energy: 0.3, target_danceability: 0.3, min_tempo: 60 },
  neutral:   { seed_genres: "chill,lo-fi,indie", target_valence: 0.5, target_energy: 0.5, target_danceability: 0.5, min_tempo: 90 },
  disgust:   { seed_genres: "punk,alt-rock,industrial", target_valence: 0.2, target_energy: 0.7, target_danceability: 0.4, min_tempo: 80 },
};
