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
module.exports.push = function(dir, target, cb) {
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

  // Send the HTTP request. crxContents is a Node Buffer, which is the payload.
  // Prepare the form data for upload.
  var uri = url.format({
    protocol: 'http',
    hostname: target,
    port: 2424,
    pathname: '/push',
    query: { type: 'crx', name: appName }
  });

  var req = request.post({
    uri: uri,
    method: 'POST'
  }, function(err, res, body) {
    if (err) cb(err);
    else {
      console.log(body);
      cb(null);
    }
  });
  req.form().append("file", crxContents, { filename: 'push.crx', contentType: 'application/octet-stream' });
};


function main() {
  if (process.argv.length < 4) {
    console.log('Usage: cca-push path/to/app IP_ADDRESS');
    process.exit(1);
  }
  var dir = process.argv[2];
  var target = process.argv[3];

  module.exports.push(dir, target, function(err) {
    if (err) console.error(err);
  });
}

if (require.main === module) {
  main();
}
