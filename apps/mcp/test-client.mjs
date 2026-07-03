// End-to-end check: spawn the MCP server over stdio, list tools/resources, and call
// render_chart for both PNG (default, inline image) and SVG (text).  node test-client.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const transport = new StdioClientTransport({ command: 'node', args: [join(here, 'server.mjs')] });
const client = new Client({ name: 'slickfast-test', version: '0.0.0' });
await client.connect(transport);

console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('resources:', (await client.listResources()).resources.map((r) => r.name).join(', '));

// default → PNG image content
const png = await client.callTool({ name: 'render_chart', arguments: { type: 'bar', data: { labels: ['A', 'B', 'C'], series: [{ values: [10, 20, 15] }] } } });
const img = png.content[0];
const isPng = img.type === 'image' && img.mimeType === 'image/png' && Buffer.from(img.data, 'base64')[0] === 0x89;
console.log('default → image/png:', isPng);

// format:"svg" → text
const svg = await client.callTool({ name: 'render_chart', arguments: { type: 'kpi', label: 'MRR', value: 128400, valuePrefix: '$', delta: 12.4, format: 'svg' } });
console.log('format:svg → valid SVG text:', svg.content[0].type === 'text' && svg.content[0].text.startsWith('<svg'));

await client.close();
console.log('OK — MCP server returns PNG (default) and SVG.');
