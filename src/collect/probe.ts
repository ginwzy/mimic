export type DiffBucket = 'TELL' | 'MISSING' | 'EXTRA' | 'INFO';
export type DiffSeverity = 'fatal' | 'warn' | 'info';

export interface ProbeMeta {
  complete?: boolean;
  probeVersion?: number;
  profile?: string;
  source?: string;
}

export interface FnTell {
  name?: string;
  length?: number;
  toStringNative?: boolean;
  toStringSrc?: string;
  hasOwnToString?: boolean;
  hasPrototype?: boolean;
  ownNames?: string;
}

export interface ProbeFlags {
  writable?: boolean;
  enumerable?: boolean;
  configurable?: boolean;
}

export interface AccessorTell {
  get?: FnTell | null;
  set?: FnTell | null;
}

export interface ProbeKey {
  type?: string;
  flags?: ProbeFlags;
  valueType?: string;
  fn?: FnTell;
  accessor?: AccessorTell;
  error?: string;
}

export type ProbeItemValue = string | number | boolean | null;

export interface ProbeCollection {
  length?: number;
  items?: readonly Readonly<Record<string, ProbeItemValue>>[];
}

export interface ProbeTarget {
  id: string;
  category: 'function' | 'object';
  kind?: string;
  t1?: boolean;
  complete?: boolean;
  resolved?: boolean;
  note?: string;
  error?: string;
  fn?: FnTell;
  tag?: string;
  protoChain?: readonly string[];
  ownKeys?: readonly string[];
  symbolKeys?: readonly string[];
  keys?: Readonly<Record<string, ProbeKey>>;
  collection?: ProbeCollection;
}

export interface ProbeSnapshot {
  meta?: ProbeMeta;
  targets?: readonly ProbeTarget[];
}

export interface DiffEntry {
  targetId: string;
  t1: boolean;
  key: string | null;
  field: string;
  bucket: DiffBucket;
  baseline: unknown;
  mimic: unknown;
  severity: DiffSeverity;
  whitelist: string | null;
}

export interface DiffCounts {
  TELL: number;
  MISSING: number;
  EXTRA: number;
  INFO: number;
}

export interface DiffSummary {
  scope: 'all' | 't1';
  counts: DiffCounts;
  whitelisted: number;
  blockers: readonly DiffEntry[];
  gatePass: boolean;
}

export interface SummaryOptions {
  t1Only?: boolean;
}

const FATAL = new Set([
  'protoChain',
  'tag',
  'key.type',
  'flags.enumerable',
  'fn.name',
  'fn.length',
  'fn.toStringNative',
  'fn.hasOwnToString',
  'collection.length',
  'collection.item',
]);
const EXTRA_FATAL = new Set(['resolved', 'key']);
const FN_FIELDS = [
  'name',
  'length',
  'toStringNative',
  'hasOwnToString',
  'hasPrototype',
  'ownNames',
] as const satisfies readonly (keyof FnTell)[];
const FLAG_FIELDS = ['writable', 'enumerable', 'configurable'] as const satisfies readonly (keyof ProbeFlags)[];

function severityOf(field: string, bucket: DiffBucket): DiffSeverity {
  if (bucket === 'INFO') return 'info';
  if (bucket === 'MISSING') return 'warn';
  if (bucket === 'EXTRA') return EXTRA_FATAL.has(field) ? 'fatal' : 'warn';
  return FATAL.has(field) ? 'fatal' : 'warn';
}

function entry(
  target: ProbeTarget,
  key: string | null,
  field: string,
  bucket: DiffBucket,
  baseline: unknown,
  mimic: unknown,
): DiffEntry {
  return {
    targetId: target.id,
    t1: !!target.t1,
    key: key || null,
    field,
    bucket,
    baseline,
    mimic,
    severity: severityOf(field, bucket),
    whitelist: null,
  };
}

function diffFn(
  target: ProbeTarget,
  key: string | null,
  prefix: 'fn' | 'accessor.get' | 'accessor.set',
  baseline: FnTell | null | undefined,
  mimic: FnTell | null | undefined,
  output: DiffEntry[],
): void {
  if (baseline === undefined) return;
  if (baseline === null) {
    if (mimic !== undefined && mimic !== null) {
      output.push(entry(target, key, `${prefix}.exists`, 'TELL', 'absent', 'present'));
    }
    return;
  }
  if (!mimic) {
    if (prefix.startsWith('accessor.')) {
      output.push(entry(target, key, `${prefix}.exists`, 'TELL', 'present', 'absent'));
    } else {
      output.push(entry(target, key, prefix, 'MISSING', baseline, undefined));
    }
    return;
  }
  for (const field of FN_FIELDS) {
    if (baseline[field] === undefined) continue;
    if (baseline[field] !== mimic[field]) {
      output.push(entry(target, key, `${prefix}.${field}`, 'TELL', baseline[field], mimic[field]));
    }
  }
  if (baseline.toStringSrc !== undefined && baseline.toStringSrc !== mimic.toStringSrc) {
    output.push(entry(target, key, `${prefix}.toStringSrc`, 'INFO', baseline.toStringSrc, mimic.toStringSrc));
  }
}

function diffScalar(
  target: ProbeTarget,
  key: string | null,
  field: string,
  baseline: unknown,
  mimic: unknown,
  output: DiffEntry[],
): void {
  if (baseline === undefined) return;
  if (mimic === undefined) {
    output.push(entry(target, key, field, 'MISSING', baseline, undefined));
  } else if (baseline !== mimic) {
    output.push(entry(target, key, field, 'TELL', baseline, mimic));
  }
}

function diffKey(target: ProbeTarget, key: string, baseline: ProbeKey, mimic: ProbeKey, output: DiffEntry[]): void {
  diffScalar(target, key, 'key.type', baseline.type, mimic.type, output);
  if (baseline.type !== undefined && mimic.type !== undefined && baseline.type !== mimic.type) return;
  if (baseline.flags) {
    for (const field of FLAG_FIELDS) {
      diffScalar(target, key, `flags.${field}`, baseline.flags[field], mimic.flags?.[field], output);
    }
  }
  diffScalar(target, key, 'valueType', baseline.valueType, mimic.valueType, output);
  if (baseline.fn) diffFn(target, key, 'fn', baseline.fn, mimic.fn, output);
  if (baseline.accessor) {
    diffFn(target, key, 'accessor.get', baseline.accessor.get, mimic.accessor?.get, output);
    diffFn(target, key, 'accessor.set', baseline.accessor.set, mimic.accessor?.set, output);
  }
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function diffCollection(
  target: ProbeTarget,
  baseline: ProbeCollection,
  mimic: ProbeCollection,
  output: DiffEntry[],
): void {
  diffScalar(target, null, 'collection.length', baseline.length, mimic.length, output);
  const baselineItems = baseline.items || [];
  const mimicItems = mimic.items || [];
  for (let index = 0; index < baselineItems.length; index++) {
    const baselineItem = baselineItems[index]!;
    const mimicItem = mimicItems[index];
    if (!mimicItem) {
      output.push(entry(target, `[${index}]`, 'collection.item', 'MISSING', baselineItem, undefined));
      continue;
    }
    for (const field of Object.keys(baselineItem)) {
      if (mimicItem[field] === undefined) {
        output.push(entry(target, `[${index}].${field}`, 'collection.item', 'MISSING', baselineItem[field], undefined));
        continue;
      }
      if (baselineItem[field] !== mimicItem[field]) {
        output.push(entry(
          target,
          `[${index}].${field}`,
          'collection.item',
          'TELL',
          baselineItem[field],
          mimicItem[field],
        ));
      }
    }
  }
}

function diffObject(
  target: ProbeTarget,
  baseline: ProbeTarget,
  mimic: ProbeTarget,
  complete: boolean,
  output: DiffEntry[],
): void {
  diffScalar(target, null, 'tag', baseline.tag, mimic.tag, output);
  if (baseline.protoChain) {
    if (!mimic.protoChain) {
      output.push(entry(target, null, 'protoChain', 'MISSING', baseline.protoChain, undefined));
    } else if (!arraysEqual(baseline.protoChain, mimic.protoChain)) {
      output.push(entry(
        target,
        null,
        'protoChain',
        'TELL',
        baseline.protoChain.join(' \u2192 '),
        mimic.protoChain.join(' \u2192 '),
      ));
    }
  }
  const baselineKeys = baseline.keys || {};
  const mimicKeys = mimic.keys || {};
  for (const key of Object.keys(baselineKeys)) {
    if (!(key in mimicKeys)) {
      output.push(entry(target, key, 'key', 'MISSING', 'present', 'absent'));
      continue;
    }
    diffKey(target, key, baselineKeys[key]!, mimicKeys[key]!, output);
  }
  if (complete) {
    for (const key of Object.keys(mimicKeys)) {
      if (!(key in baselineKeys)) output.push(entry(target, key, 'key', 'EXTRA', 'absent', 'present'));
    }
    if (baseline.ownKeys) {
      if (!mimic.ownKeys) {
        output.push(entry(target, null, 'ownKeys', 'MISSING', baseline.ownKeys, undefined));
      } else if (!arraysEqual(baseline.ownKeys, mimic.ownKeys)) {
        const sameSet = baseline.ownKeys.length === mimic.ownKeys.length
          && baseline.ownKeys.every((key) => mimic.ownKeys!.includes(key));
        if (sameSet) {
          output.push(entry(
            target,
            null,
            'ownKeys.order',
            'TELL',
            baseline.ownKeys.join(','),
            mimic.ownKeys.join(','),
          ));
        }
      }
    }
    const baselineSymbols = baseline.symbolKeys || [];
    const mimicSymbols = mimic.symbolKeys || [];
    for (const symbol of baselineSymbols) {
      if (!mimicSymbols.includes(symbol)) output.push(entry(target, symbol, 'symbolKey', 'MISSING', 'present', 'absent'));
    }
    for (const symbol of mimicSymbols) {
      if (!baselineSymbols.includes(symbol)) output.push(entry(target, symbol, 'symbolKey', 'EXTRA', 'absent', 'present'));
    }
  }
  if (baseline.collection) {
    if (mimic.collection) diffCollection(target, baseline.collection, mimic.collection, output);
    else output.push(entry(target, null, 'collection', 'MISSING', baseline.collection, undefined));
  }
}

export function diff(baseline: ProbeSnapshot, mimic: ProbeSnapshot): DiffEntry[] {
  const output: DiffEntry[] = [];
  const completeByDefault = baseline.meta ? baseline.meta.complete !== false : true;
  const mimicTargets = new Map((mimic.targets || []).map((target) => [target.id, target]));
  for (const target of baseline.targets || []) {
    const actual = mimicTargets.get(target.id);
    const complete = target.complete === undefined ? completeByDefault : target.complete;
    if (target.resolved === false) {
      if (complete && actual?.resolved) output.push(entry(target, null, 'resolved', 'EXTRA', false, true));
      continue;
    }
    if (!actual || actual.resolved === false) {
      output.push(entry(target, null, 'resolved', 'MISSING', true, actual ? false : 'absent'));
      continue;
    }
    if (target.category === 'function') diffFn(target, null, 'fn', target.fn, actual.fn, output);
    else diffObject(target, target, actual, complete, output);
  }
  return output;
}

export function summarize(entries: readonly DiffEntry[], options: SummaryOptions = {}): DiffSummary {
  const scoped = options.t1Only ? entries.filter((item) => item.t1) : entries;
  const counts: DiffCounts = { TELL: 0, MISSING: 0, EXTRA: 0, INFO: 0 };
  const blockers: DiffEntry[] = [];
  let whitelisted = 0;
  for (const item of scoped) {
    counts[item.bucket]++;
    if (item.whitelist) {
      whitelisted++;
      continue;
    }
    if (item.bucket === 'TELL' || (item.bucket === 'EXTRA' && item.severity === 'fatal')) blockers.push(item);
  }
  return {
    scope: options.t1Only ? 't1' : 'all',
    counts,
    whitelisted,
    blockers,
    gatePass: blockers.length === 0,
  };
}
