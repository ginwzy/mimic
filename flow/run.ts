import { createLumiProxy, createLumiRelayProxy } from './proxy.js';
import { runAnaFlow, type AnaFlowOptions, type AnaFlowResult } from './suppliers/ana/flow.js';
import { runCebuFlow, type CebuFlowOptions, type CebuFlowResult } from './suppliers/cebu/flow.js';

type ProxyMode = 'none' | 'reqable' | 'lumi' | 'mitm';

function usage(): string {
  return 'Usage: npm run flow -- <ana|cebu> [none|reqable|lumi|mitm]';
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

async function runAna(proxyMode: ProxyMode): Promise<void> {
  const options: AnaFlowOptions = {
    profilesRoot: './profiles',
    verify: true,
    log: (message) => console.error(message),
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
  console.log(JSON.stringify({
    supplier: 'ana',
    proxy: proxyMode,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...summarize(result),
    verify: result.verify === undefined ? undefined : {
      status: result.verify.status,
      success: result.verify.success,
      class: result.verify.class,
    },
  }, null, 2));
}

async function runCebu(proxyMode: ProxyMode): Promise<void> {
  const options: CebuFlowOptions = {
    profilesRoot: './profiles',
    search: true,
    log: (message) => console.error(message),
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
  console.log(JSON.stringify({
    supplier: 'cebu',
    proxy: proxyMode,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...summarize(result),
    search: result.search === undefined ? undefined : {
      status: result.search.status,
      success: result.search.success,
    },
  }, null, 2));
}

async function main(): Promise<void> {
  const [supplier, proxyMode = 'none'] = process.argv.slice(2);
  if (supplier === '--help' || supplier === '-h') {
    console.log(usage());
    return;
  }
  if (supplier !== 'ana' && supplier !== 'cebu') throw new Error(`supplier must be ana or cebu\n\n${usage()}`);
  if (proxyMode !== 'none' && proxyMode !== 'reqable' && proxyMode !== 'lumi' && proxyMode !== 'mitm') {
    throw new Error(`proxy mode must be none, reqable, lumi, or mitm\n\n${usage()}`);
  }

  if (supplier === 'ana') await runAna(proxyMode);
  else await runCebu(proxyMode);
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exitCode = 1;
});
