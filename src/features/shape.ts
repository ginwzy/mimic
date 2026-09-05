/** Artifact composition only. Planning consumes compile.ts; execution consumes drivers.ts. */
import type { Shape } from '../core/types.js';
import { MimicError } from '../core/error.js';
import { checkContribution } from '../shape/check.js';
import { callableWrite, operationWrites } from '../shape/writes.js';
import { features } from './compile.js';
import { audioShape } from './audio.shape.js';
import { canvasShape } from './canvas.shape.js';
import { chromeShape, chromeSupport, finalizeChromeShape } from './chrome.shape.js';
import { domShape } from './dom.shape.js';
import { globalsShape } from './globals.shape.js';
import { navShape } from './nav.shape.js';
import { netShape } from './net.shape.js';
import { perfShape } from './perf.shape.js';
import { pluginsShape } from './plugins.shape.js';
import { screenShape } from './screen.shape.js';
import { timeShape } from './time.shape.js';
import { touchShape } from './touch.shape.js';
import { traceShape } from './trace.shape.js';
import { uaShape } from './ua.shape.js';
import { viewShape } from './view.shape.js';
import { webglShape } from './webgl.shape.js';

const builders: Readonly<Record<string, (input: Shape, reserved: ReadonlySet<string>) => Shape>> = {
  view: viewShape, screen: screenShape, chrome: chromeShape,
  touch: input => chromeSupport(touchShape(input)),
  nav: navShape, ua: uaShape, plugins: pluginsShape, globals: globalsShape,
  dom: domShape, net: netShape, time: timeShape, perf: perfShape,
  canvas: canvasShape, webgl: webglShape, audio: audioShape, trace: traceShape,
};

const featuresById = new Map(features.map(feature => [feature.id, feature]));

function reservedMembers(): ReadonlySet<string> {
  const owners = new Map<string, string>();
  for (const feature of features) {
    for (const member of feature.reserves ?? []) {
      const write = callableWrite({ path: member.path }, member.key, member.part);
      const first = owners.get(write);
      if (first !== undefined) {
        throw new MimicError({ phase: 'compile', code: 'WRITE_CONFLICT', message: `Surface ownership conflict:${write}`,
          details: { first, second: feature.id } });
      }
      owners.set(write, feature.id);
    }
  }
  return new Set(owners.keys());
}

export function shape(input: Shape, selected: readonly string[] = features.map(feature => feature.id)): Shape {
  const reserved = reservedMembers();
  const done = new Set<string>();
  const visiting = new Set<string>();
  const writes = new Map<string, string>();
  let output = input;
  const registerWrites = (operations: Shape['ops'], owner: string): void => {
    for (const operation of checkContribution({ operations }).operations ?? []) {
      for (const write of operationWrites(operation)) {
        const first = writes.get(write);
        if (first !== undefined) {
          throw new MimicError({ phase: 'compile', code: 'WRITE_CONFLICT', message: `Shape write conflict:${write}`,
            details: { first, second: owner } });
        }
        writes.set(write, owner);
      }
    }
  };
  registerWrites(input.ops, '_shape');

  const visit = (id: string): void => {
    if (done.has(id)) return;
    const feature = featuresById.get(id);
    const build = Object.hasOwn(builders, id) ? builders[id] : undefined;
    if (!feature || !build) throw new MimicError({ phase: 'compile', code: 'NO_FEATURE', message: `Missing Shape builder:${id}` });
    if (visiting.has(id)) throw new MimicError({ phase: 'compile', code: 'FEATURE_CYCLE', message: `Shape dependency cycle:${id}` });
    visiting.add(id);
    for (const dependency of feature.requires ?? []) visit(dependency);
    // Chrome also contributes host structure to WebView, without an executable chrome Feature.
    if (id === 'touch') visit('chrome');
    const previousOpCount = output.ops.length;
    output = build(output, reserved);
    registerWrites(output.ops.slice(previousOpCount), id);
    visiting.delete(id);
    done.add(id);
  };
  for (const id of selected) visit(id);
  return done.has('chrome') ? finalizeChromeShape(output) : output;
}
