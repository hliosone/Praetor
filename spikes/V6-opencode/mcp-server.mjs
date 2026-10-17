// V6 MCP server: streamable HTTP, stateless, one tool get_balance, bearer token required.
// Logs every tool call so the spike can show the model really called it.
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const PORT = Number(process.env.PORT ?? 19011);
const TOKEN = process.env.MCP_TOKEN ?? 'spike-token';

function build() {
  const server = new McpServer({ name: 'praetor-spike', version: '0.0.1' });
  server.registerTool('get_balance', { description: 'Returns the USDC balance of the wallet bound to this token.', inputSchema: {} }, async () => {
    console.log(`${new Date().toISOString()} tool get_balance called`);
    return { content: [{ type: 'text', text: JSON.stringify({ usdc: '5300.00', account: 'bound-to-token' }) }] };
  });
  return server;
}

http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    console.log(`${new Date().toISOString()} rejected ${req.method} ${req.url} (bad bearer)`);
    res.writeHead(401).end('unauthorized');
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = build();
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
}).listen(PORT, '127.0.0.1', () => console.log(`mcp spike on 127.0.0.1:${PORT}`));
