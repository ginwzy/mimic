export async function baselineCommand(_rest, flags) {
  console.error('[弃用] `mimic baseline` 已并入 `mimic capture`(统一服务一次访问同源产 profile + 结构基线)。转启 capture。');
  const { startCapture } = await import('../../capture/server.js');
  startCapture({ port: Number(flags.port) || 8970 });
}
