import { describeCoverage } from './capabilities.js';
import type { Feature } from '../shape/types.js';

export const domFeature: Feature = {
  id: 'dom',
  describe: (_context, support) => describeCoverage(support, {
    'dom.api': 'partial',
    'dom.worker': 'partial',
    'dom.shared-worker': 'partial',
    'dom.blob-url': 'partial',
    'dom.offscreencanvas': 'partial',
    'dom.rtc': 'partial',
    'dom.canplaytype': 'constant',
  }),
  rev: '3',
  requires: ['globals'],
  build: () => ({
    binds: [
      {
        slot: 'dom.Worker.ctor', driver: 'dom', config: { op: 'worker' },
        sources: [
          'window.EventTarget',
          'window.Function',
          'window.MessageEvent',
          'window.setTimeout',
        ],
      },
      { slot: 'dom.Worker.postMessage', driver: 'dom', config: { op: 'worker-post' } },
      { slot: 'dom.Worker.terminate', driver: 'dom', config: { op: 'worker-terminate' } },
      { slot: 'dom.Worker.onmessage.get', driver: 'dom', config: { op: 'handler-get', name: 'onmessage' } },
      { slot: 'dom.Worker.onmessage.set', driver: 'dom', config: { op: 'handler-set', name: 'onmessage' } },
      { slot: 'dom.Worker.onerror.get', driver: 'dom', config: { op: 'handler-get', name: 'onerror' } },
      { slot: 'dom.Worker.onerror.set', driver: 'dom', config: { op: 'handler-set', name: 'onerror' } },
      { slot: 'dom.Worker.onmessageerror.get', driver: 'dom', config: { op: 'handler-get', name: 'onmessageerror' } },
      { slot: 'dom.Worker.onmessageerror.set', driver: 'dom', config: { op: 'handler-set', name: 'onmessageerror' } },
      {
        slot: 'dom.SharedWorker.ctor', driver: 'dom', config: { op: 'shared-worker' },
        sources: [
          'window.EventTarget',
          'window.Function',
          'window.MessageEvent',
          'window.setTimeout',
        ],
      },
      { slot: 'dom.SharedWorker.port.get', driver: 'dom', config: { op: 'shared-port' } },
      { slot: 'dom.SharedWorker.onerror.get', driver: 'dom', config: { op: 'handler-get', name: 'onerror' } },
      { slot: 'dom.SharedWorker.onerror.set', driver: 'dom', config: { op: 'handler-set', name: 'onerror' } },
      { slot: 'dom.url.createObjectURL', driver: 'dom', config: { op: 'create-object-url' } },
      { slot: 'dom.url.revokeObjectURL', driver: 'dom', config: { op: 'revoke-object-url' } },
      {
        slot: 'dom.OffscreenCanvas.ctor', driver: 'dom', config: { op: 'offscreen' },
        // Function source builds a realm thunk so we can call document.createElement without binding document itself.
        sources: ['window.Function', 'window.HTMLCanvasElement'],
      },
      { slot: 'dom.OffscreenCanvas.getContext', driver: 'dom', config: { op: 'offscreen-context' } },
      {
        slot: 'dom.OffscreenCanvas.convertToBlob', driver: 'dom', config: { op: 'offscreen-blob' },
        sources: ['window.Blob'],
      },
      { slot: 'dom.OffscreenCanvas.width.get', driver: 'dom', config: { op: 'offscreen-dim-get', name: 'width' } },
      { slot: 'dom.OffscreenCanvas.width.set', driver: 'dom', config: { op: 'offscreen-dim-set', name: 'width' } },
      { slot: 'dom.OffscreenCanvas.height.get', driver: 'dom', config: { op: 'offscreen-dim-get', name: 'height' } },
      { slot: 'dom.OffscreenCanvas.height.set', driver: 'dom', config: { op: 'offscreen-dim-set', name: 'height' } },
      { slot: 'dom.media.canPlayType', driver: 'dom', config: { op: 'can-play-type' } },
    ],
    support: {
      'dom.worker': 'emulated', // blob:/data: scripts run same-process; no OS thread
      'dom.shared-worker': 'emulated', // BMS dual-id second table path
      'dom.blob-url': 'emulated',
      'dom.offscreencanvas': 'emulated',
      'dom.rtc': 'emulated',
      'dom.canplaytype': 'emulated',
    },
  }),
};
