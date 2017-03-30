
var mod_assert = require('assert-plus');
var mod_dashdash = require('dashdash');
var mod_fs = require('fs');
var mod_restify = require('restify-clients');
var mod_vasync = require('vasync');

var HTTPS = 'https://';
var PORT = ':9163';
var METRICS = '/metrics';
var DISCO = '/v1/discover';
var FETCH_INTERVAL_MS = 10 * 1000; /* 1000ms per second */

var options = [
    {
        name: 'version',
        type: 'bool',
        help: 'Print tool version and exit.'
    },
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Print this help and exit.'
    },
    {
        names: ['cert', 'c'],
        type: 'string',
        help: 'cert file path',
        helpArg: 'CERT'
    },
    {
        names: ['endpoint', 'e'],
        type: 'string',
        help: 'Container Monitor endpoint to pull from',
        helpArg: 'ENDPOINT'
    },
    {
        names: ['key', 'k'],
        type: 'string',
        help: 'key file path',
        helpArg: 'KEY'
    }
];

var parser = mod_dashdash.createParser({ options: options});

function _showHelp () {
    var help = parser.help({ includeEnv: true }).trimRight();
    console.log('usage: node index.js [OPTIONS]\noptions:\n' + help);
    process.exit(0);
}

try {
    var opts = parser.parse(process.argv);
} catch (e) {
    console.error('error: %s', e.message);
    process.exit(1);
}

if (opts.help) {
    console.log(opts);
    _showHelp();
} else if (opts.endpoint && opts.cert && opts.key) {
    var json_client = mod_restify.createJsonClient({
        url: HTTPS + opts.endpoint + PORT,
        rejectUnauthorized: false,
        cert: mod_fs.readFileSync(opts.cert),
        key: mod_fs.readFileSync(opts.key)
    });

    var str_client = mod_restify.createStringClient({
        url: HTTPS + opts.endpoint + PORT,
        rejectUnauthorized: false,
        cert: mod_fs.readFileSync(opts.cert),
        key: mod_fs.readFileSync(opts.key)
    });

    json_client.get(DISCO, function(err, req, res, obj) {
        mod_assert.ifError(err);
        var target_array = obj.containers;
        var targets = {};
        for (var i = 0; i < target_array.length; i++) {
            var target = target_array[i];
            var uuid = target.vm_uuid;
            var endpoint = opts.endpoint;
            var url = HTTPS + uuid + '.' + endpoint + PORT + METRICS;
            target.cmon_url = url;
            targets[uuid] = target;
        }

        var target_keys = Object.keys(targets);

        setInterval(function () {
            for (var j = 0; j < target_keys.length; j++) {
                var fetch_target = targets[target_keys[j]];

            }
        }, FETCH_INTERVAL_MS);
    });
} else {
    _showHelp();
}
