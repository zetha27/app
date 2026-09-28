import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const bootstrapSource = readFileSync(new URL('../offline-bootstrap.js', import.meta.url), 'utf8');

function setup(cache) {
  const values = new Map();
  const listeners = {};
  const classes = new Set();
  const session = { current: null, data: null };
  const status = { innerHTML: '' };
  const localStorage = {
    getItem: function (key) { return values.has(key) ? values.get(key) : null; },
    setItem: function (key, value) { values.set(key, String(value)); }
  };
  const userId = 'cached-user';
  if (cache) {
    values.set('galpon_appwrite_last_user', userId);
    values.set('galpon_appwrite_cache_v1_' + userId, JSON.stringify(cache));
  }
  const authModule = { addEventListener: function (name, callback) { listeners[name] = callback; } };
  const app = {
    setSession: function (value) { session.current = value; },
    setRemoteData: function (value) { session.data = value; return true; }
  };
  const window = {
    galponApp: app,
    addEventListener: function () {}
  };
  const document = {
    body: { classList: {
      add: function (value) { classes.add(value); },
      remove: function (value) { classes.delete(value); },
      contains: function (value) { return classes.has(value); }
    } },
    querySelector: function () { return authModule; },
    getElementById: function () { return status; },
    createElement: function () { return { addEventListener: function () {} }; }
  };
  vm.runInNewContext(bootstrapSource, { window, document, localStorage, console });
  return { listeners, localStorage, session, status, classes, userId, window };
}

test('cached worker can open offline and persist a pending sync', () => {
  const cache = {
    teamId: 'farm-1',
    role: 'worker',
    email: 'worker@example.com',
    name: 'Trabajador',
    data: { config: {}, gallinas: [], dias: [], pedidos: [], clientes: [], gastos: [] }
  };
  const app = setup(cache);
  app.listeners.error();
  assert.equal(app.classes.has('authenticated'), true);
  assert.equal(app.session.current.role, 'worker');
  assert.match(app.status.innerHTML, /Desconectado/);

  const updatedData = { ...cache.data, dias: [{ id: 'day-1' }] };
  app.window.galponOfflineSession.persist(updatedData);
  assert.equal(
    JSON.parse(app.localStorage.getItem('galpon_appwrite_cache_v1_' + app.userId)).data.dias[0].id,
    'day-1'
  );
  assert.equal(app.localStorage.getItem('galpon_appwrite_cache_v1_' + app.userId + '_pending'), '1');
});

test('invalid local cache does not bypass sign-in', () => {
  const app = setup({ teamId: 'farm-1', role: 'owner', data: { dias: [] } });
  app.listeners.error();
  assert.equal(app.classes.has('authenticated'), false);
  assert.equal(app.session.current, null);
});
