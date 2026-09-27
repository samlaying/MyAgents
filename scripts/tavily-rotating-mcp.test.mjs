import test from 'node:test';
import assert from 'node:assert/strict';

import { createRoundRobin, createTavilyProxy } from './tavily-rotating-mcp.mjs';

test('round robin rotates keys and wraps around', () => {
  const nextKey = createRoundRobin(['key-a', 'key-b', 'key-c']);

  assert.equal(nextKey(), 'key-a');
  assert.equal(nextKey(), 'key-b');
  assert.equal(nextKey(), 'key-c');
  assert.equal(nextKey(), 'key-a');
});

test('proxy forwards each request with the next key and preserves MCP session', async () => {
  const seen = [];
  const proxy = createTavilyProxy({
    keys: ['key-a', 'key-b'],
    endpoint: 'https://example.test/mcp',
    fetchImpl: async (_url, init) => {
      seen.push({
        authorization: init.headers.Authorization,
        session: init.headers['Mcp-Session-Id'],
        body: JSON.parse(init.body),
      });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' },
      });
    },
  });

  const first = await proxy.forward({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  const second = await proxy.forward({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, 'session-1');

  assert.equal(first.sessionId, 'session-1');
  assert.equal(second.sessionId, 'session-1');
  assert.deepEqual(seen.map(item => item.authorization), ['Bearer key-a', 'Bearer key-b']);
  assert.equal(seen[1].session, 'session-1');
});

test('proxy rejects an empty key list', () => {
  assert.throws(() => createTavilyProxy({ keys: [] }), /at least one/i);
});
