/** Browser chat submission regression tests without external DOM dependencies. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function main() {
  const html = fs.readFileSync(path.join(__dirname, '../../cloudflare/public/index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const nodes = Object.fromEntries(['messages', 'input', 'send', 'token', 'save', 'status'].map(id => [id, {
    value: '',
    disabled: false,
    children: [],
    appendChild(child) { this.children.push(child); },
    addEventListener(_name, listener) { this.listener = listener; },
    focus() {}
  }]));
  let calls = 0;
  let resolveResponse;
  const context = vm.createContext({
    document: {
      querySelector: selector => nodes[selector.slice(1)],
      createElement: () => ({})
    },
    sessionStorage: { getItem: () => 'test-token', setItem() {} },
    fetch: () => {
      calls++;
      return new Promise(resolve => { resolveResponse = resolve; });
    }
  });
  vm.runInContext(script, context);
  nodes.input.value = 'first message';
  const pending = nodes.send.onclick();
  assert.strictEqual(calls, 1);
  assert.strictEqual(nodes.send.disabled, true);
  nodes.input.value = 'second message';
  nodes.input.listener({ key: 'Enter', shiftKey: false, preventDefault() {} });
  assert.strictEqual(calls, 1, 'Enter must not create a concurrent chat request while Send is disabled');
  assert.strictEqual(nodes.input.value, 'second message', 'pending input must remain available after the first response');
  resolveResponse({ ok: true, json: async () => ({ reply: 'first answer' }) });
  await pending;
  assert.strictEqual(nodes.send.disabled, false);
  assert.strictEqual(nodes.input.value, 'second message');
  assert.deepStrictEqual(nodes.messages.children.map(node => node.textContent), ['first message', 'first answer']);
  console.log('  ✓ keyboard submission cannot overlap a pending chat request');
  console.log('\nPassed: 1');
  console.log('Failed: 0');
}

main().catch(error => {
  console.log('  ✗ keyboard submission cannot overlap a pending chat request');
  console.log(`    Error: ${error.message}`);
  console.log('\nPassed: 0');
  console.log('Failed: 1');
  process.exitCode = 1;
});
