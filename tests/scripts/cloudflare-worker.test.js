/**
 * Cloudflare Worker request validation and upstream failure boundaries.
 * Transpile the Worker in memory so the same tests run on supported Node releases.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');

const { Request, Response } = globalThis;
const ENV = {
  APP_ACCESS_TOKEN: 'test-app-token',
  OPENAI_API_KEY: 'test-openai-token',
  CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) },
  ASSETS: { fetch: async () => new Response('asset') }
};
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function chatRequest(body, token = ENV.APP_ACCESS_TOKEN) {
  return new Request('https://example.test/api/chat', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function withFetch(mock, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

async function assertJsonError(response, status) {
  assert.strictEqual(response.status, status);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.strictEqual(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.strictEqual(typeof body.error, 'string');
  assert.ok(body.error.length > 0);
  assert.ok(!Object.hasOwn(body, 'reply'));
  return body;
}

async function main() {
  const source = fs.readFileSync(path.join(__dirname, '../../cloudflare/src/index.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, Request, Response, URL: globalThis.URL, AbortSignal: globalThis.AbortSignal, fetch: (...args) => globalThis.fetch(...args) });
  const worker = exports.default;

  for (const message of [42, true, {}, [], null]) {
    test(`rejects non-string message ${JSON.stringify(message)} before upstream`, async () => {
      let calls = 0;
      await withFetch(async () => {
        calls++;
        return Response.json({ output_text: 'unexpected' });
      }, async () => {
        await assertJsonError(await worker.fetch(chatRequest({ message }), ENV), 400);
        assert.strictEqual(calls, 0);
      });
    });
  }

  const invalidHistories = [
    {},
    [{ role: 'user', content: {} }],
    [{ role: 'assistant', content: 42 }],
    [{ role: 'system', content: 'instructions' }],
    [null]
  ];
  for (const history of invalidHistories) {
    test(`rejects invalid history ${JSON.stringify(history)} before upstream`, async () => {
      let calls = 0;
      await withFetch(async () => {
        calls++;
        return Response.json({ output_text: 'unexpected' });
      }, async () => {
        await assertJsonError(await worker.fetch(chatRequest({ message: 'hello', history }), ENV), 400);
        assert.strictEqual(calls, 0);
      });
    });
  }

  test('rate limit rejection returns 429 with Retry-After without upstream', async () => {
    let calls = 0;
    await withFetch(async () => { calls++; return Response.json({}); }, async () => {
      const env = { ...ENV, CHAT_RATE_LIMITER: { limit: async () => ({ success: false }) } };
      const response = await worker.fetch(chatRequest({ message: 'hello' }), env);
      await assertJsonError(response, 429);
      assert.strictEqual(response.headers.get('retry-after'), '60');
      assert.strictEqual(calls, 0);
    });
  });

  test('missing rate limiter fails closed without upstream', async () => {
    let calls = 0;
    await withFetch(async () => { calls++; return Response.json({}); }, async () => {
      const env = { ...ENV, CHAT_RATE_LIMITER: undefined };
      await assertJsonError(await worker.fetch(chatRequest({ message: 'hello' }), env), 503);
      assert.strictEqual(calls, 0);
    });
  });

  test('rate limiter failures return generic 503 without secrets or upstream', async () => {
    let calls = 0;
    const privateDetail = `limiter failure ${ENV.OPENAI_API_KEY}`;
    await withFetch(async () => { calls++; return Response.json({}); }, async () => {
      const env = { ...ENV, CHAT_RATE_LIMITER: { limit: async () => { throw new Error(privateDetail); } } };
      const body = await assertJsonError(await worker.fetch(chatRequest({ message: 'hello' }), env), 503);
      assert.ok(!JSON.stringify(body).includes(privateDetail));
      assert.ok(!JSON.stringify(body).includes(ENV.OPENAI_API_KEY));
      assert.strictEqual(calls, 0);
    });
  });

  test('invalid chat input does not consume rate limit quota', async () => {
    let calls = 0;
    const env = { ...ENV, CHAT_RATE_LIMITER: { limit: async () => { calls++; return { success: true }; } } };
    await assertJsonError(await worker.fetch(chatRequest({ message: {} }), env), 400);
    assert.strictEqual(calls, 0);
  });

  test('whitespace-only configured access token denies access', async () => {
    let calls = 0;
    await withFetch(async () => { calls++; return Response.json({}); }, async () => {
      const env = { ...ENV, APP_ACCESS_TOKEN: '   ' };
      await assertJsonError(await worker.fetch(chatRequest({ message: 'hello' }, ''), env), 401);
      assert.strictEqual(calls, 0);
    });
  });

  test('invalid provider JSON returns a JSON 502', async () => {
    await withFetch(async () => new Response('invalid json'), async () => {
      await assertJsonError(await worker.fetch(chatRequest({ message: 'hello' }), ENV), 502);
    });
  });

  test('empty provider output returns a JSON 502', async () => {
    await withFetch(async () => Response.json({ output: [] }), async () => {
      await assertJsonError(await worker.fetch(chatRequest({ message: 'hello' }), ENV), 502);
    });
  });

  test('fetch failures return a generic JSON 502 without secrets', async () => {
    const privateDetail = `connection failed with ${ENV.OPENAI_API_KEY}`;
    await withFetch(async () => { throw new Error(privateDetail); }, async () => {
      const body = await assertJsonError(await worker.fetch(chatRequest({ message: 'hello' }), ENV), 502);
      assert.ok(!JSON.stringify(body).includes(privateDetail));
      assert.ok(!JSON.stringify(body).includes(ENV.OPENAI_API_KEY));
    });
  });

  test('upstream HTTP errors return a generic JSON 502 without provider details', async () => {
    const privateDetail = `invalid key ${ENV.OPENAI_API_KEY}`;
    await withFetch(async () => Response.json({ error: { message: privateDetail } }, { status: 401 }), async () => {
      const body = await assertJsonError(await worker.fetch(chatRequest({ message: 'hello' }), ENV), 502);
      assert.ok(!JSON.stringify(body).includes(privateDetail));
      assert.ok(!JSON.stringify(body).includes(ENV.OPENAI_API_KEY));
    });
  });

  for (const data of [{ output: {} }, { output: [{ content: {} }] }]) {
    test(`malformed upstream output ${JSON.stringify(data)} returns JSON 502`, async () => {
      await withFetch(async () => Response.json(data), async () => {
        await assertJsonError(await worker.fetch(chatRequest({ message: 'hello' }), ENV), 502);
      });
    });
  }

  test('POST health is rejected with an Allow header', async () => {
    const response = await worker.fetch(new Request('https://example.test/api/health', { method: 'POST' }), ENV);
    await assertJsonError(response, 405);
    assert.strictEqual(response.headers.get('allow'), 'GET');
  });

  test('chat requires authentication before calling upstream', async () => {
    let calls = 0;
    await withFetch(async () => { calls++; return Response.json({}); }, async () => {
      await assertJsonError(await worker.fetch(chatRequest({ message: 'hello' }, 'wrong-token'), ENV), 401);
      assert.strictEqual(calls, 0);
    });
  });

  test('valid chat preserves history and returns trimmed text and response ID', async () => {
    await withFetch(async (url, init) => {
      assert.strictEqual(url, 'https://api.openai.com/v1/responses');
      assert.strictEqual(init.method, 'POST');
      assert.strictEqual(init.headers.authorization, `Bearer ${ENV.OPENAI_API_KEY}`);
      const body = JSON.parse(init.body);
      assert.strictEqual(body.store, false);
      assert.deepStrictEqual(body.input, [
        { role: 'assistant', content: 'prior answer' },
        { role: 'user', content: 'hello' }
      ]);
      return Response.json({ id: 'response-test', output_text: '  answer  ' });
    }, async () => {
      const response = await worker.fetch(chatRequest({ message: ' hello ', history: [{ role: 'assistant', content: 'prior answer' }] }), ENV);
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), { reply: 'answer', response_id: 'response-test' });
    });
  });

  test('nested output text is extracted', async () => {
    await withFetch(async () => Response.json({ output: [{ content: [{ type: 'output_text', text: 'nested answer' }] }] }), async () => {
      const response = await worker.fetch(chatRequest({ message: 'hello' }), ENV);
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), { reply: 'nested answer', response_id: null });
    });
  });

  test('reasoning items before message output do not hide the reply', async () => {
    await withFetch(async () => Response.json({ output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: 'answer after reasoning' }] }
    ] }), async () => {
      const response = await worker.fetch(chatRequest({ message: 'hello' }), ENV);
      assert.strictEqual(response.status, 200);
      assert.strictEqual((await response.json()).reply, 'answer after reasoning');
    });
  });

  test('static assets pass the original request to the asset binding', async () => {
    const request = new Request('https://example.test/app.js');
    const expected = new Response('asset contents', { headers: { 'content-type': 'text/javascript' } });
    const env = { ...ENV, ASSETS: { fetch: async received => {
      assert.strictEqual(received, request);
      return expected;
    } } };
    assert.strictEqual(await worker.fetch(request, env), expected);
  });

  let passed = 0;
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (error) {
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${error.message}`);
      failed++;
    }
  }
  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
