import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { Catalog, compile, JsdomEngine, LegacyProfiles, parseJob, parseProfile, parseShape, seal } from '../../src/v2/index.js';
import { chromeDriver, chromeFeature, touchFeature } from '../../src/v2/features/chrome.js';
import { domFeature } from '../../src/v2/features/dom.js';
import { globalsDriver, globalsFeature } from '../../src/v2/features/globals.js';
import { navDriver, navFeature } from '../../src/v2/features/nav.js';
import { netDriver, netFeature, netShape } from '../../src/v2/features/net.js';
import { pluginsDriver, pluginsFeature } from '../../src/v2/features/plugins.js';
import { screenDriver, screenFeature } from '../../src/v2/features/screen.js';
import { uaDriver, uaFeature } from '../../src/v2/features/ua.js';
import { viewDriver, viewFeature } from '../../src/v2/features/view.js';

const store = new LegacyProfiles(path.resolve('profiles'));
const features = [
  viewFeature, screenFeature, chromeFeature, touchFeature, navFeature, uaFeature, pluginsFeature, globalsFeature, domFeature,
  netFeature,
];
const drivers = {
  view: viewDriver,
  screen: screenDriver,
  chrome: chromeDriver,
  nav: navDriver,
  ua: uaDriver,
  plugins: pluginsDriver,
  globals: globalsDriver,
  net: netDriver,
};

async function open(id: string) {
  const imported = await store.load(id);
  const { hash: _shapeHash, ...shapeBody } = imported.shape;
  const base = parseShape(seal({
    ...shapeBody,
    features: [],
    ops: [],
    support: { structure: imported.shape.support.structure || imported.shape.level },
  }));
  const shape = netShape(base);
  const { hash: _hash, ...body } = imported.profile;
  const profile = parseProfile(seal({ ...body, shape: { id: shape.id, hash: shape.hash } }));
  const engine = new JsdomEngine();
  const plan = compile({
    profile,
    catalog: Catalog.create('builtin', [shape], features),
    ...(imported.page ? { page: imported.page } : {}),
    job: parseJob({ kind: 'probe' }),
    engine: engine.manifest,
    drivers: Object.keys(drivers),
  });
  return { engine, runtime: engine.open(plan, drivers) };
}

test('dom shapes methods and accessor halves while retaining jsdom behavior', async () => {
  const { engine, runtime } = await open('macos-chrome-v149');
  try {
    const result = runtime.run(`(() => {
      const tell = (owner, key, part = 'value') => {
        const desc = Object.getOwnPropertyDescriptor(owner, key);
        const fn = part === 'value' ? desc.value : desc[part];
        return [fn.name, fn.length, fn.toString(), Object.hasOwn(fn, 'prototype'), Reflect.ownKeys(fn).map(String)];
      };
      const div = document.createElement('div');
      div.id = 'ready';
      div.title = 'Mimic';
      document.body.appendChild(div);
      const expression = document.createExpression('count(//div)', null);
      const count = expression.evaluate(document, XPathResult.NUMBER_TYPE, null).numberValue;
      return JSON.stringify({
        shapes: {
          createElement: tell(Document.prototype, 'createElement'),
          createExpression: tell(Document.prototype, 'createExpression'),
          evaluate: tell(Document.prototype, 'evaluate'),
          cookieGet: tell(Document.prototype, 'cookie', 'get'),
          cookieSet: tell(Document.prototype, 'cookie', 'set'),
          appendChild: tell(Node.prototype, 'appendChild'),
          nodeType: tell(Node.prototype, 'nodeType', 'get'),
          getAttribute: tell(Element.prototype, 'getAttribute'),
          idSet: tell(Element.prototype, 'id', 'set'),
          click: tell(HTMLElement.prototype, 'click'),
          titleGet: tell(HTMLElement.prototype, 'title', 'get'),
          alignSet: tell(HTMLDivElement.prototype, 'align', 'set'),
          preventDefault: tell(Event.prototype, 'preventDefault'),
          eventType: tell(Event.prototype, 'type', 'get'),
          javaEnabled: tell(Navigator.prototype, 'javaEnabled'),
        },
        constructors: [Navigator, Document, Node, EventTarget, Element, HTMLElement, HTMLDivElement, Event].map(fn => [
          fn.name, fn.length, fn.toString(), Object.hasOwn(fn, 'prototype'), fn.prototype.constructor === fn,
        ]),
        documentStatics: [typeof Document.parseHTMLUnsafe, Document.parseHTMLUnsafe?.name, typeof Document.parseHTML],
        chains: {
          navigatorProto: Object.getPrototypeOf(Navigator.prototype) === Object.prototype,
          eventProto: Object.getPrototypeOf(Event.prototype) === Object.prototype,
          navigator: Object.getPrototypeOf(navigator) === Navigator.prototype,
          documentProto: Object.getPrototypeOf(Document.prototype) === Node.prototype,
          nodePrototype: Node.prototype.isPrototypeOf(document),
          nodeInstance: document instanceof Node,
          eventInstance: new Event('ready') instanceof Event,
          createdEvent: document.createEvent('Event') instanceof Event,
          mouseInstance: new MouseEvent('click') instanceof Event,
          nodeConstructor: Object.getPrototypeOf(Document) === Node,
          eventConstructor: Event.isPrototypeOf(MouseEvent),
        },
        divKeys: Reflect.ownKeys(HTMLDivElement.prototype).map(String),
        nodeKeys: Reflect.ownKeys(Node.prototype).map(String),
        eventKeys: Reflect.ownKeys(Event.prototype).map(String),
        constants: [Node.ELEMENT_NODE, Event.AT_TARGET],
        behavior: [div.id, div.title, div.getAttribute('id'), document.body.lastChild === div, document.nodeType, count],
      });
    })()`);
    assert.equal(result.ok, true);
    const value = JSON.parse(String(result.value));
    for (const [name, shape] of Object.entries(value.shapes) as Array<[string, unknown[]]>) {
      assert.match(String(shape[2]), /^function (?:get |set )?\w+\(\) \{ \[native code\] \}$/, name);
      assert.equal(shape[3], false, name);
      assert.deepEqual(shape[4], ['length', 'name'], name);
    }
    assert.deepEqual(value.shapes.createExpression.slice(0, 2), ['createExpression', 1]);
    assert.deepEqual(value.shapes.evaluate.slice(0, 2), ['evaluate', 2]);
    assert.deepEqual(value.shapes.cookieGet.slice(0, 2), ['get cookie', 0]);
    assert.deepEqual(value.shapes.cookieSet.slice(0, 2), ['set cookie', 1]);
    assert.deepEqual(value.constructors.map((item: unknown[]) => item.slice(0, 2)), [
      ['Navigator', 0], ['Document', 0], ['Node', 0], ['EventTarget', 0],
      ['Element', 0], ['HTMLElement', 0], ['HTMLDivElement', 0], ['Event', 1],
    ]);
    for (const item of value.constructors) {
      assert.match(item[2], /^function \w+\(\) \{ \[native code\] \}$/);
      assert.deepEqual(item.slice(3), [true, true]);
    }
    assert.deepEqual(value.documentStatics, ['function', 'parseHTMLUnsafe', 'function']);
    assert.deepEqual(value.chains, {
      navigatorProto: true,
      eventProto: true,
      navigator: true,
      documentProto: true,
      nodePrototype: true,
      nodeInstance: true,
      eventInstance: true,
      createdEvent: true,
      mouseInstance: true,
      nodeConstructor: true,
      eventConstructor: true,
    });
    assert.deepEqual(value.divKeys, ['align', 'constructor', 'Symbol(Symbol.toStringTag)']);
    assert.deepEqual(value.nodeKeys.slice(0, 2), ['nodeType', 'nodeName']);
    assert.deepEqual(value.nodeKeys.slice(-2), ['constructor', 'Symbol(Symbol.toStringTag)']);
    assert.deepEqual(value.eventKeys.slice(0, 2), ['type', 'target']);
    assert.deepEqual(value.eventKeys.slice(-2), ['constructor', 'Symbol(Symbol.toStringTag)']);
    assert.deepEqual(value.constants, [1, 2]);
    assert.deepEqual(value.behavior, ['ready', 'Mimic', 'ready', true, 9, 1]);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});

test('dom selects captured mobile touch accessor shapes', async () => {
  const { engine, runtime } = await open('android-webview-v138');
  try {
    const result = runtime.run(`(() => {
      const tell = (owner, key) => {
        const desc = Object.getOwnPropertyDescriptor(owner, key);
        return [desc.get.toString(), desc.set.toString(), desc.get.name, desc.set.name];
      };
      return JSON.stringify([
        tell(Document.prototype, 'ontouchstart'),
        tell(Document.prototype, 'ontouchcancel'),
        tell(HTMLElement.prototype, 'ontouchmove'),
        tell(HTMLElement.prototype, 'ontouchend'),
        {
          media: [Object.hasOwn(navigator, 'mediaSession'), typeof navigator.mediaSession, Reflect.ownKeys(navigator).map(String)],
          idb: [typeof indexedDB, Object.prototype.toString.call(indexedDB), indexedDB instanceof IDBFactory, Reflect.ownKeys(indexedDB)],
          worker: [typeof Worker, Worker.name, Worker.length, Worker.toString(), Object.hasOwn(Worker, 'prototype')],
          rtc: [typeof RTCPeerConnection, RTCPeerConnection.name, RTCPeerConnection.length,
            RTCPeerConnection.toString(), Object.hasOwn(RTCPeerConnection, 'prototype'),
            Reflect.ownKeys(RTCPeerConnection).map(String).sort()],
        },
      ]);
    })()`);
    assert.equal(result.ok, true);
    const values = JSON.parse(String(result.value));
    const globals = values.pop();
    for (const [get, set, getName, setName] of values) {
      assert.match(get, /\[native code\]/);
      assert.match(set, /\[native code\]/);
      assert.match(getName, /^get ontouch/);
      assert.match(setName, /^set ontouch/);
    }
    assert.deepEqual(globals.media, [true, 'object', ['mediaSession']]);
    assert.deepEqual(globals.idb, ['object', '[object IDBFactory]', true, []]);
    assert.deepEqual(globals.worker, ['function', 'Worker', 1, 'function Worker() { [native code] }', true]);
    assert.deepEqual(globals.rtc, [
      'function', 'RTCPeerConnection', 0, 'function RTCPeerConnection() { [native code] }', true,
      ['generateCertificate', 'length', 'name', 'prototype'],
    ]);
  } finally {
    runtime.dispose();
  }
  assert.equal(engine.active, 0);
});
