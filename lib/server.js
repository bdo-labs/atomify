var st = require('st')
  , http = require('http')
  , path = require('path')
  , url = require('url')
  , fs = require('fs')
  , os = require('os')
  , js = require('atomify-js')
  , css = require('atomify-css')
  , cssFiles = require('atomify-css/css')
  , lessFiles = require('atomify-css/less')
  , open = require('open')
  , through = require('through')
  , tinylr = require('tiny-lr-fork')
  , gaze = require('gaze')
  , colors = require('colors')
  , browserSync = require('browser-sync')
  , defaultBundlePath = __dirname + '/_bundle.js'
  , baseUrl
  , snippet

module.exports = function (args) {

  console.log('')

  var hostname = args.server.hostname || args.server.h ? os.hostname() + '.local' : 'localhost'
  args.server.url = args.server.url || 'http://' + hostname + ':1337/default'

  var mount = st(args.server.st || { path: process.cwd(), cache: false })
    , parsedUrl = url.parse(args.server.url)
    , port = args.server.port || parsedUrl.port
    , serverPath = getNormalizedPath(args.server.path || parsedUrl.path)
    , lr = args.server.lr || args.server.l
    , launch = args.server.open || args.server.o

  if (args.server.sync || args.server.s) lr = {sync: true}

  // the router checks these, so they have to exist
  args.js = args.js || {}
  args.js.alias = getNormalizedPath(args.js.alias || args.js.entry)
  args.css = args.css || {}
  args.css.alias = getNormalizedPath(args.css.alias || args.css.entry)

  baseUrl = parsedUrl.protocol + '//' + parsedUrl.hostname

  if (lr) {
    // if live reloading, use watchify
    args.js.watch = true
    args.js.output = args.js.output || defaultBundlePath
    // listen for initial bundle completion before opening
    js(args.js).on('end', function () {
      if (launch) open(baseUrl + ':' + port + serverPath)
    })

    if (!lr.quiet) {
      js.emitter.on('changed', function (filepath) {
        console.log(path.relative(process.cwd(), filepath), 'changed'.grey);
      })

      js.emitter.on('bundle', function (time) {
        console.log(String('bundle updated in ' + time + 'ms').grey);
      })
    }

    lr = typeof lr === 'boolean' ? {} : lr
    lr.patterns = lr.patterns ? lr.patterns.concat(args.js.output) : ['*.html', '*.css', args.js.output]

    lr.port = lr.port || 3000
    lr.sync = parseSyncOptions(lr.sync || lr.s)

    if (port >= lr.port && port <= lr.port + 2) {
      throw new Error('Ports ' + lr.port + ' through ' + (lr.port + 2) + 'in use for Live Reload')
    }

    startFileWatch(lr)
    console.log(('Live reload server listening on port ' + lr.port).grey)

    browserSync = browserSync.init(lr.patterns, {
      proxy: {
        host: parsedUrl.hostname,
        port: port
      }
      , ports: {
        min: lr.port,
        max: lr.port + 2
      }
      , injectChanges: false
      , ghostMode: lr.sync
      , notify: Boolean(lr.sync)
      , debugInfo: Boolean(lr.verbose)
    }, function (err, config) {
      snippet = config.api.snippet;
    })
  }

  http.createServer(function (req, res) {

    switch (req.url.split('?')[0]) {
      case args.js.alias || args.js.entry:
        if (lr) {
          res.setHeader('Content-Type', 'text/javascript')
          res.end(fs.readFileSync(args.js.output, {encoding: 'utf8'}))
        } else {
          js(args.js, responder('javascript', res))
        }
        break

      case args.css.alias || args.css.entry:
        css(args.css, responder('css', res))
        break

      case '/default':
        serveDefaultPage(res, args, lr)
        break

      default:
        if (lr && req.url.substr(-5) === '.html') res.filter = injectSnippet(lr)
        mount(req, res)
        break
    }

  }).listen(port)

  console.log(('Atomify server listening on port ' + port).grey)
  console.log('')

  // if live reload is enabled we open after initial bundling
  if (launch && !lr) open(baseUrl + ':' + port + serverPath)
}

function responder (type, res) {
  return function (err, src) {
    if (err) console.log(err);

    if (!res.headersSent) res.setHeader('Content-Type', 'text/' + type)
    res.end(src)
  }
}

function startFileWatch (lr) {
  gaze(lr.patterns, function () {
    this.on('changed', function (filepath) {
      if (!lr.quiet && filepath !== defaultBundlePath) {
        console.log(path.relative(process.cwd(), filepath), 'changed'.grey)
      }
      browserSync.events.emit('file:changed', {path: filepath});
    })

    // add each file in dependency tree to watch list
    cssFiles.emitter.on('file', function (filename) {
      this.add(filename)
    }.bind(this))

    lessFiles.emitter.on('file', function (filename) {
      this.add(filename)
    }.bind(this))
  })
}

function injectSnippet (lr) {
  var buffer = ''

  return through(function (chunk) {
    buffer += chunk.toString()
  }, function () {
    this.queue(buffer.replace('</body>', snippet + '</body>'))
    this.queue(null)
  })
}

function serveDefaultPage (res, args, lr) {
  var src = '<!doctype html><html><head>'
  src += '<meta charset="utf-8">'
  src += '<meta http-equiv="X-UA-Compatible" content="IE=edge">'
  src += '<meta name="viewport" content="initial-scale=1,width=device-width,user-scalable=0,minimal-ui">'
  src += '<title>generated by atomify</title>'
  if (args.css.entry) src += '<link rel="stylesheet" href="CSS">'
  src += '</head><body>'
  src += '<script src="JS"></script>'
  src += '</body></html>'

  src = src.replace('JS', args.js.alias)
  src = src.replace('CSS', args.css.alias)

  res.setHeader('Content-Type', 'text/html')

  var thru = lr ? injectSnippet(lr) : through()
  thru.pipe(res)
  thru.write(src)
  thru.end('\n')
}

function parseSyncOptions (opts) {
  if (!opts) return false
  if (typeof opts === 'object') return opts

  return {
    clicks: true
    , location: true
    , forms: true
    , scroll: true
  }
}

function getNormalizedPath (pathStr) {
  if (!pathStr || pathStr.charAt(0) === '/') return pathStr

  return '/' + pathStr
}
