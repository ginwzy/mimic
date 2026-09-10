import { randomInt } from 'node:crypto';
import { createLumiProxy, createLumiRelayProxy } from './proxy.js';
import { CapturePool, listAndroidChromeProfiles } from './capture.js';
import { runAnaFlow, type AnaFlowOptions, type AnaFlowResult } from './suppliers/ana/flow.js';
import { runCebuFlow, type CebuFlowOptions, type CebuFlowResult } from './suppliers/cebu/flow.js';
import { runJetstarFlow, type JetstarFlowOptions, type JetstarFlowResult } from './suppliers/jetstar/flow.js';

type ProxyMode = 'none' | 'reqable' | 'lumi' | 'mitm';
type Supplier = 'ana' | 'cebu' | 'jetstar';
type Log = (message: string) => void;

interface CliOptions {
  supplier: Supplier;
  proxyMode: ProxyMode;
  total: number;
  concurrency: number;
  batch: boolean;
  profile?: string;
}

interface FlowExecution {
  success: boolean;
  status?: number;
  classification?: string;
  summary: object;
}

function usage(): string {
  return [
    'Usage: npm run flow -- <ana|cebu|jetstar> [none|reqable|lumi|mitm] [options]',
    '',
    'Options:',
    '  --profile <id>         Full Android Chrome Profile ID (default: random)',
    '  --total <number>        Total runs (default: 1)',
    '  --concurrency <number>  Maximum concurrent runs (default: 1)',
  ].join('\n');
}

function summarize(result: AnaFlowResult | CebuFlowResult | JetstarFlowResult) {
  return {
    profile: result.profile,
    interactionSeed: result.interactionSeed,
    abckBodyCount: result.abckBodyCount,
    abckPostCount: result.abckPostCount,
    bmsPosted: result.bmsPosted,
    abckTilde0: result.abckTilde0,
  };
}

async function runAna(proxyMode: ProxyMode, log: Log, capturePool: CapturePool, profile?: string): Promise<FlowExecution> {
  const options: AnaFlowOptions = {
    capturePool,
    profilesRoot: './profiles',
    ...(profile === undefined ? {} : { profile }),
    verify: true,
    log,
  };
  let sessionId: string | undefined;

  if (proxyMode === 'reqable') {
    options.proxy = 'http://127.0.0.1:9001';
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
    ...(result.verify === undefined ? {} : { status: result.verify.status, classification: result.verify.class }),
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

async function runCebu(proxyMode: ProxyMode, log: Log, capturePool: CapturePool, profile?: string): Promise<FlowExecution> {
  const options: CebuFlowOptions = {
    capturePool,
    profilesRoot: './profiles',
    ...(profile === undefined ? {} : { profile }),
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

async function runJetstar(proxyMode: ProxyMode, log: Log, capturePool: CapturePool, profile?: string): Promise<FlowExecution> {
  const options: JetstarFlowOptions = {
    capturePool, profilesRoot: './profiles', search: true, log,
    ...(profile === undefined ? {} : { profile }),
  };
  let sessionId: string | undefined;
  if (proxyMode === 'reqable') {
    options.proxy = 'http://10.5.2.163:9001';
  } else if (proxyMode === 'lumi') {
    const lumi = createLumiProxy({
      customerZone: 'lum-customer-travel_fusion-zone-gen', password: 'j48ly0d63top',
      country: ['au', 'jp', 'nz'][randomInt(3)]!,
    });
    options.proxy = lumi.url;
    sessionId = lumi.sessionId;
  } else if (proxyMode === 'mitm') {
    const relay = createLumiRelayProxy({
      proxyUrl: 'http://127.0.0.1:24800',
      customerZone: 'lum-customer-travel_fusion-zone-gen', password: 'j48ly0d63top',
      country: ['au', 'jp', 'nz'][randomInt(3)]!, clientHelloId: 'hellochrome_152',
    });
    options.proxy = relay.url;
    options.proxyHeaders = relay.proxyHeaders;
    sessionId = relay.sessionId;
  }
  const result = await runJetstarFlow(options);
  return {
    success: result.search?.success ?? false,
    ...(result.search === undefined ? {} : { status: result.search.status, classification: result.search.class }),
    summary: {
      supplier: 'jetstar', proxy: proxyMode,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...summarize(result), source: result.source, sourceUrl: result.sourceUrl,
      bmsPostCount: result.bmsPostCount, bmsTelemetryPosted: result.bmsTelemetryPosted,
      challengeSolved: result.challengeSolved, secCptState: result.secCptState,
      search: result.search === undefined ? undefined : {
        status: result.search.status, success: result.search.success, class: result.search.class,
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
  if (supplier !== 'ana' && supplier !== 'cebu' && supplier !== 'jetstar') throw new Error(`supplier must be ana, cebu, or jetstar\n\n${usage()}`);

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
  let profile: string | undefined;
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
    } else if (argument === '--profile' || argument?.startsWith('--profile=')) {
      profile = argument === '--profile' ? rest[++index] : argument.slice('--profile='.length);
      if (profile === undefined || profile.trim() === '' || profile.startsWith('--')) {
        throw new Error(`--profile requires a full Android Chrome Profile ID\n\n${usage()}`);
      }
    } else {
      throw new Error(`unknown option: ${argument ?? ''}\n\n${usage()}`);
    }
  }
  return { supplier, proxyMode, total, concurrency, batch, ...(profile === undefined ? {} : { profile }) };
}

function runSupplier(supplier: Supplier, proxyMode: ProxyMode, log: Log, capturePool: CapturePool, profile?: string): Promise<FlowExecution> {
  if (supplier === 'ana') return runAna(proxyMode, log, capturePool, profile);
  if (supplier === 'cebu') return runCebu(proxyMode, log, capturePool, profile);
  return runJetstar(proxyMode, log, capturePool, profile);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function runBatch(options: CliOptions, capturePool: CapturePool): Promise<void> {
  const startedAt = Date.now();
  const profiles = options.profile === undefined ? [...await listAndroidChromeProfiles('./profiles')] : undefined;
  if (profiles?.length === 0) {
    throw new Error('no Android Chrome fp-env records; configure profilesRoot and download data first');
  }
  let nextIndex = 0;
  let roundEnd = 0;
  let completed = 0;
  let successful = 0;
  const errorCounts = new Map<string, number>();

  const worker = async (): Promise<void> => {
    while (nextIndex < roundEnd) {
      const index = nextIndex;
      nextIndex += 1;
      const profile = profiles === undefined ? options.profile : profiles[index % profiles.length]!;
      const itemStartedAt = Date.now();
      let success = false;
      let status: number | undefined;
      let failure: string | undefined;
      try {
        const execution = await runSupplier(
          options.supplier,
          options.proxyMode,
          (message) => console.error(`[#${index + 1}] ${message}`),
          capturePool,
          profile,
        );
        status = execution.status;
        success = execution.success;
        if (!success) {
          failure = status === undefined ? 'unsuccessful result' : `HTTP ${status}`;
          if (execution.classification) failure += ` (${execution.classification})`;
        }
      } catch (error) {
        failure = errorMessage(error).replace(/\s+/g, ' ').trim();
      }
      const elapsedMs = Date.now() - itemStartedAt;
      completed += 1;
      if (success) {
        successful += 1;
      } else {
        const reason = failure ?? 'unsuccessful result';
        errorCounts.set(reason, (errorCounts.get(reason) ?? 0) + 1);
      }
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

  const roundSize = profiles?.length ?? options.total;
  const workerCount = Math.min(options.concurrency, options.total, roundSize);
  if (profiles !== undefined) console.error(`Profile pool=${profiles.length} effectiveConcurrency=${workerCount}`);
  while (nextIndex < options.total) {
    if (profiles !== undefined) {
      for (let index = profiles.length - 1; index > 0; index -= 1) {
        const other = randomInt(index + 1);
        [profiles[index], profiles[other]] = [profiles[other]!, profiles[index]!];
      }
    }
    roundEnd = Math.min(nextIndex + roundSize, options.total);
    // Finish the round before reusing any Profile, including ones held by slower workers.
    await Promise.all(Array.from({ length: workerCount }, worker));
  }
  const failed = options.total - successful;
  console.log(JSON.stringify({
    supplier: options.supplier,
    proxy: options.proxyMode,
    total: options.total,
    concurrency: options.concurrency,
    successful,
    failed,
    successRate: `${((successful / options.total) * 100).toFixed(2)}%`,
    errorDistribution: [...errorCounts]
      .sort(([leftError, leftCount], [rightError, rightCount]) => rightCount - leftCount || leftError.localeCompare(rightError))
      .map(([error, count]) => ({ error, count, percentage: `${((count / failed) * 100).toFixed(2)}%` })),
    elapsedMs: Date.now() - startedAt,
  }, null, 2));
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (options === undefined) {
    console.log(usage());
    return;
  }

  const capturePool = new CapturePool(Math.min(options.concurrency, options.total));
  try {
    if (options.batch) {
      await runBatch(options, capturePool);
    } else {
      const execution = await runSupplier(options.supplier, options.proxyMode, (message) => console.error(message), capturePool, options.profile);
      console.log(JSON.stringify(execution.summary, null, 2));
    }
  } finally {
    await capturePool.close();
  }
}

await main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
