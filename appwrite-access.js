import { Permission, Role } from 'appwrite';

export function rowPermissions(teamId) {
  return [
    Permission.read(Role.team(teamId)),
    Permission.update(Role.team(teamId, 'worker')),
    Permission.delete(Role.team(teamId, 'worker'))
  ];
}

export function canInviteOwner(workerEmail, ownerEmail) {
  return String(workerEmail || '').trim().toLowerCase() !==
    String(ownerEmail || '').trim().toLowerCase();
}
