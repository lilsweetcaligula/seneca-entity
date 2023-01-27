"use strict";
/* Copyright (c) 2010-2022 Richard Rodger and other contributors, MIT License */
Object.defineProperty(exports, "__esModule", { value: true });
const make_entity_1 = require("./lib/make_entity");
const store_1 = require("./lib/store");
const default_opts = {
    mem_store: true,
    server: false,
    client: false,
    generate_id,
    // Control stringification of entities
    jsonic: {
        depth: 7,
        maxitems: 11,
        maxchars: 111,
    },
    log: {
        active: false,
    },
    meta: {
        // Provide action meta object as third argument to callbacks.
        provide: true,
    },
    transaction: {
        active: false
    }
};
/** Define the `entity` plugin. */
function entity() {
    return {
        name: 'entity',
    };
}
// All functionality should be loaded when defining plugin
function preload(context) {
    const seneca = this;
    const { deep } = seneca.util;
    const opts = deep({}, default_opts, context.options);
    const store = (0, store_1.Store)();
    // Removes dependency on seneca-basic
    // TODO: deprecate this
    seneca
        .add('role:basic,cmd:generate_id', generate_id)
        .add('sys:entity,hook:intercept,intercept:act_error', hook_intercept_act_error);
    // Stores are responsible for calling transaction rollback on errors.
    function hook_intercept_act_error(msg, reply, meta) {
        let action = msg.action;
        if ('function' != typeof action) {
            throw new Error('intercept action parameter must be a function');
        }
        this.private$.intercept.act_error.push(action);
        let act_errors = this.private$.intercept.act_error.map((action) => action.name);
        reply({ act_errors });
    }
    seneca.util.parsecanon = seneca.util.parsecanon || make_entity_1.MakeEntity.parsecanon;
    // Create entity delegate.
    const sd = seneca.delegate();
    // Template entity that makes all others.
    seneca.private$.entity = seneca.private$.entity || (0, make_entity_1.MakeEntity)({}, sd, opts);
    // Expose the Entity object so third-parties can do interesting things with it
    seneca.private$.exports.Entity =
        seneca.private$.exports.Entity || make_entity_1.Entity;
    if (opts.log.active) {
        seneca.private$.exports.Entity.prototype.log$ = function () {
            // Use this, as make$ will have changed seneca ref.
            const seneca = this.private$.get_instance();
            seneca.log.apply(seneca, arguments);
        };
    }
    // all optional
    function build_api_make(promise) {
        let entityAPI = function entityAPI() {
            return seneca.private$.entity.make$(this, ...[...arguments, promise]);
        };
        // TODO: message to inject direct function call for rollbacks
        // to be called in intercept act_error, keyed by canonstr
        entityAPI.instance = function () {
            let emptyEntity = this();
            let instance = emptyEntity.private$.get_instance();
            return instance;
        };
        entityAPI.state = function (canonspec) {
            let emptyEntity = this();
            return get_state(emptyEntity, canonspec);
        };
        if (opts.transaction.active) {
            entityAPI.begin = async function (canonspec, extra) {
                let emptyEntity = this();
                let state = get_state(emptyEntity, canonspec);
                let result = await new Promise((res, rej) => {
                    state.instance.act('sys:entity,transaction:begin', { ...state.canon, ...(extra || {}) }, function (err, out) {
                        return err ? rej(err) : res(out);
                    });
                });
                let { get_handle } = result;
                let transaction = {
                    start: Date.now(),
                    begin: result,
                    canon: state.canon,
                    handle: get_handle(),
                    trace: [],
                    id: state.instance.util.Nid()
                };
                let transactionInstance = state.instance.delegate(null, {
                    custom: {
                        sys__entity: {
                            transaction: {
                                [state.canonstr]: transaction
                            }
                        }
                    }
                });
                transaction.sid = transactionInstance.id;
                transaction.did = transactionInstance.did;
                // Generate correct get_instance referencing transactionInstance
                transactionInstance.entity();
                return transactionInstance;
            };
            entityAPI.end = async function (canonspec, extra) {
                let emptyEntity = this();
                let state = get_state(emptyEntity, canonspec);
                let transaction = state.instance.fixedmeta.custom.sys__entity.transaction[state.canonstr];
                if (transaction) {
                    let details = () => transaction;
                    let get_result = await new Promise((res, rej) => {
                        state.instance.act('sys:entity,transaction:end', {
                            ...state.canon,
                            ...(extra || {}),
                            details,
                        }, function (err, out) {
                            return err ? rej(err) : res(out);
                        });
                    });
                    transaction.result = get_result();
                    transaction.finish = Date.now();
                    delete state.instance.fixedmeta.custom.sys__entity.transaction[state.canonstr];
                }
                return transaction;
            };
            entityAPI.rollback = async function (canonspec, extra) {
                let emptyEntity = this();
                let state = get_state(emptyEntity, canonspec);
                let transaction = state.instance.fixedmeta.custom.sys__entity.transaction[state.canonstr];
                let details = () => transaction;
                let canon = make_entity_1.MakeEntity.parsecanon(canonspec);
                let result = await new Promise((res, rej) => {
                    state.instance.act('sys:entity,transaction:rollback', {
                        ...canon,
                        ...(extra || {}),
                        details,
                    }, function (err, out) {
                        return err ? rej(err) : res(out);
                    });
                });
                transaction.end = result;
                transaction.finish = Date.now();
                delete state.instance.fixedmeta.custom.sys__entity.transaction[state.canonstr];
                return transaction;
            };
            entityAPI.adopt = async function (handle, canonspec, extra) {
                let emptyEntity = this();
                let state = get_state(emptyEntity, canonspec);
                let transaction = state.instance.fixedmeta.custom.sys__entity.transaction[state.canonstr];
                if (transaction) {
                    let err = new Error('Transaction already exists for canon ' + state.canonstr);
                    err.transaction = transaction;
                    throw err;
                }
                let result = await new Promise((res, rej) => {
                    state.instance.act('sys:entity,transaction:adopt', {
                        ...state.canon,
                        ...(extra || {}),
                        get_handle: () => handle
                    }, function (err, out) {
                        return err ? rej(err) : res(out);
                    });
                });
                let { get_handle } = result;
                transaction = {
                    start: Date.now(),
                    begin: result,
                    canon: state.canon,
                    handle: get_handle(),
                    trace: [],
                    id: state.instance.util.Nid()
                };
                let transactionInstance = state.instance.delegate(null, {
                    custom: {
                        sys__entity: {
                            transaction: {
                                [state.canonstr]: transaction
                            }
                        }
                    }
                });
                transaction.sid = transactionInstance.id;
                transaction.did = transactionInstance.did;
                // Generate correct get_instance referencing transactionInstance
                transactionInstance.entity();
                return transactionInstance;
            };
        }
        return entityAPI;
    }
    let make = build_api_make(false);
    let entity = build_api_make(true);
    if (!seneca.make$) {
        seneca.decorate('make$', make);
    }
    if (!seneca.make) {
        seneca.decorate('make', make);
    }
    // TODO: make this work
    // if (!seneca.entity$) {
    //   seneca.decorate('entity$', entity)
    // }
    if (!seneca.entity) {
        seneca.decorate('entity', entity);
    }
    // Handle old versions of seneca where the
    // store init was already included by default.
    if (!seneca.store || !seneca.store.init) {
        seneca.decorate('store', store);
    }
    // Ensures legacy versions of seneca that load mem-store do not
    // crash the system. Seneca 2.x and lower loads mem-store by default.
    if (!seneca.options().default_plugins['mem-store'] &&
        opts.mem_store &&
        !opts.client) {
        seneca.root.use(require('seneca-mem-store'));
    }
    // FIX: does not work! need to invert this so
    // older stuff hits role then sys
    // Prepare transition from role: to sys:
    this.translate('sys:entity,cmd:load', 'role:entity')
        .translate('sys:entity,cmd:save', 'role:entity')
        .translate('sys:entity,cmd:list', 'role:entity')
        .translate('sys:entity,cmd:remove', 'role:entity');
    if (opts.client) {
        this.translate('role:entity,cmd:load', 'role:remote-entity')
            .translate('role:entity,cmd:save', 'role:remote-entity')
            .translate('role:entity,cmd:list', 'role:remote-entity')
            .translate('role:entity,cmd:remove', 'role:remote-entity');
        this.translate('sys:entity,cmd:load', 'sys:remote-entity')
            .translate('sys:entity,cmd:save', 'sys:remote-entity')
            .translate('sys:entity,cmd:list', 'sys:remote-entity')
            .translate('sys:entity,cmd:remove', 'sys:remote-entity');
    }
    else if (opts.server) {
        this.translate('role:remote-entity,cmd:load', 'role:entity')
            .translate('role:remote-entity,cmd:save', 'role:entity')
            .translate('role:remote-entity,cmd:list', 'role:entity')
            .translate('role:remote-entity,cmd:remove', 'role:entity');
        this.translate('sys:remote-entity,cmd:load', 'sys:entity')
            .translate('sys:remote-entity,cmd:save', 'sys:entity')
            .translate('sys:remote-entity,cmd:list', 'sys:entity')
            .translate('sys:remote-entity,cmd:remove', 'sys:entity');
    }
    return {
        name: 'entity',
        exports: {
            store: store,
            init: store.init,
            generate_id: opts.generate_id.bind(seneca),
        },
    };
}
entity.preload = preload;
// cache nid funcs up to length 64
const nidCache = [];
function generate_id(msg, reply) {
    let seneca = this;
    let Nid = seneca.util.Nid;
    let actnid = null == msg ? Nid({}) : null;
    if (null == actnid) {
        const length = 'object' === typeof msg
            ? parseInt(msg.length, 10) || 6
            : parseInt(msg, 10);
        if (length < 65) {
            actnid = nidCache[length] || (nidCache[length] = Nid({ length: length }));
        }
        else {
            actnid = Nid({ length: length });
        }
    }
    return reply ? reply(actnid()) : actnid();
}
// Get the current entity instance and transaction state
function get_state(emptyEntity, canonspec) {
    let instance = emptyEntity.private$.get_instance();
    let canon = make_entity_1.MakeEntity.parsecanon(canonspec);
    let canonstr = make_entity_1.MakeEntity.canonstr(canon);
    let transaction = instance.fixedmeta.custom.sys__entity.transaction[canonstr];
    return {
        when: Date.now(),
        instance,
        canon,
        canonstr,
        transaction,
    };
}
exports.default = entity;
if ('undefined' !== typeof (module)) {
    module.exports = entity;
}
//# sourceMappingURL=entity.js.map