function integerFlag(value, flag, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined) return undefined;
  if (value === true) throw new TypeError(`--${flag} 必须带数值`);
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new TypeError(`--${flag} 必须是 ${min}..${max} 的整数`);
  }
  return n;
}

export async function serveCommand(_rest, flags) {
  const { startServer } = await import('../server.js');
  const host = flags.host;
  if (host !== undefined && (typeof host !== 'string' || !host.trim())) {
    throw new TypeError('--host 必须是非空主机名或 IP');
  }
  const { server } = startServer({
    port: integerFlag(flags.port, 'port', { min: 1, max: 65_535 }) ?? 3000,
    host,
    timeoutMs: integerFlag(flags.timeout, 'timeout'),
    size: integerFlag(flags['pool-size'], 'pool-size'),
    maxQueue: integerFlag(flags['max-queue'], 'max-queue', { min: 0 }),
  });
  server.on('error', (e) => {
    console.error(`serve 启动失败:${e.message}`);
    process.exitCode = 1;
  });
}
