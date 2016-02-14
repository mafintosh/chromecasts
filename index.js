var castv2 = require('castv2-client')
var debug = require('debug')('chromecasts')
var events = require('events')
var get = require('simple-get')
var mdns = require('multicast-dns')
var mime = require('mime')
var parseString = require('xml2js').parseString

var SSDP
try {
  SSDP = require('node-ssdp').Client
} catch (err) {
  SSDP = null
}

var thunky = require('thunky')
var url = require('url')

var noop = function () {}
var toMap = function (url) {
  return typeof url === 'string' ? {url: url} : url
}
var toSubtitles = function (url, i) {
  if (typeof url !== 'string') return url
  return {
    trackId: i + 1,
    type: 'TEXT',
    trackContentId: url,
    trackContentType: 'text/vtt',
    name: 'English',
    language: 'en-US',
    subtype: 'SUBTITLES'
  }
}

module.exports = function () {
  var dns = mdns()
  var that = new events.EventEmitter()
  var casts = {}
  var ssdp = SSDP ? new SSDP({logLevel: process.env.DEBUG ? 'trace' : false}) : null

  that.players = []

  var emit = function (cst) {
    if (!cst || !cst.host || cst.emitted) return
    cst.emitted = true

    var player = new events.EventEmitter()

    var connect = thunky(function reconnect (cb) {
      var client = new castv2.Client()

      client.on('error', function (err) {
        player.emit('error', err)
      })

      client.on('close', function () {
        connect = thunky(reconnect)
      })

      client.client.on('close', function () {
        connect = thunky(reconnect)
      })

      client.connect(player.host, function (err) {
        if (err) return cb(err)
        player.emit('connect')

        client.getSessions(function (err, sess) {
          if (err) return cb(err)

          var session = sess[0]
          if (session && session.appId === castv2.DefaultMediaReceiver.APP_ID) {
            client.join(session, castv2.DefaultMediaReceiver, ready)
          } else {
            client.launch(castv2.DefaultMediaReceiver, ready)
          }
        })

        function ready (err, p) {
          if (err) return cb(err)

          player.emit('ready')

          p.on('close', function () {
            connect = thunky(reconnect)
          })

          p.on('status', function (status) {
            player.emit('status', status)
          })

          cb(null, p)
        }
      })
    })

    var connectClient = thunky(function reconnectClient (cb) {
      var client = new castv2.Client()

      client.on('error', function () {
        connectClient = thunky(reconnectClient)
      })

      client.on('close', function () {
        connectClient = thunky(reconnectClient)
      })

      client.connect(player.host, function (err) {
        if (err) return cb(err)
        cb(null, client)
      })
    })

    player.name = cst.name
    player.host = cst.host

    player.client = function (cb) {
      connectClient(cb)
    }

    player.chromecastStatus = function (cb) {
      connectClient(function (err, client) {
        if (err) return cb(err)
        client.getStatus(cb)
      })
    }

    player.play = function (url, opts, cb) {
      if (typeof opts === 'function') return player.play(url, null, opts)
      if (!opts) opts = {}
      if (!url) return player.resume(cb)
      if (!cb) cb = noop
      connect(function (err, p) {
        if (err) return cb(err)

        var media = {
          contentId: url,
          contentType: opts.type || mime.lookup(url, 'video/mp4'),
          streamType: opts.streamType || 'BUFFERED',
          tracks: [].concat(opts.subtitles || []).map(toSubtitles),
          metadata: opts.metadata || {
            type: 0,
            metadataType: 0,
            title: opts.title || '',
            images: [].concat(opts.images || []).map(toMap)
          }
        }

        var autoSubtitles = opts.autoSubtitles
        if (autoSubtitles === false) autoSubtitles = 0
        if (autoSubtitles === true) autoSubtitles = 1

        var playerOptions = {
          autoplay: opts.autoPlay !== false,
          currentTime: opts.seek,
          activeTrackIds: opts.subtitles && (autoSubtitles === 0 ? [] : [autoSubtitles || 1])
        }

        p.load(media, playerOptions, cb)
      })
    }

    player.resume = function (cb) {
      if (!cb) cb = noop
      connect(function (err, p) {
        if (err) return cb(err)
        p.play()
      })
    }

    player.pause = function (cb) {
      if (!cb) cb = noop
      connect(function (err, p) {
        if (err) return cb(err)
        p.pause(cb)
      })
    }

    player.stop = function (cb) {
      if (!cb) cb = noop
      connect(function (err, p) {
        if (err) return cb(err)
        p.stop(cb)
      })
    }

    player.status = function (cb) {
      connect(function (err, p) {
        if (err) return cb(err)
        p.getStatus(cb)
      })
    }

    player.subtitles = function (id, cb) {
      if (!cb) cb = noop
      connect(function (err, p) {
        if (err) return cb(err)

        player.request({
          type: 'EDIT_TRACKS_INFO',
          activeTrackIds: id ? [id === true ? 1 : id] : []
        }, cb)
      })
    }

    player.volume = function (vol, cb) {
      if (!cb) cb = noop
      connect(function (err, p) {
        if (err) return cb(err)

        player.request({
          type: 'SET_VOLUME',
          volume: vol === 0 ? { muted: true } : { level: vol }
        }, cb)
      })
    }

    player.request = function (data, cb) {
      if (!cb) cb = noop
      connect(function (err, p) {
        if (err) return cb(err)
        p.media.sessionRequest(data, cb)
      })
    }

    player.seek = function (time, cb) {
      if (!cb) cb = noop
      connect(function (err, p) {
        if (err) return cb(err)
        p.seek(time, cb)
      })
    }

    that.players.push(player)
    that.emit('update', player)
  }

  dns.on('response', function (response) {
    response.answers.forEach(function (a) {
      if (a.type === 'PTR' && a.name === '_googlecast._tcp.local') {
        var name = a.data.replace('._googlecast._tcp.local', '')
        if (!casts[name]) casts[name] = {name: name, host: null}
      }
    })

    var onanswer = function (a) {
      debug('got answer %j', a)

      var name = a.name.replace('.local', '')
      if (a.type === 'A' && casts[name] && !casts[name].host) {
        casts[name].host = a.data
        emit(casts[name])
      }
    }

    response.additionals.forEach(onanswer)
    response.answers.forEach(onanswer)
  })

  if (ssdp) {
    ssdp.on('response', function (headers, statusCode, info) {
      if (!headers.LOCATION) return

      get.concat(headers.LOCATION, function (err, res, body) {
        if (err) return
        parseString(body.toString(), {explicitArray: false, explicitRoot: false},
          function (err, service) {
            if (err) return
            if (!service.device) return
            if (service.device.manufacturer !== 'Google Inc.') return

            debug('device %j', service.device)

            var name = service.device.friendlyName

            if (!name) return

            var host = url.parse(service.URLBase).hostname

            if (!casts[name]) {
              casts[name] = {name: name, host: host}
              return emit(casts[name])
            }

            if (casts[name] && !casts[name].host) {
              casts[name].host = host
              emit(casts[name])
            }
          })
      })
    })
  }

  that.update = function () {
    debug('querying mdns and ssdp')
    if (ssdp) ssdp.search('urn:dial-multiscreen-org:device:dial:1')
    dns.query('_googlecast._tcp.local', 'PTR')
  }

  that.destroy = function () {
    dns.destroy()
  }

  that.update()

  return that
}
