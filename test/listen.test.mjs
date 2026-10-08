import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { listenOnFreePort } from '../server/listen.mjs';

async function occupy() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return server;
}
const close = (server) => new Promise((done) => server.close(done));

test('moves to the next port when the first is taken', async () => {
  const busy = await occupy();
  const taken = busy.address().port;
  const built = [];
  const { server, port } = await listenOnFreePort(
    (port) => {
      built.push(port);
      return createServer();
    },
    { port: taken },
  );
  assert.ok(port > taken);
  assert.equal(server.address().port, port);
  assert.equal(built.at(-1), port, 'the server is built for the port it listens on');
  await Promise.all([close(server), close(busy)]);
});

test('a pinned port fails clearly instead of moving', async () => {
  const busy = await occupy();
  const taken = busy.address().port;
  await assert.rejects(
    listenOnFreePort(() => createServer(), { port: taken, fixed: true }),
    new RegExp(`Port ${taken} is in use`),
  );
  await close(busy);
});
