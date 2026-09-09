import { describeCoverage } from './capabilities.js';
import type { JsonValue, Shape } from '../core/types.js';
import type { DraftOp, Feature, Ref } from '../shape/types.js';
import { hasAndroidChromeCapabilities } from './nav.capabilities.compile.js';
import { accessor, ctor, fn, refProp, tag } from './ops.js';

const DESCRIPTION = 'Portable Document Format';
const NAMES = ['PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer', 'Microsoft Edge PDF Viewer', 'WebKit built-in PDF'];
const MIMES = [
  { type: 'application/pdf', suffixes: 'pdf', description: DESCRIPTION },
  { type: 'text/pdf', suffixes: 'pdf', description: DESCRIPTION },
];

const dataRef = (target: Ref, key: string, node: string, enumerable: boolean): DraftOp => ({
  op: 'prop', target, key,
  desc: { kind: 'data', value: { ref: { node } }, writable: false, enumerable, configurable: true },
});

/** Data property whose value is a function node. Android Chrome 152 methods are writable. */
const fnRef = (target: Ref, key: string, node: string, enumerable: boolean, writable = false): DraftOp => ({
  op: 'prop', target, key,
  desc: { kind: 'data', value: { ref: { node } }, writable, enumerable, configurable: true },
});

function baseOps(writableMethods: boolean): DraftOp[] {
  const plugin = { node: 'plugins.plugin.proto' } as const;
  const mime = { node: 'plugins.mime.proto' } as const;
  const plugins = { node: 'plugins.array.proto' } as const;
  const mimes = { node: 'plugins.mime-array.proto' } as const;
  return [
    { op: 'alloc', id: 'plugins.plugin.proto', kind: 'object' },
    { op: 'alloc', id: 'plugins.mime.proto', kind: 'object' },
    { op: 'alloc', id: 'plugins.array.proto', kind: 'object' },
    { op: 'alloc', id: 'plugins.mime-array.proto', kind: 'object' },
    { op: 'alloc', id: 'plugins.array', kind: 'object' },
    { op: 'alloc', id: 'plugins.mime-array', kind: 'object' },
    ctor('plugins.plugin.ctor', 'plugins.plugin.ctor', 'Plugin', plugin),
    ctor('plugins.mime.ctor', 'plugins.mime.ctor', 'MimeType', mime),
    ctor('plugins.array.ctor', 'plugins.array.ctor', 'PluginArray', plugins),
    ctor('plugins.mime-array.ctor', 'plugins.mime-array.ctor', 'MimeTypeArray', mimes),
    fn('plugins.window.get', 'plugins.window', 'get plugins'),
    fn('plugins.mime-window.get', 'plugins.mime-window', 'get mimeTypes'),
    fn('plugins.array.length.get', 'plugins.array.length', 'get length'),
    fn('plugins.array.item', 'plugins.array.item', 'item', 1),
    fn('plugins.array.named', 'plugins.array.named', 'namedItem', 1),
    fn('plugins.array.refresh', 'plugins.refresh', 'refresh'),
    fn('plugins.mime-array.length.get', 'plugins.mime-array.length', 'get length'),
    fn('plugins.mime-array.item', 'plugins.mime-array.item', 'item', 1),
    fn('plugins.mime-array.named', 'plugins.mime-array.named', 'namedItem', 1),
    fn('plugins.plugin.name.get', 'plugins.plugin.name', 'get name'),
    fn('plugins.plugin.filename.get', 'plugins.plugin.filename', 'get filename'),
    fn('plugins.plugin.description.get', 'plugins.plugin.description', 'get description'),
    fn('plugins.plugin.length.get', 'plugins.plugin.length', 'get length'),
    fn('plugins.plugin.item', 'plugins.plugin.item', 'item', 1),
    fn('plugins.plugin.named', 'plugins.plugin.named', 'namedItem', 1),
    fn('plugins.mime.type.get', 'plugins.mime.type', 'get type'),
    fn('plugins.mime.suffixes.get', 'plugins.mime.suffixes', 'get suffixes'),
    fn('plugins.mime.description.get', 'plugins.mime.description', 'get description'),
    fn('plugins.mime.enabled.get', 'plugins.mime.enabled', 'get enabledPlugin'),
    { op: 'proto', target: { node: 'plugins.array' }, value: plugins },
    { op: 'proto', target: { node: 'plugins.mime-array' }, value: mimes },
    refProp({ path: 'window' }, 'Plugin', 'plugins.plugin.ctor'),
    refProp({ path: 'window' }, 'MimeType', 'plugins.mime.ctor'),
    refProp({ path: 'window' }, 'PluginArray', 'plugins.array.ctor'),
    refProp({ path: 'window' }, 'MimeTypeArray', 'plugins.mime-array.ctor'),
    refProp(plugin, 'constructor', 'plugins.plugin.ctor'),
    refProp(mime, 'constructor', 'plugins.mime.ctor'),
    refProp(plugins, 'constructor', 'plugins.array.ctor'),
    refProp(mimes, 'constructor', 'plugins.mime-array.ctor'),
    tag(plugin, 'Plugin'), tag(mime, 'MimeType'), tag(plugins, 'PluginArray'), tag(mimes, 'MimeTypeArray'),
    accessor({ path: 'window.Navigator.prototype' }, 'plugins', 'plugins.window.get'),
    accessor({ path: 'window.Navigator.prototype' }, 'mimeTypes', 'plugins.mime-window.get'),
    accessor(plugins, 'length', 'plugins.array.length.get'),
    fnRef(plugins, 'item', 'plugins.array.item', true, writableMethods),
    fnRef(plugins, 'namedItem', 'plugins.array.named', true, writableMethods),
    fnRef(plugins, 'refresh', 'plugins.array.refresh', true, writableMethods),
    accessor(mimes, 'length', 'plugins.mime-array.length.get'),
    fnRef(mimes, 'item', 'plugins.mime-array.item', true, writableMethods),
    fnRef(mimes, 'namedItem', 'plugins.mime-array.named', true, writableMethods),
    accessor(plugin, 'name', 'plugins.plugin.name.get'),
    accessor(plugin, 'filename', 'plugins.plugin.filename.get'),
    accessor(plugin, 'description', 'plugins.plugin.description.get'),
    accessor(plugin, 'length', 'plugins.plugin.length.get'),
    fnRef(plugin, 'item', 'plugins.plugin.item', true, writableMethods),
    fnRef(plugin, 'namedItem', 'plugins.plugin.named', true, writableMethods),
    accessor(mime, 'type', 'plugins.mime.type.get'),
    accessor(mime, 'suffixes', 'plugins.mime.suffixes.get'),
    accessor(mime, 'description', 'plugins.mime.description.get'),
    accessor(mime, 'enabledPlugin', 'plugins.mime.enabled.get'),
    { op: 'order', target: plugins, keys: ['length', 'item', 'namedItem', 'refresh', 'constructor', { symbol: 'toStringTag' }] },
    { op: 'order', target: mimes, keys: ['length', 'item', 'namedItem', 'constructor', { symbol: 'toStringTag' }] },
    { op: 'order', target: plugin, keys: ['name', 'filename', 'description', 'length', 'item', 'namedItem', 'constructor', { symbol: 'toStringTag' }] },
    { op: 'order', target: mime, keys: ['type', 'suffixes', 'description', 'enabledPlugin', 'constructor', { symbol: 'toStringTag' }] },
  ];
}

function chromeOps(): DraftOp[] {
  const ops: DraftOp[] = [];
  for (let index = 0; index < MIMES.length; index++) {
    ops.push(
      { op: 'alloc', id: `plugins.mime.${index}`, kind: 'object' },
      { op: 'proto', target: { node: `plugins.mime.${index}` }, value: { node: 'plugins.mime.proto' } },
      dataRef({ node: 'plugins.mime-array' }, String(index), `plugins.mime.${index}`, true),
      dataRef({ node: 'plugins.mime-array' }, MIMES[index]!.type, `plugins.mime.${index}`, false),
    );
  }
  for (let index = 0; index < NAMES.length; index++) {
    const node = `plugins.plugin.${index}`;
    ops.push(
      { op: 'alloc', id: node, kind: 'object' },
      { op: 'proto', target: { node }, value: { node: 'plugins.plugin.proto' } },
      dataRef({ node: 'plugins.array' }, String(index), node, true),
      dataRef({ node: 'plugins.array' }, NAMES[index]!, node, false),
    );
    for (let mime = 0; mime < MIMES.length; mime++) {
      ops.push(
        dataRef({ node }, String(mime), `plugins.mime.${mime}`, true),
        dataRef({ node }, MIMES[mime]!.type, `plugins.mime.${mime}`, false),
      );
    }
    ops.push({
      op: 'order', target: { node },
      keys: ['0', '1', 'application/pdf', 'text/pdf'],
    });
  }
  ops.push(
    {
      op: 'order', target: { node: 'plugins.array' },
      keys: ['0', '1', '2', '3', '4', ...NAMES],
    },
    {
      op: 'order', target: { node: 'plugins.mime-array' },
      keys: ['0', '1', 'application/pdf', 'text/pdf'],
    },
  );
  return ops;
}

export function operations(shape: Shape): DraftOp[] {
  // Chrome Android: empty PluginArray (no PDF plugin entries). Desktop Chrome ships 5 PDF aliases.
  const pluginOps = shape.target.host === 'chrome' && shape.target.form !== 'mobile'
    ? chromeOps()
    : [];
  return [...baseOps(hasAndroidChromeCapabilities(shape.target)), ...pluginOps];
}

function records(values: readonly string[], prefix: string): Record<string, JsonValue> {
  return Object.fromEntries(values.map((value, index) => [`${prefix}.${index}`, value]));
}

export const pluginsFeature: Feature = {
  id: 'plugins',
  describe: (_context, support) => describeCoverage(support, {
    'plugins.api': 'partial',
    'plugins.data': 'constant',
  }),
  rev: '2',
  requires: ['ua'],
  build: ({ shape }) => {
    const chrome = shape.target.host === 'chrome';
    return {
      binds: [
        ...['plugin', 'mime', 'array', 'mime-array'].map((name) => ({ slot: `plugins.${name}.ctor`, driver: 'plugins', config: { op: 'illegal' } })),
        { slot: 'plugins.window', driver: 'plugins', config: { op: 'node', id: 'plugins.array' } },
        { slot: 'plugins.mime-window', driver: 'plugins', config: { op: 'node', id: 'plugins.mime-array' } },
        ...['plugins.array.length', 'plugins.mime-array.length', 'plugins.plugin.length']
          .map((slot) => ({ slot, driver: 'plugins', config: { op: 'length' } })),
        ...['plugins.array.item', 'plugins.mime-array.item', 'plugins.plugin.item']
          .map((slot) => ({ slot, driver: 'plugins', config: { op: 'item' } })),
        ...['plugins.array.named', 'plugins.mime-array.named', 'plugins.plugin.named']
          .map((slot) => ({ slot, driver: 'plugins', config: { op: 'named' } })),
        { slot: 'plugins.refresh', driver: 'plugins', config: { op: 'void' } },
        { slot: 'plugins.plugin.name', driver: 'plugins', config: { op: 'field', records: chrome ? records(NAMES, 'plugins.plugin') : {} } },
        { slot: 'plugins.plugin.filename', driver: 'plugins', config: { op: 'field', records: chrome ? records(NAMES.map(() => 'internal-pdf-viewer'), 'plugins.plugin') : {} } },
        { slot: 'plugins.plugin.description', driver: 'plugins', config: { op: 'field', records: chrome ? records(NAMES.map(() => DESCRIPTION), 'plugins.plugin') : {} } },
        { slot: 'plugins.mime.type', driver: 'plugins', config: { op: 'field', records: chrome ? records(MIMES.map((mime) => mime.type), 'plugins.mime') : {} } },
        { slot: 'plugins.mime.suffixes', driver: 'plugins', config: { op: 'field', records: chrome ? records(MIMES.map((mime) => mime.suffixes), 'plugins.mime') : {} } },
        { slot: 'plugins.mime.description', driver: 'plugins', config: { op: 'field', records: chrome ? records(MIMES.map((mime) => mime.description), 'plugins.mime') : {} } },
        { slot: 'plugins.mime.enabled', driver: 'plugins', config: { op: 'enabled', id: chrome ? 'plugins.plugin.0' : null } },
      ],
      support: { 'plugins.data': 'emulated' },
    };
  },
};
