var events = require('events')
var mdns = require('multicast-dns')
var thunky = require('thunky')
var castv2 = require('castv2-client')

var noop = function () {}
var toMap = function (url) {
  return typeof url === 'string' ? {url: url} : url
}

module.exports = function () {
  var dns = mdns()
  var that = new events.EventEmitter()
  var casts = {}

  that.players = []

  var emit = function (cst) {
    if (!cst || !cst.host || cst.emitted) return
    cst.emitted = true

    var player = new events.EventEmitter()

    var connect = thunky(function reconnect(cb) {
      var client = new castv2.Client()

      client.on('error', function (err) {
        player.emit('error', err)
      })

      client.on('close', function () {
        connect = thunky(reconnect)
      })

      client.connect(player.host, function (err) {
        if (err) return cb(err)
        player.emit('connect')
        client.launch(castv2.DefaultMediaReceiver, function (err, p) {
          if (err) return cb(err)

          player.emit('ready')
          p.on('status', function (status) {
            player.emit('status', status)
          })

          cb(null, p)
        })
      })
    })

    player.name = cst.name
    player.host = cst.host

    player.play = function (url, opts, cb) {
      if (typeof opts === 'function') return player.play(url, null, opts)
      if (!url) return player.resume(cb)
      if (!cb) cb = noop
      connect(function (err, p) {
        if (err) return cb(err)

        var media = {
          contentId: url,
          contentType: opts.type || 'video/mp4',
          streamType: opts.streamType || 'BUFFERED',
          metadata: opts.metadata || {
            type: 0,
            metadataType: 0,
            title: opts.title || '',
            images: [].concat(opts.images).map(toMap)
          }
        }

        p.load(media, { autoplay: true, currentTime: opts.seek }, cb)
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
      if (a.type === 'PTR' || a.name === '_googlecast._tcp.local') {
        var name = a.data.replace('._googlecast._tcp.local', '')
        if (!casts[name]) casts[name] = {name: name, host: null}
      }
    })

    var onanswer = function (a) {
      var name = a.name.replace('.local', '')
      if (a.type === 'A' && casts[name] && !casts[name].host) {
        casts[name].host = a.data
        emit(casts[name])
      }
    }

    response.additionals.forEach(onanswer)
    response.answers.forEach(onanswer)
  })

  dns.on('query', function (q) {
    dns.response({
      answers: [{type: 'PTR', name: '_googlecast._tcp.local', data: 'john.g'}]
    })
  })

  that.update = function () {
    dns.query('_googlecast._tcp.local', 'PTR')
  }

  that.destroy = function () {
    dns.destroy()
  }

  that.update()

  return that
}