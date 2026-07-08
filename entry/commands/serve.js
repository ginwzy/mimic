export async function serveCommand(_rest, flags) {
  const { startServer } = await import('../server.js');
  startServer({ port: Number(flags.port) || 3000 });
}
