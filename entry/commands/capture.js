export async function captureCommand(_rest, flags) {
  const { startCapture } = await import('../../capture/server.js');
  startCapture({ port: Number(flags.port) || 8970 });
}
