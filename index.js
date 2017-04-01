var mod_assert = require('assert-plus');
var mod_clc = require('cli-color');
var mod_clui = require('clui');
var mod_dashdash = require('dashdash');
var mod_fs = require('fs');
var mod_jsprim = require('jsprim');
var mod_restify = require('restify-clients');
var mod_vasync = require('vasync');

var HTTPS = 'https://';
var PORT = ':9163';
var METRICS = '/metrics';
var DISCO = '/v1/discover';
var FETCH_INTERVAL_MS = 10 * 1000; /* 1000ms per second */
var REFRESH_INTERVAL_MS = 300 * 1000; /* 1000ms per second */

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

var draw_timeout, opts, json_client;
var parser = mod_dashdash.createParser({ options: options});
var targets = {};

function _showHelp () {
    var help = parser.help({ includeEnv: true }).trimRight();
    console.log('usage: node index.js [OPTIONS]\noptions:\n' + help);
    process.exit(0);
}

try {
    opts = parser.parse(process.argv);
} catch (e) {
    console.error('error: %s', e.message);
    process.exit(1);
}

if (opts.help) {
    _showHelp();
} else if (opts.endpoint && opts.cert && opts.key) {
    paint();
} else {
    _showHelp();
}

function paint() {
    mod_vasync.pipeline({
        'funcs': [
            function createClients(arg, next) {
                json_client = mod_restify.createJsonClient({
                    url: HTTPS + opts.endpoint + PORT,
                    rejectUnauthorized: false,
                    cert: mod_fs.readFileSync(opts.cert),
                    key: mod_fs.readFileSync(opts.key)
                });

                next();
            },
            function initialRefresh(arg, next) {
                refreshTargets(next);
            },
            function initialMetrics(arg, next) {
                fetchAllMetrics(next);
            },
            function showStuff(arg, next) {
                draw();
                next();
            }
        ]
    }, function _p(p_err, result) {
        mod_assert.ifError(p_err);
    });

    setTimeout(paint, 11000);
}

function draw() {
    console.log(mod_clc.reset);

    var zkeys = Object.keys(targets);
    var gauge = mod_clui.Gauge;
    var line = mod_clui.Line;

    var mem_used = 0;
    var mem_limit = 0;
    var swap_used = 0;
    var swap_limit = 0;
    var zfs_used = 0;
    var zfs_avail = 0;

    var zone_stats = [];

    for (var z = 0; z < zkeys.length; z++) {
        var key = zkeys[z];
        var cur_metrics = targets[key].cur_metrics;
        var last_metrics = targets[key].last_metrics;

        var stats = {
            alias: targets[key].vm_alias,
            mem_use: cur_metrics['mem_agg_usage'].value,
            mem_lim: cur_metrics['mem_limit'].value,
            swp_use: cur_metrics['mem_swap'].value,
            swp_lim: cur_metrics['mem_swap_limit'].value,
            zfs_use: cur_metrics['zfs_used'].value,
            zfs_av: cur_metrics['zfs_available'].value
        };

        zone_stats.push(stats);

        /* Total Memory Calculation */
        var mu_inst = stats.mem_use;
        var ml_inst = stats.mem_lim;
        mem_used += (((mu_inst / 1000) / 1000) / 1000);
        mem_limit += (((ml_inst / 1000) / 1000) / 1000);

        /* Total Swap Calculation */
        var su_inst = stats.swp_use;
        var sl_inst = stats.swp_lim;
        swap_used += (((su_inst / 1000) / 1000) / 1000);
        swap_limit += (((sl_inst / 1000) / 1000) / 1000);
        
        /* Total Swap Calculation */
        var zu_inst = stats.zfs_use;
        var za_inst = stats.zfs_av;
        zfs_used += (((zu_inst / 1000) / 1000) / 1000);
        zfs_avail += (((za_inst / 1000) / 1000) / 1000);
    }

    var GB = ' GB';
    var blank_line = new line().fill().output();

    /* Memory Totals Output */
    var mem_danger = mem_limit * 0.8;
    var mem_lim_human = mem_limit.toFixed(2) + GB
    var mem_human = mem_used.toFixed(2) + ' / ' + mem_lim_human;
    var mem_gauge = gauge(
        mem_used,
        mem_limit,
        20,
        mem_danger,
        mem_human);

    var mem_line = new line();
    mem_line.padding(2);
    mem_line.column('Total Memory Use', 20, [mod_clc.cyan]);
    mem_line.column(mem_gauge);
    mem_line.fill();
    mem_line.output();

    /* Swap Totals Output */
    var swap_danger = swap_limit * 0.8;
    var swap_lim_human = swap_limit.toFixed(2) + GB;
    var swap_human = swap_used.toFixed(2) + ' / ' + swap_lim_human;
    var swap_gauge = gauge(
        swap_used,
        swap_limit,
        20,
        swap_danger,
        swap_human);

    var swap_line = new line();
    swap_line.padding(2);
    swap_line.column('Total Swap Use', 20, [mod_clc.cyan]);
    swap_line.column(swap_gauge);
    swap_line.fill();
    swap_line.output();

    /* Swap Totals Output */
    var zfs_limit = (zfs_used + zfs_avail).toFixed(2);
    var zfs_lim_human = zfs_limit + GB;
    var zfs_danger = zfs_limit * 0.8;
    var zfs_human = zfs_used.toFixed(2) + ' / ' + zfs_lim_human;
    var zfs_gauge = gauge(
        zfs_used,
        zfs_limit,
        20,
        zfs_danger,
        zfs_human);

    var zfs_line = new line();
    zfs_line.padding(2);
    zfs_line.column('Total ZFS use', 20, [mod_clc.cyan]);
    zfs_line.column(zfs_gauge);
    zfs_line.fill();
    zfs_line.output();

    blank_line.output();

    var zone_col_names = new line();
    zone_col_names.padding(2);
    zone_col_names.column('Name', 20, [mod_clc.cyan]);
    zone_col_names.column('Memory in MB', 20, [mod_clc.cyan]);
    zone_col_names.column('Swap in MB', 20, [mod_clc.cyan]);
    zone_col_names.column('ZFS in GB', 20, [mod_clc.cyan]);
    zone_col_names.fill();
    zone_col_names.output();

    for (var l = 0; l < zone_stats.length; l++) {
        var stats = zone_stats[l];
        var zone_line = new line();
        zone_line.padding(2);
        zone_line.column(stats.alias, 20, [mod_clc.white]);

        /* Mem usage */
        var mem_use = stats.mem_use;
        var mem_use_human = (((mem_use / 1000) / 1000));
        var mem_use_human = mem_use_human.toFixed(1);
        var mem_lim = stats.mem_lim;
        var mem_lim_human = (((mem_lim / 1000) / 1000));
        var mem_lim_human = mem_lim_human.toFixed(1);
        var mem_col = mem_use_human + ' / ' + mem_lim_human;
        zone_line.column(mem_col, 20, [mod_clc.white]);

        /* Swap usage */
        var swp_use = stats.swp_use;
        var swp_use_human = (((swp_use / 1000) / 1000));
        var swp_use_human = swp_use_human.toFixed(1);
        var swp_lim = stats.swp_lim;
        var swp_lim_human = (((swp_lim / 1000) / 1000));
        var swp_lim_human = swp_lim_human.toFixed(1);
        var swp_col = swp_use_human + ' / ' + swp_lim_human;
        zone_line.column(swp_col, 20, [mod_clc.white]);

        /* ZFS usage */
        var zfs_use = stats.zfs_use;
        var zfs_use_human = ((zfs_use / 1000) / 1000) / 1000;
        var zfs_use_human = zfs_use_human.toFixed(1);
        var zfs_lim = parseInt(stats.zfs_av) + parseInt(zfs_use);
        var zfs_lim_human = ((zfs_lim / 1000) / 1000) / 1000;
        var zfs_lim_human = zfs_lim_human.toFixed(1);
        var zfs_col = zfs_use_human + ' / ' + zfs_lim_human;
        zone_line.column(zfs_col, 20, [mod_clc.white]);
        zone_line.fill();
        zone_line.output();
    }
}

function refreshTargets(cb) {
    json_client.get(DISCO, function(err, req, res, obj) {
        mod_assert.ifError(err);
        var target_array = obj.containers;
        mod_vasync.forEachPipeline({
            'inputs': target_array,
            'func': function (target, next) {
                targets[target.vm_uuid] = target;
                next();
            }
        }, function (err, result) {
            mod_assert.ifError(err);
            cb();
        });
    });
}

function fetchAllMetrics(cb) {
    mod_vasync.forEachPipeline({
        'inputs': Object.keys(targets),
        'func': function fetchMetrics(key, next) {
            var str_client = mod_restify.createStringClient({
                url: HTTPS + targets[key].vm_uuid + '.' + opts.endpoint + PORT,
                rejectUnauthorized: false,
                cert: mod_fs.readFileSync(opts.cert),
                key: mod_fs.readFileSync(opts.key)
            });

            if (!targets[key].last_metrics) {
                targets[key].cur_metrics = {};
                targets[key].last_metrics = {};
            } else {
                targets[key].last_metrics = mod_jsprim.deepCopy(targets[key].cur_metrics);
                targets[key].cur_metrics = {};
            }

            str_client.get(METRICS, function(err, req, res, data) {
                mod_assert.ifError(err);
                chunked = data.trim().split('\n');

                var i = 0;
                while(i < chunked.length) {
                    var help = chunked[i++];
                    var type = chunked[i++];
                    var valstr = chunked[i++].split(' ');
                    var name = valstr[0];
                    var value = valstr[1];

                    targets[key].cur_metrics[name] = {
                        help: help,
                        type: type,
                        name: name,
                        value: value
                    };
                }

                next();
            });
        }
    }, function (err, result) {
        mod_assert.ifError(err);
        cb();
    });
}
