import assert from 'node:assert/strict';
import test from 'node:test';
import { Permission, Role } from 'appwrite';
import { canInviteOwner, rowPermissions } from '../appwrite-access.js';

test('two-device simulation: worker syncs and owner reads, but owner cannot write', () => {
  const teamId = 'farm-simulation';
  const permissions = rowPermissions(teamId);
  const worker = { roles: ['owner', 'worker'], localData: null };
  const owner = { roles: ['owner-readonly'], localData: null };
  const row = { permissions, payload: 'initial' };
  const subscribers = [];

  function allowed(actor, action) {
    if (action === 'read') {
      return actor.roles.some(function (role) {
        return permissions.includes(Permission.read(Role.team(teamId, role)));
      }) || permissions.includes(Permission.read(Role.team(teamId)));
    }
    return actor.roles.some(function (role) {
      return permissions.includes(Permission[action](Role.team(teamId, role)));
    });
  }

  function subscribe(actor, callback) {
    subscribers.push(function () {
      if (allowed(actor, 'read')) callback(row.payload);
    });
  }

  function write(actor, payload) {
    if (!allowed(actor, 'update')) throw new Error('permission denied');
    row.payload = payload;
    subscribers.forEach(function (notify) { notify(); });
  }

  subscribe(owner, function (payload) { owner.localData = payload; });
  assert.equal(allowed(worker, 'update'), true);
  assert.equal(allowed(owner, 'read'), true);
  assert.equal(allowed(owner, 'update'), false);

  write(worker, 'worker change');
  worker.localData = row.payload;
  assert.equal(worker.localData, 'worker change');
  assert.equal(owner.localData, 'worker change');
  assert.throws(function () { write(owner, 'unauthorized owner change'); }, /permission denied/);
  assert.equal(row.payload, 'worker change');
});

test('owner invitation requires a different email from the worker', () => {
  assert.equal(canInviteOwner('worker@example.com', 'owner@example.com'), true);
  assert.equal(canInviteOwner(' Worker@example.com ', 'worker@example.com'), false);
});
