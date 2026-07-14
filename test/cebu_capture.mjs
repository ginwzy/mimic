import { createMimic } from '../dist/src/public.js';
import { digest, seal } from '../dist/src/core/seal.js';
import { readFile } from 'node:fs/promises';
import { writeSync } from 'node:fs';

const RESULT_PREFIX = '__CEBU_CAPTURE_RESULT__';

function writeResult(value) {
  writeSync(process.stdout.fd, `${RESULT_PREFIX}${JSON.stringify(value)}`);
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readInput() {
  const path = process.argv[2];
  if (path !== undefined) return JSON.parse(await readFile(path, 'utf8'));
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function requireString(input, name) {
  const value = input[name];
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function positiveInteger(value, fallback, name) {
  const output = value ?? fallback;
  if (!Number.isInteger(output) || output < 1) throw new TypeError(`${name} must be a positive integer`);
  return output;
}

async function main() {
  const input = await readInput();
  const pageUrl = requireString(input, 'pageUrl');
  const pageHtml = requireString(input, 'pageHtml');
  const scriptUrl = requireString(input, 'scriptUrl');
  const scriptSource = requireString(input, 'scriptSource');
  const profile = requireString(input, 'profile');
  const cookies = Array.isArray(input.cookies) && input.cookies.every((item) => typeof item === 'string')
    ? input.cookies
    : [];
  const deadlineMs = positiveInteger(input.deadlineMs, 1_000, 'deadlineMs');
  const maxPosts = positiveInteger(input.maxPosts, 1, 'maxPosts');
  const scriptTimeoutMs = positiveInteger(input.scriptTimeoutMs, 8_000, 'scriptTimeoutMs');
  const material = { pageUrl, pageHtml, cookies };
  const page = seal({
    schema: 2,
    id: `cebu-staging-${digest(material).slice(0, 16)}`,
    source: { kind: 'manual', hash: digest(material) },
    url: pageUrl,
    html: pageHtml,
    cookies,
  });
  const mimic = createMimic({
    profile,
    page,
    size: 1,
    timeoutMs: scriptTimeoutMs + deadlineMs + 5_000,
    capture: { deadlineMs, pollMs: 10, maxPosts, lifecycle: 'auto' },
  });

  try {
    const result = await mimic.capture({
      kind: 'capture',
      code: scriptSource,
      scriptUrl,
      timeout: scriptTimeoutMs,
      trace: true,
    });
    if (!result.ok) {
      writeResult({ ok: false, error: result.error });
      process.exitCode = 1;
      return;
    }
    const value = result.value;
    const posts = value && typeof value === 'object' && Array.isArray(value.posts) ? value.posts : [];
    const bodies = posts.flatMap((post) => (
      post && typeof post === 'object' && typeof post.body === 'string' && post.body.length > 0
        ? [post.body]
        : []
    ));
    writeResult({
      ok: true,
      bodies,
      posts: posts.map((post) => ({
        via: post && typeof post === 'object' ? post.via : null,
        tag: post && typeof post === 'object' ? post.tag : null,
        len: post && typeof post === 'object' ? post.len : null,
      })),
    });
  } finally {
    await Promise.race([mimic.close(), delay(2_000)]);
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  writeResult({ ok: false, error: { message } });
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
