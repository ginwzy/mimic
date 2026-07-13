import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { MimicError } from '../core/error.js';
import { parseShape } from '../core/parse.js';
import type { Shape } from '../core/types.js';
import type { Feature } from '../shape/types.js';
import { Catalog } from './index.js';

function badShape(message: string, cause?: unknown): MimicError {
  return new MimicError({
    phase: 'parse',
    code: 'BAD_SHAPE',
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

async function rootDirectory(input: string): Promise<string> {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
    throw badShape('Catalog 目录路径非法');
  }
  const root = path.resolve(input);
  let stat;
  try {
    stat = await lstat(root);
  } catch (cause) {
    throw badShape(`Catalog 目录不可访问:${root}`, cause);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw badShape(`Catalog 路径必须是实际目录:${root}`);
  }
  return root;
}

function checkedShapes(input: readonly unknown[]): Shape[] {
  if (!Array.isArray(input)) throw badShape('Catalog Shapes 必须是数组');
  const shapes = input.map((value) => parseShape(value));
  const seen = new Set<string>();
  for (const shape of shapes) {
    if (seen.has(shape.id)) throw badShape(`Catalog Shape id 重复:${shape.id}`);
    seen.add(shape.id);
  }
  return shapes;
}

export class CatalogFiles {
  private constructor() {}

  static async load(rootInput: string, features: readonly Feature[] = []): Promise<Catalog> {
    const root = await rootDirectory(rootInput);
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (cause) {
      throw badShape(`Catalog 目录读取失败:${root}`, cause);
    }

    const files = entries
      .filter(({ name }) => name.endsWith('.json'))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    const shapes: Shape[] = [];
    for (const entry of files) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw badShape(`Catalog JSON 必须是实际文件:${entry.name}`);
      }
      const filename = path.join(root, entry.name);
      let value: unknown;
      try {
        value = JSON.parse(await readFile(filename, 'utf8')) as unknown;
      } catch (cause) {
        throw badShape(`Catalog JSON 读取失败:${entry.name}`, cause);
      }
      shapes.push(parseShape(value));
    }
    return CatalogFiles.rebuild(shapes, 'files', features);
  }

  static rebuild(
    shapes: readonly unknown[],
    id = 'files',
    features: readonly Feature[] = [],
  ): Catalog {
    return Catalog.create(id, checkedShapes(shapes), features);
  }
}
