import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

type Part = 'value' | 'get' | 'set';

interface FnRecord {
  name: string;
  length: number;
  toStringNative: boolean;
  toStringSrc: string;
  hasOwnToString: boolean;
  hasPrototype: boolean;
  ownNames: string;
}

interface Flags {
  writable?: boolean;
  enumerable: boolean;
  configurable: boolean;
}

interface Callable {
  key: string;
  part: Part;
  fn: FnRecord;
  flags: Flags;
}

interface KeyRecord {
  type: 'data' | 'accessor';
  flags: Flags;
  valueType?: string;
  fn?: FnRecord;
  accessor?: { get: FnRecord | null; set: FnRecord | null };
}

interface TargetRecord {
  id: string;
  resolved: boolean;
  ownKeys: string[];
  symbolKeys: string[];
  keys: Record<string, KeyRecord>;
}

interface Baseline {
  targets: TargetRecord[];
}

interface ProtoData {
  owner: string;
  m: Map<number, string[]>;
  g: string[];
  s: string[];
}

interface FnData {
  name: string;
  length: number;
  native: boolean;
  constructable: boolean;
  hasPrototype: boolean;
  keys: string[];
}

type DescData =
  | { kind: 'data'; flags: { writable: boolean; enumerable: boolean; configurable: boolean }; valueType: string; fn?: FnData }
  | { kind: 'accessor'; flags: { enumerable: boolean; configurable: boolean }; get: FnData | null; set: FnData | null };

interface MissingData {
  key: string;
  desc: DescData;
}

interface SurfaceProtoData {
  owner: string;
  keys: string[];
  symbols: SymbolName[];
  missing: MissingData[];
}

interface SurfaceData {
  id: SurfaceId;
  protos: SurfaceProtoData[];
}

type SymbolName = 'toStringTag' | 'unscopables';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'src/v2/features/dom.data.ts');
const MISSING_OUTPUT = path.join(ROOT, 'src/v2/features/dom.missing.data.ts');
const BASELINES = [
  { id: 'wv138', file: 'harness/baselines/android-webview-v138.json' },
  { id: 'c143', file: 'harness/baselines/linux-chrome-v143.json' },
  { id: 'c148', file: 'harness/baselines/macos-chrome-v148.json' },
  { id: 'c149', file: 'harness/baselines/macos-chrome-v149.json' },
] as const;
type SurfaceId = typeof BASELINES[number]['id'];
const OWNERS = [
  'Document.prototype',
  'Node.prototype',
  'EventTarget.prototype',
  'Element.prototype',
  'HTMLElement.prototype',
  'HTMLDivElement.prototype',
  'Event.prototype',
  'Navigator.prototype',
  'Screen.prototype',
] as const;
const EXPECTED = new Map<string, number>([
  ['Document.prototype', 253],
  ['Node.prototype', 31],
  ['EventTarget.prototype', 3],
  ['Element.prototype', 156],
  ['HTMLElement.prototype', 202],
  ['HTMLDivElement.prototype', 2],
  ['Event.prototype', 19],
  ['Navigator.prototype', 17],
  ['Screen.prototype', 6],
]);
const MISSING_EXPECTED: Readonly<Record<SurfaceId, readonly number[]>> = {
  wv138: [82, 0, 1, 39, 33, 0, 0, 38, 5],
  c143: [87, 0, 1, 40, 33, 0, 0, 62, 5],
  c148: [89, 0, 1, 44, 34, 0, 0, 65, 5],
  c149: [89, 0, 1, 45, 34, 0, 0, 65, 5],
};

const order = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const location = (part: Part, key: string): string => `${part}\u0000${key}`;
const SYMBOLS = new Map<string, SymbolName>([
  ['Symbol(Symbol.toStringTag)', 'toStringTag'],
  ['Symbol(Symbol.unscopables)', 'unscopables'],
]);

function fail(message: string): never {
  throw new Error(`v2-dom-data: ${message}`);
}

function parseBaseline(raw: string, file: string): Baseline {
  const value: unknown = JSON.parse(raw);
  if (value === null || typeof value !== 'object' || !Array.isArray((value as { targets?: unknown }).targets)) {
    fail(`${file} has no targets array`);
  }
  return value as Baseline;
}

function targetOf(baseline: Baseline, owner: string, file: string): TargetRecord {
  const target = baseline.targets.find((item) => item.id === owner);
  if (!target || target.resolved !== true || !Array.isArray(target.ownKeys) || !Array.isArray(target.symbolKeys)
    || target.keys === null || typeof target.keys !== 'object') {
    fail(`${file} has no resolved ${owner}`);
  }
  if (new Set(target.ownKeys).size !== target.ownKeys.length || target.ownKeys.some((key) => typeof key !== 'string')) {
    fail(`${file}:${owner} has invalid ownKeys`);
  }
  return target;
}

function callables(target: TargetRecord, file: string): Map<string, Callable> {
  const output = new Map<string, Callable>();
  for (const key of target.ownKeys) {
    const descriptor = target.keys[key];
    if (!descriptor) fail(`${file}:${target.id}.${key} has no key record`);
    if (descriptor.type === 'data' && descriptor.fn) {
      output.set(location('value', key), { key, part: 'value', fn: descriptor.fn, flags: descriptor.flags });
      continue;
    }
    if (descriptor.type !== 'accessor') continue;
    if (!descriptor.accessor) fail(`${file}:${target.id}.${key} has no accessor record`);
    if (descriptor.accessor.get) {
      output.set(location('get', key), { key, part: 'get', fn: descriptor.accessor.get, flags: descriptor.flags });
    }
    if (descriptor.accessor.set) {
      output.set(location('set', key), { key, part: 'set', fn: descriptor.accessor.set, flags: descriptor.flags });
    }
  }
  return output;
}

function validateShape(item: Callable, owner: string): void {
  const expectedName = item.part === 'value' ? item.key : `${item.part} ${item.key}`;
  const expectedLength = item.part === 'set' ? 1 : item.part === 'get' ? 0 : item.fn.length;
  if (item.key === 'constructor') fail(`${owner}.constructor must not be generated`);
  if (item.fn.name !== expectedName) fail(`${owner}.${item.key}.${item.part} has unexpected name ${item.fn.name}`);
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 0 || expectedLength > 3) {
    fail(`${owner}.${item.key}.${item.part} has unsupported length ${String(expectedLength)}`);
  }
  if (item.fn.length !== expectedLength || !item.fn.toStringNative || item.fn.toStringSrc !== ''
    || item.fn.hasOwnToString || item.fn.hasPrototype || item.fn.ownNames !== 'length,name') {
    fail(`${owner}.${item.key}.${item.part} violates the shared function shape`);
  }
  const flags = item.flags;
  if (item.part === 'value') {
    if (flags.writable !== true || flags.enumerable !== true || flags.configurable !== true) {
      fail(`${owner}.${item.key}.value has unexpected descriptor flags`);
    }
  } else if (flags.enumerable !== true || flags.configurable !== true || flags.writable !== undefined) {
    fail(`${owner}.${item.key}.${item.part} has unexpected descriptor flags`);
  }
}

function same(left: Callable, right: Callable): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function realmOwner(window: Window & typeof globalThis, owner: string): object {
  let value: unknown = window;
  for (const key of owner.split('.')) {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null || !(key in value)) {
      fail(`raw jsdom has no ${owner}`);
    }
    value = Reflect.get(value, key);
  }
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) fail(`raw jsdom ${owner} is not an object`);
  return value;
}

function exists(owner: object, item: Callable): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(owner, item.key);
  if (!descriptor) return false;
  const value = item.part === 'value' ? descriptor.value : descriptor[item.part];
  return typeof value === 'function';
}

function fnData(value: FnRecord, label: string): FnData {
  if (typeof value.name !== 'string' || !Number.isSafeInteger(value.length) || value.length < 0
    || value.toStringNative !== true || value.toStringSrc !== '' || value.hasOwnToString !== false
    || value.hasPrototype !== false || value.ownNames !== 'length,name') {
    fail(`${label} has an unsupported function record`);
  }
  return {
    name: value.name,
    length: value.length,
    native: true,
    constructable: false,
    hasPrototype: false,
    keys: ['length', 'name'],
  };
}

function descData(value: KeyRecord, label: string): DescData {
  if (value.flags === null || typeof value.flags !== 'object'
    || typeof value.flags.enumerable !== 'boolean' || typeof value.flags.configurable !== 'boolean') {
    fail(`${label} has invalid descriptor flags`);
  }
  if (value.type === 'data') {
    if (typeof value.flags.writable !== 'boolean' || typeof value.valueType !== 'string') {
      fail(`${label} has an invalid data descriptor`);
    }
    if (value.valueType === 'function' && value.fn === undefined) fail(`${label} has no function record`);
    if (value.valueType !== 'function' && value.fn !== undefined) fail(`${label} has an unexpected function record`);
    return {
      kind: 'data',
      flags: {
        writable: value.flags.writable,
        enumerable: value.flags.enumerable,
        configurable: value.flags.configurable,
      },
      valueType: value.valueType,
      ...(value.fn === undefined ? {} : { fn: fnData(value.fn, `${label}.fn`) }),
    };
  }
  if (value.type !== 'accessor' || value.flags.writable !== undefined || !value.accessor) {
    fail(`${label} has an invalid accessor descriptor`);
  }
  return {
    kind: 'accessor',
    flags: { enumerable: value.flags.enumerable, configurable: value.flags.configurable },
    get: value.accessor.get === null ? null : fnData(value.accessor.get, `${label}.get`),
    set: value.accessor.set === null ? null : fnData(value.accessor.set, `${label}.set`),
  };
}

function symbolNames(target: TargetRecord, file: string): SymbolName[] {
  const output = target.symbolKeys.map((symbol) => {
    if (typeof symbol !== 'string') fail(`${file}:${target.id} has a non-string symbol key`);
    const name = SYMBOLS.get(symbol);
    if (!name) fail(`${file}:${target.id} has unsupported symbol key ${symbol}`);
    return name;
  });
  if (new Set(output).size !== output.length) fail(`${file}:${target.id} has duplicate symbol keys`);
  return output;
}

function surfaceProto(target: TargetRecord, rawOwner: object, owner: string, file: string, expected: number): SurfaceProtoData {
  const missing: MissingData[] = [];
  for (const key of target.ownKeys) {
    if (Object.getOwnPropertyDescriptor(rawOwner, key)) continue;
    const desc = target.keys[key];
    if (!desc) fail(`${file}:${owner}.${key} has no key record`);
    missing.push({ key, desc: descData(desc, `${file}:${owner}.${key}`) });
  }
  if (missing.length !== expected) fail(`${file}:${owner} has ${missing.length} missing keys, expected ${expected}`);
  return {
    owner: `window.${owner}`,
    keys: [...target.ownKeys],
    symbols: symbolNames(target, file),
    missing,
  };
}

function renderList(values: readonly string[], indent: string): string {
  if (values.length === 0) return '[]';
  return `[\n${values.map((value) => `${indent}  ${JSON.stringify(value)},`).join('\n')}\n${indent}]`;
}

function renderCompactList(values: readonly string[], indent: string): string {
  if (values.length === 0) return '[]';
  const lines: string[] = [];
  let line = `${indent}  `;
  for (const value of values) {
    const token = `${JSON.stringify(value)}, `;
    if (line.length > indent.length + 2 && line.length + token.length > 110) {
      lines.push(line.trimEnd());
      line = `${indent}  `;
    }
    line += token;
  }
  lines.push(line.trimEnd());
  return `[\n${lines.join('\n')}\n${indent}]`;
}

function renderMethods(methods: Map<number, string[]>, indent: string): string {
  const entries = [...methods.entries()].sort(([left], [right]) => left - right);
  if (entries.length === 0) return '{}';
  const body = entries.map(([length, names]) => `${indent}  ${length}: ${renderList(names, `${indent}  `)},`).join('\n');
  return `{\n${body}\n${indent}}`;
}

function render(protos: readonly ProtoData[]): string {
  const records = protos.map((proto) => [
    '  {',
    `    owner: ${JSON.stringify(`window.${proto.owner}`)},`,
    `    m: ${renderMethods(proto.m, '    ')},`,
    `    g: ${renderList(proto.g, '    ')},`,
    `    s: ${renderList(proto.s, '    ')},`,
    '  },',
  ].join('\n')).join('\n');
  return `// Generated by scripts/v2-dom-data.ts. Do not edit.\n\n`
    + `export type Len = 0 | 1 | 2 | 3;\n\n`
    + `export interface Proto {\n`
    + `  readonly owner: string;\n`
    + `  readonly m: Readonly<Partial<Record<Len, readonly string[]>>>;\n`
    + `  readonly g: readonly string[];\n`
    + `  readonly s: readonly string[];\n`
    + `}\n\n`
    + `export const PROTOS: readonly Proto[] = [\n${records}\n];\n`;
}

function renderMissing(surfaces: readonly SurfaceData[]): string {
  const entry = (missing: MissingData): string => {
    const { desc, key } = missing;
    if (desc.kind === 'data') {
      if (!desc.flags.writable || !desc.flags.enumerable || !desc.flags.configurable
        || desc.valueType !== 'function' || !desc.fn || desc.fn.name !== key) {
        fail(`${key} cannot use the compact data descriptor encoding`);
      }
      return `d(${JSON.stringify(key)}, ${desc.fn.length})`;
    }
    if (!desc.flags.enumerable || !desc.flags.configurable || !desc.get
      || desc.get.name !== `get ${key}` || desc.get.length !== 0
      || (desc.set !== null && (desc.set.name !== `set ${key}` || desc.set.length !== 1))) {
      fail(`${key} cannot use the compact accessor descriptor encoding`);
    }
    return `a(${JSON.stringify(key)}${desc.set === null ? '' : ', true'})`;
  };
  const proto = (value: SurfaceProtoData): string => [
    '    {',
    `      owner: ${JSON.stringify(value.owner)},`,
    `      keys: ${renderCompactList(value.keys, '      ')},`,
    `      symbols: ${renderCompactList(value.symbols, '      ')},`,
    value.missing.length === 0
      ? '      missing: [],'
      : `      missing: [\n${value.missing.map((item) => `        ${entry(item)},`).join('\n')}\n      ],`,
    '    },',
  ].join('\n');
  const records = surfaces.map((surface) => [
    `  ${surface.id}: [`,
    surface.protos.map(proto).join('\n'),
    '  ],',
  ].join('\n')).join('\n');
  return `// Generated by scripts/v2-dom-data.ts. Do not edit.\n\n`
    + `export type SurfaceId = 'wv138' | 'c143' | 'c148' | 'c149';\n\n`
    + `export interface Fn {\n`
    + `  readonly name: string;\n`
    + `  readonly length: number;\n`
    + `  readonly native: boolean;\n`
    + `  readonly constructable: boolean;\n`
    + `  readonly hasPrototype: boolean;\n`
    + `  readonly keys: readonly string[];\n`
    + `}\n\n`
    + `export interface Flags {\n`
    + `  readonly writable?: boolean;\n`
    + `  readonly enumerable: boolean;\n`
    + `  readonly configurable: boolean;\n`
    + `}\n\n`
    + `export type Desc =\n`
    + `  | { readonly kind: 'data'; readonly flags: Flags; readonly valueType: string; readonly fn?: Fn }\n`
    + `  | { readonly kind: 'accessor'; readonly flags: Flags; readonly get: Fn | null; readonly set: Fn | null };\n\n`
    + `export interface Missing {\n`
    + `  readonly key: string;\n`
    + `  readonly desc: Desc;\n`
    + `}\n\n`
    + `export interface SurfaceProto {\n`
    + `  readonly owner: string;\n`
    + `  readonly keys: readonly string[];\n`
    + `  readonly symbols: readonly ('toStringTag' | 'unscopables')[];\n`
    + `  readonly missing: readonly Missing[];\n`
    + `}\n\n`
    + `const f = (name: string, length: number): Fn => ({\n`
    + `  name, length, native: true, constructable: false, hasPrototype: false, keys: ['length', 'name'],\n`
    + `});\n\n`
    + `const d = (key: string, length: number): Missing => ({\n`
    + `  key,\n`
    + `  desc: {\n`
    + `    kind: 'data',\n`
    + `    flags: { writable: true, enumerable: true, configurable: true },\n`
    + `    valueType: 'function',\n`
    + `    fn: f(key, length),\n`
    + `  },\n`
    + `});\n\n`
    + `const a = (key: string, setter = false): Missing => ({\n`
    + `  key,\n`
    + `  desc: {\n`
    + `    kind: 'accessor',\n`
    + `    flags: { enumerable: true, configurable: true },\n`
    + `    get: f(\`get \${key}\`, 0),\n`
    + `    set: setter ? f(\`set \${key}\`, 1) : null,\n`
    + `  },\n`
    + `});\n\n`
    + `export const SURFACES: Readonly<Record<SurfaceId, readonly SurfaceProto[]>> = {\n${records}\n};\n`;
}

async function generate(): Promise<{ dom: string; missing: string }> {
  const loaded = await Promise.all(BASELINES.map(async ({ id, file }) => {
    const raw = await readFile(path.join(ROOT, file), 'utf8');
    return { id, file, baseline: parseBaseline(raw, file) };
  }));
  const dom = new JSDOM('<!doctype html>', { url: 'https://example.test/' });
  try {
    const window = dom.window as unknown as Window & typeof globalThis;
    const rawOwners = new Map(OWNERS.map((owner) => [owner, realmOwner(window, owner)]));
    const protos: ProtoData[] = [];
    let total = 0;
    for (const owner of OWNERS) {
      const maps = loaded.map(({ file, baseline }) => callables(targetOf(baseline, owner, file), file));
      const common: Callable[] = [];
      for (const [id, item] of maps[0]!) {
        if (item.key === 'constructor') continue;
        const matches = maps.slice(1).map((map) => map.get(id));
        if (matches.some((match) => match === undefined)) continue;
        for (const match of matches) {
          if (!same(item, match!)) fail(`${owner}.${item.key}.${item.part} differs across baselines`);
        }
        validateShape(item, owner);
        common.push(item);
      }
      const rawOwner = rawOwners.get(owner)!;
      const selected = common.filter((item) => exists(rawOwner, item));
      const expected = EXPECTED.get(owner);
      if (selected.length !== expected) fail(`${owner} selected ${selected.length}, expected ${String(expected)}`);
      const data: ProtoData = { owner, m: new Map(), g: [], s: [] };
      for (const item of selected) {
        if (item.part === 'value') {
          const names = data.m.get(item.fn.length) || [];
          names.push(item.key);
          data.m.set(item.fn.length, names);
        } else {
          (item.part === 'get' ? data.g : data.s).push(item.key);
        }
      }
      for (const names of data.m.values()) names.sort(order);
      data.g.sort(order);
      data.s.sort(order);
      total += selected.length;
      protos.push(data);
    }
    if (total !== 689) fail(`selected ${total} callables, expected 689`);
    const surfaces: SurfaceData[] = loaded.map(({ id, file, baseline }) => {
      const expected = MISSING_EXPECTED[id];
      const surfaceProtos = OWNERS.map((owner, index) => {
        const count = expected[index];
        if (count === undefined) fail(`${id}:${owner} has no expected missing count`);
        return surfaceProto(targetOf(baseline, owner, file), rawOwners.get(owner)!, owner, file, count);
      });
      return { id, protos: surfaceProtos };
    });
    return { dom: render(protos), missing: renderMissing(surfaces) };
  } finally {
    dom.window.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) fail(`usage: node scripts/v2-dom-data.ts [--check]`);
  const output = await generate();
  const files = [
    { path: OUTPUT, content: output.dom },
    { path: MISSING_OUTPUT, content: output.missing },
  ];
  if (args[0] === '--check') {
    for (const file of files) {
      let current = '';
      try {
        current = await readFile(file.path, 'utf8');
      } catch {
        fail(`${path.relative(ROOT, file.path)} is missing`);
      }
      if (current !== file.content) fail(`${path.relative(ROOT, file.path)} is stale; run node scripts/v2-dom-data.ts`);
    }
    return;
  }
  await Promise.all(files.map((file) => writeFile(file.path, file.content, 'utf8')));
}

await main();
