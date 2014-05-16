#!/usr/bin/env node
/**
  Licensed to the Apache Software Foundation (ASF) under one
  or more contributor license agreements.  See the NOTICE file
  distributed with this work for additional information
  regarding copyright ownership.  The ASF licenses this file
  to you under the Apache License, Version 2.0 (the
  "License"); you may not use this file except in compliance
  with the License.  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing,
  software distributed under the License is distributed on an
  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, either express or implied.  See the License for the
  specific language governing permissions and limitations
  under the License.
 */

// System modules.
var fs = require('fs'),
    path = require('path'),
    Zip = require('node-zip'),
    request = require('request'),
    nopt = require('nopt'),
    url = require('url');

// Returns a promise for the manifest contents.
function getManifest(manifestDir) {
  var manifestFilename = path.join(manifestDir, 'manifest.json');
  var manifestMobileFilename = path.join(manifestDir, 'manifest.mobile.json');

  return Q.ninvoke(fs, 'readFile', manifestFilename, { encoding: 'utf-8' }).then(function(manifestData) {
    var manifestMobileData = '{}';
    return Q.ninvoke(fs, 'readFile', manifestMobileFilename, { encoding: 'utf-8' })
    .then(function(mobile) {
      manifestMobileData = mobile;
    }, function(err) {
      // Swallow any errors opening the mobile manifest, it's not required.
    }).then(function() {
      try {
        // jshint evil:true
        var manifest = eval('(' + manifestData + ')');
        var manifestMobile = eval('(' + manifestMobileData + ')');
        // jshint evil:false
        var extend = require('node.extend');
        manifest = extend(true, manifest, manifestMobile); // true -> deep recursive merge of these objects
        return manifest;
      } catch (e) {
        console.error(e);
        return Q.reject('Unable to parse manifest ' + manifestFilename);
      }
    });
  }, function(err) {
    return Q.reject('Unable to open manifest ' + manifestFilename + ' for reading.');
  });
}

function zipDir(zip, dir) {
  var contents = fs.readdirSync(dir);
  contents.forEach(function(f) {
    var fullPath = path.join(dir, f);
    if (fs.statSync(fullPath).isDirectory()) {
      var inner = zip.folder(f);
      zipDir(inner, path.join(dir, f));
    } else {
      zip.file(f, fs.readFileSync(fullPath, 'binary'), { binary: true });
    }
  });
}

// Takes a Node-style callback: function(err).
exports.push = function(target, dir, cb) {
  // Fetch the manifest so we can get the app's name for use in the push.
  var manifestPath;
  if (path.basename(dir) == 'manifest.json') {
    manifestPath = dir;
    dir = path.resolve(dir, '..');
  } else {
    manifestPath = path.join(dir, 'manifest.json');
  }

  // Read in the manifest.
  var manifestData = fs.readFileSync(manifestPath, { encoding: 'utf-8' });
  var manifest = eval('(' + manifestData + ')');

  var appName = manifest.name || 'CCA-push';

  // Build the zip object.
  var zip = new Zip();
  zipDir(zip, dir);

  var tempzip = zip.generate({ type: 'base64' });
  var zipContents = new Buffer(tempzip, 'base64');

  // Build the CRX data from the zip object.
  var crxContents = new Buffer(zipContents.length + 16);
  // Magic number
  crxContents[0] = 0x43; // C
  crxContents[1] = 0x72; // r
  crxContents[2] = 0x32; // 2
  crxContents[3] = 0x34; // 4
  // Version
  crxContents[4] = 2;
  // Zeroes (latter 3 bytes of the version, 4 bytes of key length, 4 bytes of signature length.
  for(var i = 5; i < 16; i++) {
    crxContents[i] = 0;
  }
  zipContents.copy(crxContents, 16);

  exports.info(target, function(e, res) {
    var req;
    if (e && e.statusCode == 404) {
      // Old-style HarnessPush.
      req = doRequest('POST', target, 'push', { type: 'crx', name: appName }, cb);
      req.form().append('file', crxContents, { filename: 'push.crx', contentType: 'application/octet-stream' });
    } else if (!e) {
      // New-style.
      req = doRequest('POST', target, 'push', { type: 'crx', name: appName }, cb, crxContents.length);
      req.write(crxContents);
    }
  });
}

function doRequest(method, target, action, queryParams, cb, contentLength) {
  var targetParts = target.split(':');
  var host = targetParts[0];
  var port = +(targetParts[1] || 2424);

  // Send the HTTP request. crxContents is a Node Buffer, which is the payload.
  // Prepare the form data for upload.
  var uri = url.format({
    protocol: 'http',
    hostname: host,
    port: port,
    pathname: '/' + action,
    query: queryParams
  });

  var headers = {};
  if (typeof contentLength != 'undefined') {
      headers['Content-Length'] = String(contentLength);
  }
  var req = request[method.toLowerCase()]({
    uri: uri,
    headers: headers
  }, cb);
  return req;
};

exports.info = function(target, cb) {
  function afterReq(err, res, body) {
    if (err) {
      err.statusCode = res.statusCode;
      cb(err);
    } else {
      try {
        cb(null, JSON.parse(body));
      } catch (e) {
        cb(e);
      }
    }
  }
  doRequest('GET', target, 'info', {}, afterReq);
};

exports.menu = function(target, cb) {
  doRequest('POST', target, 'menu', null, cb);
};

exports.eval = function(target, someJs, cb) {
  doRequest('POST', target, 'exec', { code: someJs }, cb);
};

function parseArgs(argv) {
    var opts = {
      'path': path,
      'help': Boolean,
      'menu': Boolean,
      'info': Boolean,
      'eval': String,
      'target': String
    };
    var ret = nopt(opts, null, argv);
    if (!ret.target) {
      ret.target = 'localhost:2424';
    }
    if (+!!ret.path + +!!ret.menu + +!!ret.eval + +!!ret.info !== 1) {
      usage();
    }
    return ret;
}

function usage() {
  console.log('Usage: cca-push --path=path/to/chrome_app --target=IP_ADDRESS:PORT');
  console.log('Usage: cca-push --menu');
  console.log('Usage: cca-push --eval "alert(1)"');
  console.log('Usage: cca-push --info');
  console.log();
  console.log('--target defaults to localhost:2424');
  console.log('To deploy to Android over USB, use: adb forward tcp:2424 tcp:2424');
  process.exit(1);
}

function main() {
  var args = parseArgs(process.argv);

  function cb(err, res, body) {
    if (err) {
      console.error(err);
    } else if (arguments.length == 2) {
      // info command.
      console.log(JSON.stringify(res, null, 4));
    } else if (body) {
      console.log(body);
    }
  }
  if (args.path) {
    exports.push(args.target, args.path, cb);
  } else if (args.menu) {
    exports.menu(args.target, cb);
  } else if (args.eval) {
    exports.eval(args.target, args.eval, cb);
  } else if (args.info) {
    exports.info(args.target, cb);
  }
}

if (require.main === module) {
  main();
}
