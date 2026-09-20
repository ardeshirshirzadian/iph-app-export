// Run: node --test frontend/tests/socialShareUrl.test.cjs
// Executes repository code with in-memory React/network/database mocks only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parse } = require('next/dist/compiled/babel/parser');
const swc = require('next/dist/build/swc');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const prefix = 'https://example.com/';
const atLength = n => prefix + 'a'.repeat(n - prefix.length);
const cases = [
  ...[
    'https://example.com/',
    'https://example.com/path',
    'https://example.com/path/to/page',
    'https://example.com/path?x=1',
    'https://example.com/path#section',
    'https://www.instagram.com/example/',
    'https://www.linkedin.com/posts/example',
    'https://x.com/example/status/123',
    'https://t.me/example',
    'https://t.me/example/1',
    'https://t.me/example/s/1',
    'https://t.me/mgurmass2010Liv/s/1',
    'https://example.com/a%2Fb/%D8%B3?x=a%26b&y=2#part%20one',
    'https://مثال.إختبار/مسیر?زبان=فارسی#بخش',
    'HTTPS://Example.COM:443/Keep%2fCase?x=1#Part',
    'https://example.com:8443/path',
    'https://example.com./path',
    'https://127.0.0.1/path',
    'https://[2001:db8::1]:443/path',
    ' \t\nhttps://example.com/path?x=1#part\r\n ',
  ].map(value => [value, value, true]),
  ['999 characters', atLength(999), true],
  ['1000 characters', atLength(1000), true],
  ['1000 after trimming', `  ${atLength(1000)} \n`, true],
  ['1000 Unicode characters', prefix + '😀'.repeat(1000 - prefix.length), true],
  ...[
    'example.com', 'http://example.com', 'https://',
    'javascript:alert(1)', 'data:text/html,test', 'ftp://example.com',
    'https://bad host.com/', 'https://example.com:bad/',
    'https://user:pass@example.com/', 'https://user@example.com/',
    'https://@example.com/', 'https://:pass@example.com/',
    '', '   ', 'https://exa\nmple.com/', 'https://example.com/a\tb',
    'https://example.com/a\rb', 'https://example.com/a\u0000b',
    'https://example.com/a\u007fb', 'https://example.com/a\u0085b',
    'https://example.com/a b', 'https://example.com/a\u00a0b',
    'https://example.com/\uD800',
    'https:\\example.com', 'https://example.com\\evil',
    'https:/example.com', 'https:example.com', 'https:///example.com',
    'https:////example.com', 'https://?x=1', 'https://#part',
    'https://example.com:', 'https://example.com:65536/',
    'https://example.com:-1/', 'https://[invalid]/',
    'https://.example.com/', 'https://example..com/',
    'https://127.1/', 'https://0x7f000001/', 'https://0177.0.0.1/',
    'https://example.com/%ZZ', 'https://example.com/%2',
  ].map(value => [JSON.stringify(value), value, false]),
  ['1001 characters', atLength(1001), false],
  ['1001 after trimming', ` ${atLength(1001)} `, false],
  ['1001 Unicode characters', prefix + '😀'.repeat(1001 - prefix.length), false],
  ...[null, undefined, 42, false, {}, []].map(value => [String(value), value, false]),
];

async function compile(source) {
  return (await swc.transform(source, {
    jsc: { target: 'es2022', parser: { syntax: 'ecmascript', jsx: true },
      transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  })).code;
}

function execute(code, modules = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(code, {
    exports, URL, console,
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
      return modules[name];
    },
    ...globals,
  });
  return exports;
}

const ready = (async () => {
  await swc.loadBindings();
  const helper = execute(await compile(read('lib/socialShareUrl.js')));
  const client = read('app/quest/QuestClient.js');
  const ast = parse(client, { sourceType: 'module', plugins: ['jsx'] });
  // Compile the actual component and its actual helper import, not a copied
  // handleSubmit implementation. Isolate unrelated Quest UI dependencies.
  const nodes = ast.program.body.filter(node =>
    (node.type === 'ImportDeclaration' && node.source.value === '@/lib/socialShareUrl') ||
    (node.type === 'FunctionDeclaration' && node.id.name === 'SocialShareModal') ||
    (node.type === 'VariableDeclaration' && node.declarations.some(d =>
      ['PLATFORMS', 'PLATFORM_FA'].includes(d.id.name))));
  assert.equal(nodes.length, 4);
  const modal = await compile("import { useState } from 'react';\n" +
    nodes.map(node => client.slice(node.start, node.end)).join('\n') +
    '\nexport { SocialShareModal };');
  const route = await compile(read('app/api/quest/social-share/route.js'));
  // Also syntax-check the complete client module without running its effects.
  await compile(client);
  return { helper, modal, route };
})();

function elements(node, predicate, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) node.forEach(child => elements(child, predicate, result));
  else {
    if (predicate(node)) result.push(node);
    elements(node.props?.children, predicate, result);
  }
  return result;
}

async function submitModal(input, isBadge, lang = 'en') {
  const { helper, modal } = await ready;
  const slots = [];
  let cursor = 0;
  const requests = [];
  let completed = 0;
  const jsx = (type, props) => ({ type, props });
  const { SocialShareModal } = execute(modal, {
    '@/lib/socialShareUrl': helper,
    react: { useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = value; }];
    } },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
  }, { fetch: async (url, options) => {
    requests.push({ url, ...options });
    return { ok: true, json: async () => ({ ok: true, status: 'pending' }) };
  } });
  const render = () => {
    cursor = 0;
    return SocialShareModal({ share: { id: 17, isBadge }, lang,
      onClose() {}, onComplete() { completed++; } });
  };
  elements(render(), n => n.type === 'input')[0].props.onChange({ target: { value: input } });
  const button = elements(render(), n => n.type === 'button' && n.props.children ===
    (lang === 'fa' ? 'ارسال لینک' : 'Submit link'))[0];
  await button.props.onClick();
  return { requests, completed, error: slots[3] };
}

async function submitApi(input, isBadge, eventId, options = {}) {
  const { helper, route } = await ready;
  const queries = [];
  const { POST } = execute(route, {
    '@/lib/socialShareUrl': helper,
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
    'next/headers': { cookies: async () => ({ get: () => options.unauthenticated ? undefined :
      ({ value: encodeURIComponent(JSON.stringify({ uuid: 'test-user' })) }) }) },
    '@/lib/currentEvent': { getCurrentEventId: async () => eventId },
    '@/lib/db': { query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes("status = 'pending'")) return { rows: options.pending ? [{ id: 1 }] : [] };
      if (sql.includes("status = 'approved'")) return { rows: options.approved ? [{ id: 1 }] : [] };
      if (sql.includes('SELECT id FROM quest_content') || sql.includes('SELECT id FROM quest_badges')) {
        return { rows: options.missing ? [] : [{ id: 17 }] };
      }
      assert.ok(sql.includes('INSERT INTO quest_social_share_submissions'));
      return { rows: [] };
    } },
  });
  const response = await POST({ json: async () => ({
    ...(isBadge ? { badgeId: 17 } : { missionId: 17 }), link_url: input, platform: 'Telegram',
  }) });
  return { response, queries };
}

for (const [label, input, accepted] of cases) {
  test(label, async () => {
    const { helper } = await ready;
    const expected = accepted ? input.trim() : null;
    assert.equal(helper.validateSocialShareUrl(input), expected, 'helper');
    for (const isBadge of [false, true]) {
      if (typeof input === 'string') {
        const client = await submitModal(input, isBadge);
        assert.equal(client.requests.length, accepted ? 1 : 0, 'client request count');
        assert.equal(client.completed, accepted ? 1 : 0);
        if (accepted) {
          assert.equal(client.requests[0].url, '/api/quest/social-share');
          const body = JSON.parse(client.requests[0].body);
          assert.equal(body.link_url, expected, 'client preserves evidence URL');
          assert.equal(body[isBadge ? 'badgeId' : 'missionId'], 17);
        } else assert.equal(client.error, 'Enter a valid HTTPS URL.');
      }
      for (const eventId of [41, 73]) {
        const { response, queries } = await submitApi(input, isBadge, eventId);
        assert.equal(response.status, accepted ? 200 : 422, 'independent API validation');
        if (accepted) {
          assert.equal(queries.length, 4);
          const insert = queries[3];
          assert.equal(insert.params[3], expected, 'storage preserves evidence URL');
          assert.equal(insert.params[0], isBadge ? null : 17);
          assert.equal(insert.params[1], isBadge ? 17 : null);
          assert.equal(insert.params[5], eventId);
          assert.equal(queries[2].params[1], eventId, 'ownership uses resolved event');
          assert.equal(response.body.status, 'pending');
        } else {
          assert.equal(queries.length, 0, 'invalid URL never reaches database');
          assert.equal(response.body.error, 'یک لینک HTTPS معتبر وارد کنید.');
        }
      }
    }
  });
}

test('Persian client validation message', async () => {
  const result = await submitModal('http://example.com', false, 'fa');
  assert.equal(result.error, 'یک لینک HTTPS معتبر وارد کنید.');
  assert.equal(result.requests.length, 0);
});

test('authentication, duplicate and ownership guards still prevent insertion', async () => {
  for (const isBadge of [false, true]) {
    for (const [options, status] of [
      [{ unauthenticated: true }, 401], [{ pending: true }, 409],
      [{ approved: true }, 409], [{ missing: true }, 404],
    ]) {
      const { response, queries } = await submitApi('https://t.me/example/1', isBadge, 73, options);
      assert.equal(response.status, status);
      assert.ok(queries.every(q => !q.sql.includes('INSERT')));
    }
  }
});
