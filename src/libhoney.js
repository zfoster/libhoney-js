// Copyright 2016 Hound Technology, Inc. All rights reserved.
// Use of this source code is governed by the Apache License 2.0
// license that can be found in the LICENSE file.

/**
 * @module
 */
import Transmission from './transmission';
import Builder from './builder';

import { EventEmitter } from 'events';

const defaults = Object.freeze({
  // host to send data to
  apiHost: "https://api.honeycomb.io/",

  // sample rate of data.  causes us to send 1/sample-rate of events
  // i.e. `sampleRate: 10` means we only send 1/10th the events.
  sampleRate: 1,

  // transmission constructor, or a string "worker"/"base" to pick one of our builtin versions.
  // we fall back to the base impl if worker or a custom implementation throws on init.
  transmission: "base",

  // batch triggers
  batchSizeTrigger: 50,  // we send a batch to the api when we have this many outstanding events
  batchTimeTrigger: 100, // ... or after this many ms has passed.

  // batches are sent serially (one event at a time), so we allow multiple concurrent batches
  // to increase parallelism while sending.
  maxConcurrentBatches: 10,

  // the maximum number of pending events we allow in our queue before they get batched
  pendingWorkCapacity: 10000,

  // the maximum number of s we enqueue before we drop.
  maxResponseQueueSize: 1000
});

/**
 * Represents a honeycomb context.  Each honeycomb context has
 * @class
 */
export default class Libhoney extends EventEmitter {
  /**
   * constructs a libhoney context.
   *
   * @param {Object} [opts] overrides for the defaults
   * @constructor
   * @example
   * import Libhoney from 'libhoney';
   * let honey = new Libhoney({
   *   sampleRate: 10
   * });
   */
  constructor (opts) {
    super();
    this._options = Object.assign({ responseCallback: this._responseCallback.bind(this) }, defaults, opts);
    this._transmission = getAndInitTransmission(this._options.transmission, this._options);
    this._usable = this._transmission != null;
    this._builder = new Builder(this);

    this._builder.apiHost = this._options.apiHost;
    this._builder.writeKey = this._options.writeKey;
    this._builder.dataset = this._options.dataset;
    this._builder.sampleRate = this._options.sampleRate;

    this._responseQueue = [];
  }

  _responseCallback (response) {
    let queue = this._responseQueue;
    if (queue.length < this._options.maxResponseQueueSize) {
      queue.push(response);
    }
    this.emit("response", queue);
  }

  /**
   * The hostname for the Honeycomb API server to which to send events created through this libhoney
   * instance. default: https://api.honeycomb.io/
   *
   * @type {string}
   */
  set apiHost(v) {
    this._builder.apiHost = v;
  }
  /**
   * The hostname for the Honeycomb API server to which to send events created through this libhoney
   * instance. default: https://api.honeycomb.io/
   *
   * @type {string}
   */
  get apiHost() {
    return this._builder.apiHost;
  }

  /**
   * The Honeycomb authentication token. If it is set on a libhoney instance it will be used as the
   * default write key for all events. If absent, it must be explicitly set on a Builder or
   * Event. Find your team write key at https://ui.honeycomb.io/account
   *
   * @type {string}
   */
  set writeKey(v) {
    this._builder.writeKey = v;
  }
  /**
   * The Honeycomb authentication token. If it is set on a libhoney instance it will be used as the
   * default write key for all events. If absent, it must be explicitly set on a Builder or
   * Event. Find your team write key at https://ui.honeycomb.io/account
   *
   * @type {string}
   */
  get writeKey() {
    return this._builder.writeKey;
  }

  /**
   * The name of the Honeycomb dataset to which to send events through this libhoney instance.  If
   * it is specified during libhoney initialization, it will be used as the default dataset for all
   * events. If absent, dataset must be explicitly set on a builder or event.
   *
   * @type {string}
   */
  set dataset(v) {
    this._builder.dataset = v;
  }
  /**
   * The name of the Honeycomb dataset to which to send these events through this libhoney instance.
   * If it is specified during libhoney initialization, it will be used as the default dataset for
   * all events. If absent, dataset must be explicitly set on a builder or event.
   *
   * @type {string}
   */
  get dataset() {
    return this._builder.dataset;
  }

  /**
   * The rate at which to sample events. Default is 1, meaning no sampling. If you want to send one
   * event out of every 250 times send() is called, you would specify 250 here.
   *
   * @type {number}
   */
  set sampleRate(v) {
    this._builder.sampleRate = v;
  }
  /**
   * The rate at which to sample events. Default is 1, meaning no sampling. If you want to send one
   * event out of every 250 times send() is called, you would specify 250 here.
   *
   * @type {number}
   */
  get sampleRate() {
    return this._builder.sampleRate;
  }

  /**
   *  sendEvent takes events of the following form:
   *
   * {
   *   data: a JSON-serializable object, keys become colums in Honeycomb
   *   timestamp [optional]: time for this event, defaults to now()
   *   writeKey [optional]: your team's write key.  overrides the libhoney instance's value.
   *   dataset [optional]: the data set name.  overrides the libhoney instance's value.
   *   sampleRate [optional]: cause us to send 1 out of sampleRate events.  overrides the libhoney instance's value.
   * }
   * @private
   */
  sendEvent (event) {
    if (!this._usable) return;

    var timestamp = event.timestamp || Date.now();
    if (typeof timestamp === 'string' || typeof timestamp === 'number')
      timestamp = new Date(timestamp);

    if (typeof event.data !== 'object' || event.data === null) {
      console.error(".data must be an object");
      return;
    }
    var postData;
    try {
      postData = JSON.stringify(event.data);
    }
    catch (e) {
      console.error("error converting event data to JSON: " + e);
      return;
    }

    var apiHost = event.apiHost;
    if (typeof apiHost !== 'string' || apiHost === "") {
      console.error(".apiHost must be a non-empty string");
      return;
    }

    var writeKey = event.writeKey;
    if (typeof writeKey !== 'string' || writeKey === "") {
      console.error(".writeKey must be a non-empty string");
      return;
    }

    var dataset = event.dataset;
    if (typeof dataset !== 'string' || dataset === "") {
      console.error(".dataset must be a non-empty string");
      return;
    }

    var sampleRate = event.sampleRate;
    if (typeof sampleRate !== 'number') {
      console.error(".sampleRate must be a number");
      return;
    }

    this._transmission.sendEvent({
      timestamp: timestamp,
      apiHost: apiHost,
      postData: postData,
      writeKey: writeKey,
      dataset: dataset,
      sampleRate: sampleRate,
      metadata: event.metadata
    });
  }

  /**
   * adds a group of field->values to the global Builder.
   * @param {Object|Map<string, any>} data field->value mapping.
   * @returns {Libhoney} this libhoney instance.
   * @example <caption>using an object</caption>
   *   honey.add ({
   *     buildID: "a6cc38a1",
   *     env: "staging"
   *   });
   * @example <caption>using an ES2015 map</caption>
   *   let map = new Map();
   *   map.set("build_id", "a6cc38a1");
   *   map.set("env", "staging");
   *   honey.add (map);
   */
  add (data) {
    this._builder.add(data);
    return this;
  }

  /**
   * adds a single field->value mapping to the global Builder.
   * @param {string} name name of field to add.
   * @param {any} val value of field to add.
   * @returns {Libhoney} this libhoney instance.
   * @example
   *   honey.addField("build_id", "a6cc38a1");
   */
  addField (name, val) {
    this._builder.addField(name, val);
    return this;
  }

  /**
   * adds a single field->dynamic value function to the global Builder.
   * @param {string} name name of field to add.
   * @param {function(): any} fn function that will be called to generate the value whenever an event is created.
   * @returns {Libhoney} this libhoney instance.
   * @example
   *   honey.addDynamicField("process_heapUsed", () => process.memoryUsage().heapUsed);
   */
  addDynamicField (name, fn) {
    this._builder.addDynamicField(name, fn);
    return this;
  }

  /**
   * creates and sends an event, including all global builder fields/dyn_fields, as well as anything in the optional data parameter.
   * @param {Object|Map<string, any>} data field->value mapping.
   * @example <caption>using an object</caption>
   *   honey.sendNow ({
   *     responseTime_ms: 100,
   *     httpStatusCode: 200
   *   });
   * @example <caption>using an ES2015 map</caption>
   *   let map = new Map();
   *   map.set("responseTime_ms", 100);
   *   map.set("httpStatusCode", 200);
   *   honey.sendNow (map);
   */
  sendNow (data) {
    return this._builder.sendNow(data);
  }

  /**
   * creates and returns a new Event containing all fields/dyn_fields from the global Builder, that can be further fleshed out and sent on its own.
   * @returns {Event} an Event instance
   * @example <caption>adding data at send-time</caption>
   *   let ev = honey.newEvent();
   *   ev.addField("additionalField", value);
   *   ev.send();
   */
  newEvent () {
    return this._builder.newEvent();
  }

  /**
   * creates and returns a clone of the global Builder, merged with fields and dyn_fields passed as arguments.
   * @param {Object|Map<string, any>} fields a field->value mapping to merge into the new builder.
   * @param {Object|Map<string, any>} dyn_fields a field->dynamic function mapping to merge into the new builder.
   * @returns {Builder} a Builder instance
   * @example <caption>no additional fields/dyn_field</caption>
   *   let builder = honey.newBuilder();
   * @example <caption>additional fields/dyn_field</caption>
   *   let builder = honey.newBuilder({ requestId },
   *                                  {
   *                                    process_heapUsed: () => process.memoryUsage().heapUsed
   *                                  });
   */
  newBuilder (fields, dyn_fields) {
    return this._builder.newBuilder(fields, dyn_fields);
  }
}

function getAndInitTransmission(transmission, options) {
  if (typeof transmission === "string") {
    if (transmission === "base") {
      transmission = Transmission;
    } else if (transmission === "worker") {
      console.warn("worker implementation not ready yet.  using base implementation");
      transmission = Transmission;
    } else {
      throw new Error(`unknown transmission implementation "${transmission}".`);
    }
  } else if (typeof transmission !== "function") {
    throw new Error(".transmission must be one of 'base'/'worker' or a constructor.");
  }

  try {
    return new transmission(options);
  }
  catch (e) {
    if (transmission == Transmission) {
      throw new Error("unable to initialize base transmission implementation.", e);
    }

    console.warn("failed to initialize transmission, falling back to base implementation.");
    try {
      transmission = new Transmission(options);
    }
    catch (e) {
      throw new Error("unable to initialize base transmission implementation.", e);
    }
  }

  return transmission;
}
