import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Keep every data-dir write inside the test sandbox.
process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-disk-ops-home-'));

const { apply } = await import('../lib/index.js');

function createFakeContext() {
  const state = { commands: [], tools: [], prompts: [], routes: [] };
  const disposer = () => {};
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    effect(fn) {
      const result = fn();
      return typeof result === 'function' ? result : disposer;
    },
    commands: {
      register(definition) {
        state.commands.push(definition);
        return disposer;
      },
    },
    tools: {
      register(definition) {
        state.tools.push(definition);
        return disposer;
      },
    },
    systemPrompt: {
      context(definition) {
        state.prompts.push(definition);
        return disposer;
      },
    },
    webServer: {
      register(definition) {
        state.routes.push(definition);
        return disposer;
      },
    },
    connection: { requestRejection: () => undefined },
    get: () => undefined,
  };
  return { ctx, state };
}

test('apply registers command, tools, route and one prompt section', () => {
  const { ctx, state } = createFakeContext();
  apply(ctx, {});
  assert.equal(state.commands.length, 1);
  assert.equal(state.commands[0].name, 'disk');
  assert.equal(typeof state.commands[0].handler, 'function');
  assert.deepEqual(state.tools.map((tool) => tool.name).sort(), ['disk_clean', 'disk_scan']);
  assert.equal(state.routes.length, 1);
  assert.equal(state.routes[0].path, '/disk-ops');
  assert.equal(typeof state.routes[0].handler, 'function');
  assert.equal(state.prompts.length, 1);
  assert.match(state.prompts[0].text({}), /disk_scan/);
});

test('tool definitions carry a render function', () => {
  const { ctx, state } = createFakeContext();
  apply(ctx, {});
  for (const tool of state.tools) {
    assert.equal(typeof tool.output.render, 'function');
    assert.equal(typeof tool.execute, 'function');
    assert.equal(tool.output.schema.type, 'object');
  }
});

test('route rejects unknown paths with 404 JSON', async () => {
  const { ctx, state } = createFakeContext();
  apply(ctx, {});
  const route = state.routes[0];
  const response = makeResponse();
  await route.handler({ url: '/disk-ops/nope', method: 'GET' }, response.res);
  assert.equal(response.status, 404);
  assert.equal(response.body.ok, false);
});

test('/disk rules renders the builtin table', async () => {
  const { ctx, state } = createFakeContext();
  apply(ctx, {});
  const result = await state.commands[0].handler({ rawInput: 'rules', agent: undefined });
  assert.equal(result.kind, 'success');
  assert.match(result.text, /应用缓存/);
});

test('/disk status reads df without throwing', async () => {
  const { ctx, state } = createFakeContext();
  apply(ctx, {});
  const result = await state.commands[0].handler({ rawInput: 'status', agent: undefined });
  assert.equal(result.kind, 'success');
  assert.match(result.text, /磁盘：/);
});

function makeResponse() {
  const chunks = [];
  const res = {
    status: 0,
    headers: {},
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers ?? {};
    },
    end(body) {
      chunks.push(body);
    },
  };
  return {
    res,
    get status() {
      return res.status;
    },
    get body() {
      const raw = chunks.join('');
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    },
  };
}
