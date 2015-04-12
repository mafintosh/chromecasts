# chromecasts

Query your local network for Chromecasts and have them play media

```
npm install chromecasts
```

## Usage

``` js
var chromecasts = require('chromecasts')()

chromecasts.on('update', function (player) {
  console.log('all players: ', chromecasts.players)
  player.play('http://example.com/my-video.mp4', {title: 'my video', type: 'video/mp4'})
})
```

## API

#### `var list = chromecasts()`

Creates a chromecast list.
When creating a new list it will call `list.update()` once.
It is up to you to call afterwards incase you want to update the list.

#### `list.update()`

Updates the player list by querying the local network for chromecast instances.

#### `list.on('update', player)`

Emitted when a new player is found on the local network

#### `player.play(url, [opts], cb)`

Make the player play a url. Options include:

``` js
{
  title: 'My movie',
  type: 'video/mp4',
  seek: seconds, // start by seeking to this offset
  subtitles: ['http://example.com/sub.vtt'], // subtitle track 1,
  autoSubtitles: true // enable first track if you provide subs
}
```

#### `player.subtitles(track, [cb])`

Enable subtitle track. Use `player.subtitles(false)` to disable subtitles

#### `player.pause([cb])`

Make the player pause playback

#### `player.resume([cb])`

Resume playback

#### `player.stop([cb])`

Stop the playback

#### `player.seek(seconds, [cb])`

Seek the video

#### `player.status(cb)`

Get a status object of the current played video.

#### `player.on('status', status)`

Emitted when a status object is received.

## License

MIT
