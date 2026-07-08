export async function diffCommand([profile], flags) {
  const { runDiff, formatReport, listBaselines } = await import('../../harness/index.js');
  try {
    const report = await runDiff({
      profile: profile || flags.profile,
      baseline: typeof flags.baseline === 'string' ? flags.baseline : undefined,
      t1Only: !!flags.t1,
    });
    if (flags.json) {
      console.log(JSON.stringify({ summary: report.summary, entries: report.entries }, null, 2));
    } else {
      console.log(formatReport(report, { verbose: !!flags.verbose }));
    }
    process.exitCode = report.summary.gatePass ? 0 : 1;
  } catch (e) {
    console.error(`diff 失败: ${e.message}`);
    const names = listBaselines();
    if (names.length) console.error(`可用基线: ${names.join(', ')}`);
    process.exitCode = 2;
  }
}
