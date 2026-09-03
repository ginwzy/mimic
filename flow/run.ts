import { createLumiProxy, createLumiRelayProxy } from './proxy.js';
import { runAnaFlow, type AnaFlowOptions, type AnaFlowResult } from './suppliers/ana/flow.js';
import { runCebuFlow, type CebuFlowOptions, type CebuFlowResult } from './suppliers/cebu/flow.js';

type ProxyMode = 'none' | 'reqable' | 'lumi' | 'mitm';
type Supplier = 'ana' | 'cebu';
type Log = (message: string) => void;

interface CliOptions {
  supplier: Supplier;
  proxyMode: ProxyMode;
  total: number;
  concurrency: number;
  batch: boolean;
}

interface FlowExecution {
  success: boolean;
  status?: number;
  summary: object;
}

function usage(): string {
  return [
    'Usage: npm run flow -- <ana|cebu> [none|reqable|lumi|mitm] [options]',
    '',
    'Options:',
    '  --total <number>        Total runs (default: 1)',
    '  --concurrency <number>  Maximum concurrent runs (default: 1)',
  ].join('\n');
}

function summarize(result: AnaFlowResult | CebuFlowResult) {
  return {
    profile: result.profile,
    interactionSeed: result.interactionSeed,
    abckBodyCount: result.abckBodyCount,
    abckPostCount: result.abckPostCount,
    bmsPosted: result.bmsPosted,
    abckTilde0: result.abckTilde0,
  };
}

async function runAna(proxyMode: ProxyMode, log: Log): Promise<FlowExecution> {
  const options: AnaFlowOptions = {
    profilesRoot: './profiles',
    verify: true,
    log,
  };
  let sessionId: string | undefined;

  if (proxyMode === 'reqable') {
    options.proxy = 'http://10.5.2.163:9001';
  } else if (proxyMode === 'lumi') {
    const lumi = createLumiProxy({
      customerZone: 'lum-customer-travel_fusion-zone-gen',
      password: 'j48ly0d63top',
      country: 'jp',
    });
    options.proxy = lumi.url;
    sessionId = lumi.sessionId;
  } else if (proxyMode === 'mitm') {
    const relay = createLumiRelayProxy({
      proxyUrl: 'http://127.0.0.1:24800',
      customerZone: 'lum-customer-travel_fusion-zone-gen',
      password: 'j48ly0d63top',
      country: 'jp',
      clientHelloId: 'hellochrome_152',
    });
    options.proxy = relay.url;
    options.proxyHeaders = relay.proxyHeaders;
    sessionId = relay.sessionId;
  }

  const result = await runAnaFlow(options);
  return {
    success: result.verify?.success ?? false,
    ...(result.verify === undefined ? {} : { status: result.verify.status }),
    summary: {
      supplier: 'ana',
      proxy: proxyMode,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...summarize(result),
      verify: result.verify === undefined ? undefined : {
        status: result.verify.status,
        success: result.verify.success,
        class: result.verify.class,
      },
    },
  };
}

async function runCebu(proxyMode: ProxyMode, log: Log): Promise<FlowExecution> {
  const options: CebuFlowOptions = {
    profilesRoot: './profiles',
    search: true,
    log,
  };
  let sessionId: string | undefined;

  if (proxyMode === 'reqable') {
    options.proxy = 'http://10.5.2.163:9001';
  } else if (proxyMode === 'lumi') {
    const lumi = createLumiProxy({
      customerZone: 'lum-customer-travel_fusion-zone-gen',
      password: 'j48ly0d63top',
      country: 'gb',
    });
    options.proxy = lumi.url;
    sessionId = lumi.sessionId;
  } else if (proxyMode === 'mitm') {
    options.proxy = 'http://95.179.202.136:24800';
    options.proxyHeaders = { 'X-ClientHello-Id': 'hellochrome_150' };
  }

  const result = await runCebuFlow(options);
  return {
    success: result.search?.success ?? false,
    ...(result.search === undefined ? {} : { status: result.search.status }),
    summary: {
      supplier: 'cebu',
      proxy: proxyMode,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...summarize(result),
      search: result.search === undefined ? undefined : {
        status: result.search.status,
        success: result.search.success,
      },
    },
  };
}

function parsePositiveInteger(value: string | undefined, option: string): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new Error(`${option} must be a positive integer\n\n${usage()}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer\n\n${usage()}`);
  }
  return parsed;
}

function parseArguments(args: readonly string[]): CliOptions | undefined {
  if (args.includes('--help') || args.includes('-h')) return undefined;

  const [supplier, ...rest] = args;
  if (supplier !== 'ana' && supplier !== 'cebu') throw new Error(`supplier must be ana or cebu\n\n${usage()}`);

  let proxyMode: ProxyMode = 'none';
  let offset = 0;
  const proxyArgument = rest[0];
  if (proxyArgument !== undefined && !proxyArgument.startsWith('--')) {
    if (proxyArgument !== 'none' && proxyArgument !== 'reqable' && proxyArgument !== 'lumi' && proxyArgument !== 'mitm') {
      throw new Error(`proxy mode must be none, reqable, lumi, or mitm\n\n${usage()}`);
    }
    proxyMode = proxyArgument;
    offset = 1;
  }

  let total = 1;
  let concurrency = 1;
  let batch = false;
  for (let index = offset; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--total') {
      total = parsePositiveInteger(rest[index + 1], '--total');
      batch = true;
      index += 1;
    } else if (argument?.startsWith('--total=')) {
      total = parsePositiveInteger(argument.slice('--total='.length), '--total');
      batch = true;
    } else if (argument === '--concurrency') {
      concurrency = parsePositiveInteger(rest[index + 1], '--concurrency');
      batch = true;
      index += 1;
    } else if (argument?.startsWith('--concurrency=')) {
      concurrency = parsePositiveInteger(argument.slice('--concurrency='.length), '--concurrency');
      batch = true;
    } else {
      throw new Error(`unknown option: ${argument ?? ''}\n\n${usage()}`);
    }
  }
  return { supplier, proxyMode, total, concurrency, batch };
}

function runSupplier(supplier: Supplier, proxyMode: ProxyMode, log: Log): Promise<FlowExecution> {
  return supplier === 'ana' ? runAna(proxyMode, log) : runCebu(proxyMode, log);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function runBatch(options: CliOptions): Promise<void> {
  const startedAt = Date.now();
  let nextIndex = 0;
  let completed = 0;
  let successful = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < options.total) {
      const index = nextIndex;
      nextIndex += 1;
      const itemStartedAt = Date.now();
      let success = false;
      let status: number | undefined;
      let failure: string | undefined;
      try {
        const execution = await runSupplier(
          options.supplier,
          options.proxyMode,
          (message) => console.error(`[#${index + 1}] ${message}`),
        );
        status = execution.status;
        success = execution.success;
      } catch (error) {
        failure = errorMessage(error).replace(/\s+/g, ' ').trim();
      }
      const elapsedMs = Date.now() - itemStartedAt;
      completed += 1;
      if (success) successful += 1;
      const failed = completed - successful;
      const rate = ((successful / completed) * 100).toFixed(2);
      const statusText = status === undefined ? '' : ` status=${status}`;
      const failureText = failure === undefined ? '' : ` error=${failure}`;
      console.error(
        `[batch ${completed}/${options.total}] #${index + 1} ${success ? 'SUCCESS' : 'FAILED'}`
        + `${statusText}${failureText} | success=${successful} failed=${failed} rate=${rate}% elapsed=${elapsedMs}ms`,
      );
    }
  };

  const workerCount = Math.min(options.concurrency, options.total);
  await Promise.all(Array.from({ length: workerCount }, worker));
  console.log(JSON.stringify({
    supplier: options.supplier,
    proxy: options.proxyMode,
    total: options.total,
    concurrency: options.concurrency,
    successful,
    failed: options.total - successful,
    successRate: `${((successful / options.total) * 100).toFixed(2)}%`,
    elapsedMs: Date.now() - startedAt,
  }, null, 2));
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (options === undefined) {
    console.log(usage());
    return;
  }

  if (options.batch) {
    await runBatch(options);
  } else {
    const execution = await runSupplier(options.supplier, options.proxyMode, (message) => console.error(message));
    console.log(JSON.stringify(execution.summary, null, 2));
  }
}

await main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
