var mod_assert = require('assert-plus');
var mod_clc = require('cli-color');
var mod_clui = require('clui');
var mod_dashdash = require('dashdash');
var mod_fs = require('fs');
var mod_jsprim = require('jsprim');
var mod_restify = require('restify-clients');
var mod_extsprintf = require('extsprintf');
var mod_vasync = require('vasync');

/* Unit statics */
var CONTAINER = 'Container';
var CPU = 'CPU';
var CPU_PCT = CPU + ' %';
var DRAM = 'DRAM';
var GB = 'GB';
var LOAD_AVG = 'Load Avg';
var MB = 'MB';
var MBps = ' MBps';
var PCT = '%';
var SWAP = 'Swap';
var ZFS = 'ZFS';

var Egress_MBps = 'Egress' + MBps;
var Ingress_MBps = 'Ingress' + MBps;

/* Endpoint statics */
var HTTPS = 'https://';
var PORT = ':9163';
var METRICS = '/metrics';
var DISCO = '/v1/discover';

/* Calculation statics */
var FETCH_INTERVAL_MS = 10 * 1000; /* 1000ms per second */
var REFRESH_INTERVAL_MS = 300 * 1000; /* 1000ms per second */
var NANO_SEC_PERIOD = 10000000000; /* Nano seconds in 10 sec peroid */

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
    },
    {
        names: ['cpus'],
        type: 'number',
        help: 'optional number of CPUs to assume',
        helpArg: 'CPUS'
    }
];

var egressNet =
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
var ingressNet =
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];

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

function bytesToMB(bytes_val) {
    return ((bytes_val / 1000) / 1000);
}

function bytesToGB(bytes_val) {
    return (((bytes_val / 1000) / 1000) / 1000);
}

function fractionStr(val_one, val_two, unit) {
    if (!unit) {
        return mod_extsprintf.sprintf('%s/%s', val_one, val_two);
    }

    return mod_extsprintf.sprintf('%s/%s %s', val_one, val_two, unit);
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

    setTimeout(paint, FETCH_INTERVAL_MS);
}

function draw() {
    console.log(mod_clc.reset);

    var zkeys = Object.keys(targets);

    var line = mod_clui.Line;
    var gauge = mod_clui.Gauge;
    var spark = mod_clui.Sparkline;

    var mem_used = 0;
    var mem_limit = 0;
    var swap_used = 0;
    var swap_limit = 0;
    var zfs_used = 0;
    var zfs_avail = 0;
    var net_in_mb_per_sec = 0;
    var net_out_mb_per_sec = 0;
    var cpu_pct = 0;

    var zone_stats = [];

    for (var z = 0; z < zkeys.length; z++) {
        var key = zkeys[z];
        var cur_metrics = targets[key].cur_metrics;
        var last_metrics = targets[key].last_metrics;

        var stats = {
            alias: targets[key].vm_alias,
            mem_use: cur_metrics.mem_agg_usage.value,
            mem_lim: cur_metrics.mem_limit.value,
            swp_use: cur_metrics.mem_swap.value,
            swp_lim: cur_metrics.mem_swap_limit.value,
            zfs_use: cur_metrics.zfs_used.value,
            zfs_av: cur_metrics.zfs_available.value,
            netb_in: cur_metrics.net_agg_bytes_in.value,
            netb_in_old: last_metrics.net_agg_bytes_in ?
                last_metrics.net_agg_bytes_in.value : 0,
            netb_out: cur_metrics.net_agg_bytes_out.value,
            netb_out_old: last_metrics.net_agg_bytes_out ?
                last_metrics.net_agg_bytes_out.value : 0,
            cpu_usr: cur_metrics.cpu_user_usage.value,
            cpu_usr_old: last_metrics.cpu_user_usage ?
                last_metrics.cpu_user_usage.value : 0,
            cpu_sys: cur_metrics.cpu_sys_usage.value,
            cpu_sys_old: last_metrics.cpu_sys_usage ?
                last_metrics.cpu_sys_usage.value : 0,
            load_avg: cur_metrics.load_average.value
        };

        zone_stats.push(stats);

        /* Total Memory Calculation */
        var mu_inst = stats.mem_use;
        var ml_inst = stats.mem_lim;
        mem_used += bytesToGB(mu_inst);
        mem_limit += bytesToGB(ml_inst);

        /* Total Swap Calculation */
        var su_inst = stats.swp_use;
        var sl_inst = stats.swp_lim;
        swap_used += bytesToGB(su_inst);
        swap_limit += bytesToGB(sl_inst);
        
        /* Total Swap Calculation */
        var zu_inst = stats.zfs_use;
        var za_inst = stats.zfs_av;
        zfs_used += bytesToGB(zu_inst);
        zfs_avail += bytesToGB(za_inst);


        /* Total CPU % */
        var cpu_usr_tl = parseInt(stats.cpu_usr);
        var cpu_usr_old_tl = parseInt(stats.cpu_usr_old);
        var cpu_usr_inc_tl = (cpu_usr_tl - cpu_usr_old_tl);
        var cpu_sys_tl = parseInt(stats.cpu_sys);
        var cpu_sys_old_tl = parseInt(stats.cpu_sys_old);
        var cpu_sys_inc_tl = (cpu_sys_tl - cpu_sys_old_tl);
        cpu_pct += ((cpu_sys_inc_tl + cpu_usr_inc_tl) / NANO_SEC_PERIOD) * 100;

        /* Ingress Network Bytes */
        var netb_in = parseInt(stats.netb_in);
        var netb_in_old = parseInt(stats.netb_in_old);
        var net_in_diff = netb_in - netb_in_old;
        var net_in_mb = bytesToMB(net_in_diff);
        net_in_mb_per_sec += (net_in_mb / 10);

        /* Egress Network Bytes */
        var netb_out = parseInt(stats.netb_out);
        var netb_out_old = parseInt(stats.netb_out_old);
        var net_out_diff = netb_out - netb_out_old;
        var net_out_mb = bytesToMB(net_out_diff);
        net_out_mb_per_sec += (net_out_mb / 10);
    }

    var blank_line = new line().fill();

    /* Memory Totals Output */
    var mem_danger = mem_limit * 0.8;
    var mem_lim_human = mem_limit.toFixed(2);
    var mem_used_human = mem_used.toFixed(2);
    var mem_human = fractionStr(mem_used_human, mem_lim_human, GB);
    var mem_gauge = gauge(
        mem_used,
        mem_limit,
        20,
        mem_danger,
        mem_human);

    var mem_line = new line();
    mem_line.padding(2);
    mem_line.column(DRAM, 20, [mod_clc.cyan]);
    mem_line.column(mem_gauge);
    mem_line.fill();
    mem_line.output();

    /* Swap Totals Output */
    var swap_danger = swap_limit * 0.8;
    var swap_lim_human = swap_limit.toFixed(2) + GB;
    var swap_human = fractionStr(swap_used.toFixed(2), swap_lim_human);
    var swap_gauge = gauge(
        swap_used,
        swap_limit,
        20,
        swap_danger,
        swap_human);

    var swap_line = new line();
    swap_line.padding(2);
    swap_line.column(SWAP, 20, [mod_clc.cyan]);
    swap_line.column(swap_gauge);
    swap_line.fill();
    swap_line.output();

    /* Swap Totals Output */
    var zfs_limit = (zfs_used + zfs_avail).toFixed(2);
    var zfs_lim_human = zfs_limit + GB;
    var zfs_danger = zfs_limit * 0.8;
    var zfs_human = fractionStr(zfs_used.toFixed(2), zfs_lim_human);
    var zfs_gauge = gauge(
        zfs_used,
        zfs_limit,
        20,
        zfs_danger,
        zfs_human);

    var zfs_line = new line();
    zfs_line.padding(2);
    zfs_line.column(ZFS, 20, [mod_clc.cyan]);
    zfs_line.column(zfs_gauge);
    zfs_line.fill();
    zfs_line.output();

    if (opts.cpus) {
        /* CPU % Totals Output */
        var cpu_gauge = gauge(
            cpu_pct.toFixed(0),
            opts.cpus * 100,
            20,
            (opts.cpus * 100) * 0.8,
            mod_extsprintf.sprintf('%s %s', cpu_pct.toFixed(0), PCT));

        var cpu_line = new line();
        cpu_line.padding(2);
        cpu_line.column(CPU, 20, [mod_clc.cyan]);
        cpu_line.column(cpu_gauge);
        cpu_line.fill();
        cpu_line.output();
    }

    blank_line.output();

    /* Ingress MBps */
    ingressNet.push(net_in_mb_per_sec.toFixed(2));
    ingressNet.shift();
    var netb_in_line = new line();
    netb_in_line.padding(2);
    netb_in_line.column(Ingress_MBps, 20, [mod_clc.cyan]);
    netb_in_line.column(spark(ingressNet, MBps), 80);
    netb_in_line.fill();
    netb_in_line.output();

    /* Egress MBps */
    egressNet.push(net_out_mb_per_sec.toFixed(2));
    egressNet.shift();
    var netb_out_line = new line();
    netb_out_line.padding(2);
    netb_out_line.column(Egress_MBps, 20, [mod_clc.cyan]);
    netb_out_line.column(spark(egressNet, MBps), 80);
    netb_out_line.fill();
    netb_out_line.output();

    blank_line.output();

    /* Individual Zone Column Headers */
    var zone_col_names = new line();
    zone_col_names.padding(2);
    zone_col_names.column(CONTAINER, 15, [mod_clc.cyan]);
    zone_col_names.column(DRAM, 10, [mod_clc.cyan]);
    zone_col_names.column(SWAP, 15, [mod_clc.cyan]);
    zone_col_names.column(ZFS, 10, [mod_clc.cyan]);
    zone_col_names.column(LOAD_AVG, 10, [mod_clc.cyan]);
    zone_col_names.column(CPU_PCT, 10, [mod_clc.cyan]);
    zone_col_names.fill();
    zone_col_names.output();

    for (var l = 0; l < zone_stats.length; l++) {
        var stats = zone_stats[l];
        var zone_line = new line();
        zone_line.padding(2);
        zone_line.column(stats.alias, 15, [mod_clc.white]);

        /* Mem usage */
        var mem_use = stats.mem_use;
        var mem_use_human = bytesToGB(mem_use);
        var mem_use_human = mem_use_human.toFixed(1);
        var mem_lim = stats.mem_lim;
        var mem_lim_human = bytesToGB(mem_lim);
        var mem_lim_human = mem_lim_human.toFixed(1);
        var mem_use_pct = ((mem_use * 100) / mem_lim).toFixed(1);
        var mem_col = mod_extsprintf.sprintf('%s %s', mem_use_pct, '%');
        zone_line.column(mem_col, 10, [mod_clc.white]);

        /* Swap usage */
        var swp_use = stats.swp_use;
        var swp_use_human = bytesToMB(swp_use);
        var swp_use_human = swp_use_human.toFixed(0);
        var swp_lim = stats.swp_lim;
        var swp_lim_human = bytesToMB(swp_lim);
        var swp_lim_human = swp_lim_human.toFixed(0);
        var swp_col = fractionStr(swp_use_human, swp_lim_human, MB);
        zone_line.column(swp_col, 15, [mod_clc.white]);

        /* ZFS usage */
        var zfs_use = stats.zfs_use;
        var zfs_use_human = bytesToGB(zfs_use);
        var zfs_use_human = zfs_use_human.toFixed(0);
        var zfs_lim = parseInt(stats.zfs_av) + parseInt(zfs_use);
        var zfs_lim_human = bytesToGB(zfs_lim);
        var zfs_lim_human = zfs_lim_human.toFixed(0);
        var zfs_col = fractionStr(zfs_use_human, zfs_lim_human, GB);
        zone_line.column(zfs_col, 10, [mod_clc.white]);

        /* Load Average */
        var load_avg_col = parseFloat(stats.load_avg);
        zone_line.column(load_avg_col.toFixed(2), 10, [mod_clc.white]);

        /* CPU % */
        var cpu_usr = parseInt(stats.cpu_usr);
        var cpu_usr_old = parseInt(stats.cpu_usr_old);
        var cpu_usr_inc = (cpu_usr - cpu_usr_old);
        var cpu_sys = parseInt(stats.cpu_sys);
        var cpu_sys_old = parseInt(stats.cpu_sys_old);
        var cpu_sys_inc = (cpu_sys - cpu_sys_old);
        var cpu_pct_col = ((cpu_sys_inc + cpu_usr_inc) / NANO_SEC_PERIOD) * 100;
        zone_line.column(cpu_pct_col.toFixed(2), 10, [mod_clc.white]);

        /* draw the zone line */
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
                var uuid = target.vm_uuid;
                if (targets && targets[uuid]) {
                    var temp_cur_mets = targets[uuid].cur_metrics;
                    var temp_last_mets = targets[uuid].last_metrics;
                    targets[uuid] = target;
                    targets[uuid].cur_metrics = temp_cur_mets;
                    targets[uuid].last_metrics = temp_last_mets;
                } else {
                    targets[target.vm_uuid] = target;
                }
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
            var id = targets[key].vm_uuid;
            var ept = opts.endpoint;
            var url = mod_extsprintf.sprintf('%s%s.%s%s', HTTPS, id, ept, PORT);
            var str_client = mod_restify.createStringClient({
                url: url,
                rejectUnauthorized: false,
                cert: mod_fs.readFileSync(opts.cert),
                key: mod_fs.readFileSync(opts.key)
            });

            if (!targets[key].cur_metrics) {
                targets[key].last_metrics = {};
                targets[key].cur_metrics = {};
            } else {
                var current = targets[key].cur_metrics;
                targets[key].last_metrics = mod_jsprim.deepCopy(current);
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
