// Radio stations, by frequency.
//
// A station is a folder of audio files on the machine that runs the stack.
// The stack seeds it as one torrent named after its frequency (see
// compose.yaml, and STATION_59_1 in .env: a dot is an underscore) and serves the same folder as a web
// seed. There is no track list to keep here: the browser reads the tracks
// from the torrent, using the folder's file names.
//
//   01 - Leviathan Hunter.mp3            a track, "Leviathan Hunter"
//   01 - Leviathan Hunter - cover.png    an extra of that track, "cover"
//
// mode: 'shuffle' plays the tracks in a random order; 'normal', in file
// order. artist defaults to 'Various Artists'.

export default {
    '59.1': {
        name: '59 Songs You MUST Hear Before You Die!',
        artist: 'Toehider',
        mode: 'shuffle'
    }
}
