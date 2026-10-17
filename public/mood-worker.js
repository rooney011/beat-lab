/*
 * On-device mood inference, off the render thread.
 *
 * Essentia.js extracts MusiCNN mel-spectrogram patches; four pre-trained MusiCNN-MSD classifiers
 * (happy / sad / aggressive / relaxed) run on TensorFlow.js's WASM backend. Everything is loaded
 * from /models on this origin — nothing is fetched from a third party.
 *
 * Protocol (main thread -> worker): { type:'pcm', reqId, channels:[Float32Array], sampleRate }
 *                  (worker -> main): { type:'ready' }
 *                                    { type:'result', reqId, probs:{happy,sad,aggressive,relaxed}, inferenceMs }
 *                                    { type:'error', reqId, message }
 */
/* eslint-disable */
'use strict';

var BASE = '/models';
importScripts(
  BASE + '/lib/tf.min.3.5.0.js',
  BASE + '/lib/tf-backend-wasm-3.5.0.js',
  BASE + '/lib/essentia.js-model.umd.js',
  BASE + '/lib/essentia-wasm.module.js',
);

// Which output index of each 2-class model is the "positive" (named) activation.
var POSITIVE_INDEX = { mood_happy: 0, mood_sad: 1, mood_relaxed: 1, mood_aggressive: 0 };
var NAMES = ['mood_happy', 'mood_sad', 'mood_aggressive', 'mood_relaxed'];
var MODEL_SR = 16000;

var extractor = null;
var models = {};
var backendPromise = null;

// --- audio prep (mirror of src/ai/resample.ts; the worker can't import TS) ---
function toMono(channels) {
  if (channels.length === 1) return channels[0];
  var n = channels[0].length,
    out = new Float32Array(n),
    k = 1 / channels.length;
  for (var c = 0; c < channels.length; c++) {
    var ch = channels[c];
    for (var i = 0; i < n; i++) out[i] += ch[i] * k;
  }
  return out;
}
function downsampleTo(input, rateIn, rateOut) {
  if (rateOut >= rateIn) return input;
  var ratio = rateIn / rateOut,
    outLen = Math.round(input.length / ratio),
    out = new Float32Array(outLen),
    posIn = 0;
  for (var i = 0; i < outLen; i++) {
    var nextIn = Math.round((i + 1) * ratio),
      sum = 0,
      count = 0;
    for (var j = posIn; j < nextIn && j < input.length; j++) {
      sum += input[j];
      count++;
    }
    out[i] = count ? sum / count : 0;
    posIn = nextIn;
  }
  return out;
}

function essentiaReady() {
  return new Promise(function (resolve) {
    if (typeof Module !== 'undefined' && Module.calledRun) return resolve();
    var prev = Module.onRuntimeInitialized;
    Module.onRuntimeInitialized = function () {
      if (prev) prev();
      resolve();
    };
  });
}

function ensureBackend() {
  if (backendPromise) return backendPromise;
  backendPromise = (async function () {
    if (tf.wasm && tf.wasm.setWasmPaths) tf.wasm.setWasmPaths(BASE + '/tfjs/');
    await tf.setBackend('wasm');
    await tf.ready();
    await essentiaReady();
    extractor = new EssentiaModel.EssentiaTFInputExtractor(Module, 'musicnn', false);
  })();
  return backendPromise;
}

async function modelFor(name) {
  if (models[name]) return models[name];
  var m = new EssentiaModel.TensorflowMusiCNN(tf, BASE + '/' + name + '-musicnn-msd-2/model.json');
  await m.initialize();
  models[name] = m;
  return m;
}

function averageSecond(arrayOfArrays, index) {
  var sum = 0;
  for (var i = 0; i < arrayOfArrays.length; i++) sum += arrayOfArrays[i][index];
  return sum / arrayOfArrays.length;
}

async function infer(channels, sampleRate) {
  await ensureBackend();
  var mono = downsampleTo(toMono(channels), sampleRate, MODEL_SR);
  var t0 = Date.now();
  var features = extractor.computeFrameWise(mono, 256);
  var probs = {};
  for (var i = 0; i < NAMES.length; i++) {
    var name = NAMES[i];
    var model = await modelFor(name);
    var preds = await model.predict(features, true); // per-patch [class0, class1]
    probs[name.replace('mood_', '')] = averageSecond(preds, POSITIVE_INDEX[name]);
  }
  return { probs: probs, inferenceMs: Date.now() - t0 };
}

onmessage = function (e) {
  var d = e.data || {};
  if (d.type !== 'pcm') return;
  var channels = (d.channels || []).map(function (c) {
    return c instanceof Float32Array ? c : new Float32Array(c);
  });
  infer(channels, d.sampleRate).then(
    function (r) {
      postMessage({ type: 'result', reqId: d.reqId, probs: r.probs, inferenceMs: r.inferenceMs });
    },
    function (err) {
      postMessage({ type: 'error', reqId: d.reqId, message: String((err && err.message) || err) });
    },
  );
};

postMessage({ type: 'ready' });
