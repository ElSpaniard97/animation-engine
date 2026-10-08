export const DEFAULT_PORT = 5173;
// How many ports after the default to try when another program already uses it.
export const PORT_TRIES = 20;

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const failed = (error) => {
      server.off('listening', listening);
      reject(error);
    };
    const listening = () => {
      server.off('error', failed);
      resolve(server);
    };
    server.once('error', failed);
    server.once('listening', listening);
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Starts `makeServer(port)` on the first free loopback port from `port` upward and resolves with
 * {server, port}. With `fixed`, only `port` is tried. The server must be built for its port,
 * because it only answers requests addressed to that exact address.
 */
export async function listenOnFreePort(
  makeServer,
  { port = DEFAULT_PORT, fixed = false, tries = PORT_TRIES } = {},
) {
  const last = fixed ? port : port + tries - 1;
  for (let candidate = port; ; candidate++) {
    try {
      return { server: await listen(makeServer(candidate), candidate), port: candidate };
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || candidate >= last) {
        if (error.code === 'EADDRINUSE') {
          throw Error(
            fixed
              ? `Port ${port} is in use by another program.`
              : `Ports ${port}–${last} are in use by other programs. Set ANIMATION_ENGINE_PORT to a free port.`,
          );
        }
        throw error;
      }
    }
  }
}
