import readline from 'node:readline';

const DEFAULT_ENDPOINT = 'https://mcp.tavily.com/mcp/';

export function createRoundRobin(values) {
  const items = values.filter(value => typeof value === 'string' && value.length > 0);
  if (items.length === 0) throw new Error('Tavily requires at least one API key');
  let index = 0;
  return () => {
    const value = items[index % items.length];
    index += 1;
    return value;
  };
}

function responsePayload(response, requestId) {
  return response.text().then(text => {
    if (!text) return null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      const line = text.split(/\r?\n/).find(item => item.startsWith('data:'));
      return line ? JSON.parse(line.slice(5).trim()) : null;
    }
    return JSON.parse(text);
  }).catch(error => ({
    jsonrpc: '2.0',
    id: requestId ?? null,
    error: { code: -32603, message: `Invalid Tavily MCP response: ${error.message}` },
  }));
}

export function createTavilyProxy({ keys, endpoint = DEFAULT_ENDPOINT, fetchImpl = fetch } = {}) {
  const nextKey = createRoundRobin(keys || []);

  return {
    async forward(message, sessionId) {
      const headers = {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${nextKey()}`,
      };
      if (sessionId) headers['Mcp-Session-Id'] = sessionId;

      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
      });
      const newSessionId = response.headers.get('mcp-session-id') || sessionId;
      if (response.status === 202) return { payload: null, sessionId: newSessionId };
      const payload = await responsePayload(response, message.id);
      if (!response.ok && (!payload || !payload.error)) {
        return {
          payload: {
            jsonrpc: '2.0',
            id: message.id ?? null,
            error: { code: -32603, message: `Tavily MCP HTTP ${response.status}` },
          },
          sessionId: newSessionId,
        };
      }
      return { payload, sessionId: newSessionId };
    },
  };
}

function keysFromEnvironment(env = process.env) {
  const numbered = [env.TAVILY_API_KEY_1, env.TAVILY_API_KEY_2, env.TAVILY_API_KEY_3];
  if (numbered.some(Boolean)) return numbered.filter(Boolean);
  if (env.TAVILY_API_KEYS) {
    try {
      const parsed = JSON.parse(env.TAVILY_API_KEYS);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return env.TAVILY_API_KEYS.split(',').map(value => value.trim()).filter(Boolean);
    }
  }
  return env.TAVILY_API_KEY ? [env.TAVILY_API_KEY] : [];
}

export async function runStdioProxy({ input = process.stdin, output = process.stdout, env = process.env } = {}) {
  const proxy = createTavilyProxy({
    keys: keysFromEnvironment(env),
    endpoint: env.TAVILY_MCP_ENDPOINT || DEFAULT_ENDPOINT,
  });
  const sessions = new Map();
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    const sessionId = sessions.get('default');
    try {
      const result = await proxy.forward(message, sessionId);
      if (result.sessionId) sessions.set('default', result.sessionId);
      if (result.payload) output.write(`${JSON.stringify(result.payload)}\n`);
    } catch (error) {
      output.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: message.id ?? null,
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
      })}\n`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runStdioProxy().catch(error => {
    process.stderr.write(`[tavily-rotating-mcp] ${error.message}\n`);
    process.exitCode = 1;
  });
}
