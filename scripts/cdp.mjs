// Evaluate an expression in the running JobPilot window over the DevTools protocol.
// Start the app with: electron . --remote-debugging-port=9333   Usage: node scripts/cdp.mjs "<js expression>"
const port = process.env.CDP_PORT || 9333;
const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => {
  console.error(`No app on port ${port}. Start it with: node_modules\\electron\\dist\\electron.exe . --remote-debugging-port=${port}`);
  process.exit(1);
});
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) pending.get(d.id)(d);
  else if (d.method === 'Runtime.exceptionThrown' || d.method === 'Log.entryAdded' || d.method === 'Runtime.consoleAPICalled') console.log('EVENT', JSON.stringify(d.params).slice(0, 600));
};
const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await call('Runtime.enable');
await call('Log.enable');
const t = Date.now();
const res = await call('Runtime.evaluate', { expression: process.argv[2], awaitPromise: true, returnByValue: true });
console.log(`(${Date.now() - t} ms)`, JSON.stringify(res.result?.result?.value ?? res.result, null, 1).slice(0, 4000));
await new Promise((r) => setTimeout(r, 500));
ws.close();
