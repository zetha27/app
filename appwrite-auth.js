import {
  Account,
  ID,
  Query,
  TablesDB,
  Teams
} from 'appwrite';
import { client } from './appwrite-client.js';
import { canInviteOwner, rowPermissions } from './appwrite-access.js';

const account = new Account(client);
const tables = new TablesDB(client);
const teams = new Teams(client);
const DATABASE_ID = '6ab752bb0016a137498d';
const TABLE_ID = '6ab7570700016ad274cc';
const SECTIONS = ['config', 'gallinas', 'dias', 'pedidos', 'clientes', 'gastos'];
const root = document.getElementById('authRoot');
const ROW_CACHE_KEY = 'galpon_appwrite_cache_v1_';
const LAST_USER_KEY = 'galpon_appwrite_last_user';
const PENDING_WORKER_KEY = 'galpon_appwrite_pending_worker_';

let activeUser = null;
let activeTeamId = null;
let activeRole = null;
let rowsBySection = {};
let unsubscribeRealtime = null;
let syncQueue = Promise.resolve();
let submitting = false;
let remoteReady = false;
let connectionAvailable = navigator.onLine;
let realtimeRefreshTimer = null;
let realtimeRefreshQueue = Promise.resolve();
let localSyncDepth = 0;
let realtimeRefreshPending = false;
let localWriteVersion = 0;
window.galponAppwriteAuthReady = true;

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character];
  });
}

function appApi() {
  return window.galponApp;
}

function normalizedData(data) {
  return {
    config: data && data.config && typeof data.config === 'object' ? data.config : {},
    gallinas: Array.isArray(data && data.gallinas) ? data.gallinas : [],
    dias: Array.isArray(data && data.dias) ? data.dias : [],
    pedidos: Array.isArray(data && data.pedidos) ? data.pedidos : [],
    clientes: Array.isArray(data && data.clientes) ? data.clientes : [],
    gastos: Array.isArray(data && data.gastos) ? data.gastos : []
  };
}

function isNetworkFailure(error) {
  if (!navigator.onLine) return true;
  const message = String(error && (error.message || error.type) || error || '').toLowerCase();
  return Number(error && error.code) === 0 ||
    /network|failed to fetch|fetch failed|socket|connection|timeout|timed out|offline|load failed/.test(message);
}

function invitationParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    teamId: params.get('teamId'),
    membershipId: params.get('membershipId'),
    userId: params.get('userId'),
    secret: params.get('secret')
  };
}

function hasInvitation(params) {
  return Boolean(params.teamId && params.membershipId && params.userId && params.secret);
}

function clearInvitationParams() {
  const url = new URL(window.location.href);
  ['teamId', 'membershipId', 'userId', 'secret'].forEach(function (key) {
    url.searchParams.delete(key);
  });
  window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
}

function setError(message) {
  const error = document.getElementById('authError');
  if (error) error.textContent = message;
}

function renderAuth(content) {
  root.innerHTML = '<main class="auth-card"><div class="auth-brand"><h1>Mi Galpón</h1>' +
    '<p>Tu galpón, al día en todos tus teléfonos.</p></div>' + content + '</main>';
}

function authForm(mode, invitation, emailValue) {
  const registering = mode === 'register';
  const inviteFlow = registering && invitation;
  const inviteText = invitation
    ? '<p class="auth-code-help">Invitación recibida. Al continuar, se validará desde el enlace enviado a tu correo.</p>'
    : '';
  renderAuth(
    '<h2>' + (registering ? 'Crear cuenta' : 'Iniciar sesión') + '</h2>' +
    '<p class="auth-copy">' + (registering
      ? 'Usa un correo y una contraseña para crear tu cuenta.'
      : 'Ingresa con el correo y la contraseña de tu cuenta Appwrite.') + '</p>' +
    inviteText +
    '<form id="authForm" data-mode="' + mode + '">' +
    (inviteFlow
      ? '<p class="auth-success">Esta invitación te dará acceso de dueño, solo lectura.</p>'
      : '<label>Correo electrónico<input name="email" type="email" autocomplete="email" required placeholder="Correo electrónico" value="' + escapeHtml(emailValue || '') + '"></label>') +
    '<label>' + (inviteFlow ? 'Crea tu contraseña' : 'Contraseña') + '<input name="password" type="password" autocomplete="' +
      (registering ? 'new-password' : 'current-password') +
      '" minlength="8" required placeholder="Contraseña (mínimo 8 caracteres)"></label>' +
    (registering && !inviteFlow
      ? '<label>Nombre<input name="name" autocomplete="name" maxlength="128" placeholder="Tu nombre"></label>' +
        '<fieldset class="auth-role-set"><legend class="auth-copy">Tipo de cuenta</legend>' +
        '<div class="auth-roles"><label class="auth-role"><input type="radio" name="role" value="worker" checked> Trabajador</label>' +
          '<label class="auth-role"><input type="radio" name="role" value="owner"> Dueño</label></div></fieldset>' +
        '<label id="farmNameWrap">Nombre del galpón<input name="farmName" maxlength="128" value="Mi galpón"></label>' +
      ''
      : registering && inviteFlow
        ? '<label>Nombre<input name="name" autocomplete="name" maxlength="128" placeholder="Tu nombre"></label>'
        : '') +
    '<p class="auth-error" id="authError" role="alert"></p>' +
    '<button class="auth-primary" type="submit">' +
      (inviteFlow ? 'Aceptar invitación' : registering ? 'Crear cuenta' : 'Entrar') + '</button>' +
    '</form><div class="auth-divider"></div><p class="auth-switch">' +
    (inviteFlow
      ? '¿Ya tienes cuenta Appwrite? <button type="button" data-auth-mode="login">Inicia sesión con tu correo de dueño</button>'
      : registering
        ? '¿Ya tienes cuenta? <button type="button" data-auth-mode="login">Inicia sesión</button>'
        : '¿No tienes cuenta? <button type="button" data-auth-mode="register">Crear cuenta</button>') +
    '</p><p class="auth-note">El trabajador registra y modifica la información. El dueño solo puede consultarla.</p>'
  );

  root.querySelectorAll('input[name="role"]').forEach(function (input) {
    input.addEventListener('change', function () {
      const field = document.getElementById('farmNameWrap');
      if (field) field.hidden = input.value !== 'worker' || !input.checked;
    });
  });
}

function showLogin(message, canSwitchAccount, emailValue) {
  authForm('login', false, emailValue);
  if (!message && hasInvitation(invitationParams())) {
    message = 'Esta invitación es para el dueño. Usa el correo y la contraseña del dueño, no los del trabajador.';
  }
  if (message) setError(message);
  if (canSwitchAccount) {
    const form = root.querySelector('#authForm');
    form.insertAdjacentHTML('afterend',
      '<p class="auth-switch"><button type="button" data-sign-out>Cerrar sesión de la otra cuenta</button></p>');
  }
}

function showInviteAccountMismatch(workerEmail) {
  renderAuth(
    '<h2>Sesión de trabajador abierta</h2>' +
    '<p class="auth-copy">Este enlace es para el dueño, pero en este teléfono está iniciada la sesión de ' +
    '<strong>' + escapeHtml(workerEmail || 'otra cuenta') + '</strong>. Cierra esa sesión y luego entra con el correo del dueño invitado.</p>' +
    '<p class="auth-error" id="authError" role="alert"></p>' +
    '<button class="auth-primary" type="button" data-sign-out>Cerrar sesión del trabajador</button>'
  );
}

function showRegister(message) {
  authForm('register', hasInvitation(invitationParams()));
  if (message) setError(message);
}

function showBusy(message) {
  renderAuth('<p class="auth-loading">' + escapeHtml(message) + '</p>');
}

function showPendingOwner(email) {
  renderAuth(
    '<h2>Falta la invitación del galpón</h2>' +
    '<p class="auth-copy">La cuenta <strong>' + escapeHtml(email) +
    '</strong> ya existe. Pídele al trabajador que envíe la invitación a este mismo correo. ' +
    'Cuando llegue, abre el enlace de invitación para activar el acceso de solo lectura.</p>' +
    '<p class="auth-error" id="authError" role="alert"></p>' +
    '<button class="auth-primary" type="button" data-sign-out>Cerrar sesión</button>'
  );
}

function showRegistrationRecovery(user, message) {
  renderAuth(
    '<h2>Cuenta creada</h2>' +
    '<p class="auth-success">La cuenta Appwrite de <strong>' + escapeHtml(user.email || '') +
    '</strong> ya existe y la sesión está iniciada.</p>' +
    '<p class="auth-copy">No vuelvas a crear la cuenta. Se detuvo el resto del proceso al preparar el galpón.</p>' +
    '<p class="auth-error" id="authError" role="alert">' + escapeHtml(message) + '</p>' +
    '<button class="auth-primary" type="button" id="retrySetup">Reintentar y entrar</button>' +
    '<p class="auth-switch"><button type="button" data-sign-out>Cerrar sesión</button></p>'
  );
  document.getElementById('retrySetup').addEventListener('click', async function (event) {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = 'Conectando…';
    try {
      const currentUser = await account.get();
      const accepted = await acceptInvitation(currentUser);
      await openSession(currentUser, accepted);
    } catch (error) {
      console.error('No se pudo reanudar la configuración del galpón:', error);
      showRegistrationRecovery(user, errorText(error));
    }
  });
}

function errorText(error, stage) {
  const code = Number(error && error.code);
  const message = String(error && error.message || '');
  if (!navigator.onLine || /network|fetch|socket/i.test(message)) {
    return 'No hay conexión con Appwrite. Revisa internet e inténtalo de nuevo.';
  }
  if (code === 401 && stage === 'invite') {
    return 'No se pudo aceptar la invitación. Comprueba que el enlace sea el más reciente y que pertenezca a este proyecto. ' +
      'Si el dueño ya tiene cuenta Appwrite, elige «Inicia sesión con tu correo de dueño» y usa su correo y contraseña, no los del trabajador.';
  }
  if (code === 401 && stage === 'invite-password') {
    return 'La invitación inició sesión, pero Appwrite no permitió establecer esta contraseña. Si el dueño ya tenía cuenta, vuelve al enlace y elige «Inicia sesión con tu correo de dueño».';
  }
  if (code === 401) return 'El correo o la contraseña no son correctos. Si todavía no tienes cuenta, créala primero.';
  if (code === 403) return 'Appwrite rechazó el acceso. Revisa permisos de la tabla, seguridad por fila y membresía del equipo.';
  if (code === 501 && /invite|invitation/i.test(message)) {
    return 'Appwrite tiene desactivadas las invitaciones para este proyecto. Actívalas en la consola de Appwrite, en la configuración de Auth/Teams (Invites), y vuelve a intentarlo. Usa un correo distinto al de la cuenta trabajadora para el dueño.';
  }
  if (code === 404) {
    return 'Appwrite no encuentra el recurso solicitado (base de datos: ' + DATABASE_ID +
      ', tabla: ' + TABLE_ID + '). En la consola, abre la base de datos y la tabla y compara sus campos «ID» con estos valores. ' +
      'Asegúrate también de que ambos recursos pertenezcan al proyecto ' +
      client.config.project + '.' + (message ? ' Respuesta: ' + message : '');
  }
  if (code === 409) return 'Ese correo ya tiene cuenta o el galpón ya existe. Inicia sesión o revisa la invitación.';
  return 'No se pudo completar la operación de Appwrite' +
    (code ? ' (código ' + code + ')' : '') +
    (message ? ': ' + message : '.');
}

function setSubmitting(value, label) {
  submitting = value;
  const button = root.querySelector('button[type="submit"]');
  if (button) {
    button.disabled = value;
    button.textContent = value ? (label || 'Un momento…') :
      (hasInvitation(invitationParams()) && root.querySelector('#authForm').dataset.mode === 'register'
        ? 'Aceptar invitación'
        : root.querySelector('#authForm').dataset.mode === 'register' ? 'Crear cuenta' : 'Entrar');
  }
}

function clearRealtime() {
  if (unsubscribeRealtime) unsubscribeRealtime();
  unsubscribeRealtime = null;
}

function saveCache(userId, data) {
  try {
    localStorage.setItem(ROW_CACHE_KEY + userId, JSON.stringify({
      teamId: activeTeamId,
      role: activeRole,
      email: activeUser && activeUser.email || '',
      name: activeUser && activeUser.name || '',
      data: normalizedData(data)
    }));
    localStorage.setItem(LAST_USER_KEY, userId);
  } catch (error) {
    console.error('No se pudo guardar la copia local de Appwrite:', error);
  }
}

function getCachedSession(userId) {
  try {
    const raw = localStorage.getItem(ROW_CACHE_KEY + userId);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error('No se pudo leer la copia local de Appwrite:', error);
    return null;
  }
}

function setAccountBar() {
  document.body.dataset.role = activeRole;
  document.getElementById('accountBar').innerHTML = '';
  const status = document.createElement('span');
  status.className = 'connection-status';
  status.id = 'connectionStatus';
  status.setAttribute('role', 'status');
  status.dataset.state = connectionAvailable ? 'online' : 'offline';
  status.textContent = connectionAvailable ? 'En línea' : 'Desconectado';
  document.getElementById('accountBar').appendChild(status);
}

function restoreCachedSession(userId, cached) {
  if (!userId || !cached || !cached.teamId || !cached.data ||
      !Array.isArray(cached.data.gallinas) ||
      !Array.isArray(cached.data.dias) ||
      !Array.isArray(cached.data.pedidos) ||
      (cached.role !== 'worker' && cached.role !== 'owner')) return false;
  connectionAvailable = false;
  activeUser = { $id: userId, email: cached.email || '', name: cached.name || '' };
  activeTeamId = cached.teamId;
  activeRole = cached.role;
  appApi().setSession({
    role: activeRole,
    email: activeUser.email,
    name: activeUser.name,
    farmId: activeTeamId
  });
  document.body.classList.add('authenticated');
  setAccountBar();
  if (!appApi().setRemoteData(normalizedData(cached.data), userId)) {
    document.body.classList.remove('authenticated');
    document.body.removeAttribute('data-role');
    activeUser = null;
    activeTeamId = null;
    activeRole = null;
    remoteReady = false;
    appApi().setSession(null);
    return false;
  }
  remoteReady = true;
  root.innerHTML = '';
  return true;
}

function updateConnectionStatus(label, state) {
  const status = document.getElementById('connectionStatus');
  if (status) {
    status.textContent = label;
    status.dataset.state = state;
  }
}

let connectionCheckRunning = false;
async function verifyConnection() {
  if (connectionCheckRunning || !activeUser || !activeTeamId || !navigator.onLine ||
      !window.appwritePingCheck) return;
  connectionCheckRunning = true;
  try {
    await window.appwritePingCheck();
    connectionAvailable = true;
    const status = document.getElementById('connectionStatus');
    if (status && status.dataset.state !== 'online' && status.dataset.state !== 'syncing') {
      updateConnectionStatus('En línea', 'online');
    }
  } catch (error) {
    if (isNetworkFailure(error)) {
      connectionAvailable = false;
      updateConnectionStatus('Desconectado', 'offline');
    } else {
      updateConnectionStatus('Error de conexión', 'error');
    }
  } finally {
    connectionCheckRunning = false;
  }
}

function hideApp() {
  clearRealtime();
  clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = null;
  realtimeRefreshPending = false;
  activeUser = null;
  activeTeamId = null;
  activeRole = null;
  remoteReady = false;
  rowsBySection = {};
  document.body.classList.remove('authenticated');
  document.body.classList.remove('home-tab', 'settings-active', 'no-fab-space', 'home-entering', 'home-chart-entering', 'eggs-tab', 'orders-tab');
  document.body.removeAttribute('data-role');
  document.getElementById('accountBar').innerHTML = '';
  if (appApi()) appApi().setSession(null);
}

function rowIdFor(teamId, section) {
  return teamId + '_' + section;
}

async function listTeamRows(teamId) {
  const result = await tables.listRows({
    databaseId: DATABASE_ID,
    tableId: TABLE_ID,
    queries: [Query.equal('teamId', [teamId]), Query.limit(100)],
    total: false
  });
  const bySection = {};
  result.rows.forEach(function (row) {
    if (SECTIONS.indexOf(row.section) !== -1) bySection[row.section] = row;
  });
  return bySection;
}

async function readRemoteData(teamId) {
  rowsBySection = await listTeamRows(teamId);
  const missing = SECTIONS.filter(function (section) {
    return !rowsBySection[section];
  });
  if (missing.length) {
    throw new Error('Faltan secciones en galpon_datos: ' + missing.join(', ') +
      '. Revisa que el trabajador haya inicializado el galpón.');
  }
  const values = {};
SECTIONS.forEach(function (section) {
  const row = rowsBySection[section];
  try {
    values[section] = JSON.parse(row.payload);
    if (section === 'config' && row.subscriptionUntil) {
      values.config.subscriptionUntil = row.subscriptionUntil;
    }
  } catch (error) {
    throw new Error('La información de la sección ' + section + ' no es JSON válido.');
  }
});
  const normalized = normalizedData(values);
if (values.config && values.config.subscriptionUntil) {
  normalized.config.subscriptionUntil = values.config.subscriptionUntil;
}
return normalized;
}

async function refreshRemoteData() {
  if (!activeTeamId || !activeUser) return;
  const teamId = activeTeamId;
  const userId = activeUser.$id;
  const versionAtStart = localWriteVersion;
  if (deferRealtimeRefreshWhileEditing(teamId)) return;
  const data = await readRemoteData(teamId);
  if (activeTeamId !== teamId || !activeUser || activeUser.$id !== userId) return;
  if (versionAtStart !== localWriteVersion || localSyncDepth) {
    realtimeRefreshPending = true;
    return;
  }
  if (deferRealtimeRefreshWhileEditing(teamId)) return;
  if (appApi().setRemoteData(data, userId)) {
    remoteReady = true;
    saveCache(userId, data);
  }
}

function deferRealtimeRefreshWhileEditing(teamId) {
  if (!document.activeElement ||
      !document.activeElement.matches('input,textarea,select,[contenteditable="true"]')) return false;
  if (!realtimeRefreshPending) {
    realtimeRefreshPending = true;
    document.addEventListener('focusout', function refreshAfterEditing() {
      if (document.activeElement &&
          document.activeElement.matches('input,textarea,select,[contenteditable="true"]')) return;
      document.removeEventListener('focusout', refreshAfterEditing);
      realtimeRefreshPending = false;
      scheduleRealtimeRefresh(teamId);
    });
  }
  return true;
}

function scheduleRealtimeRefresh(teamId) {
  if (localSyncDepth) {
    realtimeRefreshPending = true;
    return;
  }
  clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = setTimeout(function () {
    realtimeRefreshQueue = realtimeRefreshQueue.then(async function () {
      if (!activeTeamId || activeTeamId !== teamId || !navigator.onLine || localSyncDepth) {
        realtimeRefreshPending = true;
        return;
      }
      await refreshRemoteData();
    }).catch(function (error) {
      console.error('No se pudieron actualizar los datos en tiempo real:', error);
      appApi().showCloudError(errorText(error));
    });
  }, 250);
}

async function acceptInvitation(user) {
  const invite = invitationParams();
  if (!hasInvitation(invite)) return false;
  if (invite.userId !== user.$id) {
    throw new Error('Esta invitación pertenece a otro correo. Cierra sesión y entra con la cuenta invitada.');
  }
  await teams.updateMembershipStatus({
    teamId: invite.teamId,
    membershipId: invite.membershipId,
    userId: invite.userId,
    secret: invite.secret
  });
  clearInvitationParams();
  return true;
}

async function loadUserTeam(user) {
  const result = await teams.list({ total: false });
  const memberships = [];
  for (const team of result.teams) {
    const own = await teams.listMemberships({
      teamId: team.$id,
      queries: [Query.equal('userId', [user.$id])],
      total: false
    });
    const membership = own.memberships.find(function (item) {
      return item.userId === user.$id && item.confirm;
    });
    if (membership) memberships.push({ team: team, membership: membership });
  }
  if (!memberships.length) return null;
  const selected = memberships[0];
  const roles = selected.membership.roles || [];
  const role = roles.indexOf('worker') !== -1
    ? 'worker'
    : roles.indexOf('owner-readonly') !== -1 ? 'owner' : null;
  if (!role) throw new Error('La membresía no tiene un rol reconocido. Pide al trabajador que envíe una nueva invitación.');
  return { teamId: selected.team.$id, role: role };
}

async function startRealtime(teamId) {
  clearRealtime();
  unsubscribeRealtime = client.subscribe(
    'tablesdb.' + DATABASE_ID + '.tables.' + TABLE_ID + '.rows',
    function () {
      if (!activeTeamId || activeTeamId !== teamId || !navigator.onLine) return;
      scheduleRealtimeRefresh(teamId);
    }
  );
}

async function loadWorkerCount(teamId) {
  let offset = 0;
  let count = 0;
  let memberships;
  do {
    const result = await teams.listMemberships({
      teamId: teamId,
      queries: [Query.limit(100), Query.offset(offset)],
      total: false
    });
    memberships = result.memberships;
    count += memberships.filter(function (membership) {
      return membership.confirm && (membership.roles || []).indexOf('worker') !== -1;
    }).length;
    offset += memberships.length;
  } while (memberships.length === 100);
  return count;
}

async function openSession(user, invitationAccepted) {
  clearRealtime();
  let team = await loadUserTeam(user);
  if (!team) {
    let pendingWorker;
    try {
      pendingWorker = JSON.parse(localStorage.getItem(PENDING_WORKER_KEY + user.$id) || 'null');
    } catch (error) {
      console.error('No se pudo recuperar el registro pendiente del trabajador:', error);
    }
    if (pendingWorker && typeof pendingWorker.farmName === 'string') {
      await createWorkerTeam(user, pendingWorker.farmName);
      localStorage.removeItem(PENDING_WORKER_KEY + user.$id);
      team = await loadUserTeam(user);
    }
    if (!team) {
      hideApp();
      if (invitationAccepted) {
        throw new Error('La invitación se aceptó, pero no se encontró una membresía activa. Vuelve a iniciar sesión.');
      }
      showPendingOwner(user.email || '');
      return;
    }
  }

  activeUser = user;
  activeTeamId = team.teamId;
  activeRole = team.role;
  appApi().setSession({ role: activeRole, email: user.email, name: user.name, farmId: activeTeamId });
  setAccountBar();
  loadWorkerCount(activeTeamId).then(function (count) {
    if (activeTeamId === team.teamId && appApi()) appApi().setWorkerCount(count);
  }).catch(function (error) {
    console.error('No se pudo consultar la cantidad de trabajadores:', error);
    if (appApi()) {
      appApi().setWorkerCount(null);
      if (navigator.onLine) appApi().showCloudError('No se pudo consultar la cantidad de trabajadores del galpón.');
    }
  });
  showBusy('Cargando los datos compartidos…');

  let data;
  let pendingOfflineWorkerData = false;
  try {
    if (activeRole === 'worker' && navigator.onLine) {
      await ensureWorkerRows(activeTeamId);
    }

    const pendingKey = ROW_CACHE_KEY + activeUser.$id + '_pending';
    const cached = getCachedSession(activeUser.$id);
    if (activeRole === 'worker' && navigator.onLine &&
        localStorage.getItem(pendingKey) &&
        cached && cached.teamId === activeTeamId && cached.data) {
      data = normalizedData(cached.data);
      pendingOfflineWorkerData = true;
    } else {
      data = await readRemoteData(activeTeamId);
    }

   // --- VERIFICACIÓN DE SUSCRIPCIÓN MENSUAL ---
    const subscriptionUntil = data && data.config && data.config.subscriptionUntil;
    console.log('FECHA DE SUSCRIPCIÓN LEÍDA:', subscriptionUntil);

    if (subscriptionUntil && new Date(subscriptionUntil) < new Date()) {
      hideApp(); // Bloquea la app
      renderAuth(
        '<h2>Suscripción vencida</h2>' +
        '<p class="auth-copy">El acceso mensual para este galpón ha finalizado.</p>' +
        '<p class="auth-copy">Por favor, renueva tu suscripción para continuar usando la aplicación.</p>' +
        '<button class="auth-primary" type="button" data-sign-out>Cerrar sesión</button>'
      );
      return;
    }
    }  
    
   catch (error) {
    if (isNetworkFailure(error)) {
      const cached = getCachedSession(user.$id);
      if (cached && cached.teamId === activeTeamId && cached.data) {
        connectionAvailable = false;
        data = normalizedData(cached.data);
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }

  if (!appApi().setRemoteData(data, user.$id)) {
    throw new Error('Los datos recibidos de Appwrite tienen un formato inválido.');
  }
  remoteReady = true;
  saveCache(user.$id, data);
  setAccountBar();
  document.body.classList.add('authenticated');
  root.innerHTML = '';
  await startRealtime(activeTeamId);
  if (pendingOfflineWorkerData) {
    window.galponCloudSync(data).catch(function (error) {
      console.error('No se pudieron sincronizar los cambios guardados sin conexión:', error);
      if (!isNetworkFailure(error)) appApi().showCloudError(errorText(error));
    });
  }
}

async function ensureWorkerRows(teamId) {
  rowsBySection = await listTeamRows(teamId);
  const currentData = normalizedData(appApi().getData());
  const permissions = rowPermissions(teamId);
  for (const section of SECTIONS) {
    if (rowsBySection[section]) continue;
    rowsBySection[section] = await tables.createRow({
      databaseId: DATABASE_ID,
      tableId: TABLE_ID,
      rowId: rowIdFor(teamId, section),
      data: {
        teamId: teamId,
        section: section,
        recordId: section,
        payload: JSON.stringify(currentData[section])
      },
      permissions: permissions
    });
  }
}

async function createWorkerTeam(user, farmName) {
  const team = await teams.create({
    teamId: ID.unique(),
    name: farmName || 'Mi galpón',
    roles: ['owner', 'worker']
  });
  activeUser = user;
  activeTeamId = team.$id;
  activeRole = 'worker';
  const initialData = normalizedData({});
  const permissions = rowPermissions(team.$id);
  for (const section of SECTIONS) {
    const rowId = rowIdFor(team.$id, section);
    const row = await tables.createRow({
      databaseId: DATABASE_ID,
      tableId: TABLE_ID,
      rowId: rowId,
      data: {
        teamId: team.$id,
        section: section,
        recordId: section,
        payload: JSON.stringify(initialData[section])
      },
      permissions: permissions
    });
    rowsBySection[section] = row;
  }
  try {
    localStorage.removeItem(PENDING_WORKER_KEY + user.$id);
  } catch (error) {
    console.error('No se pudo limpiar el registro pendiente del trabajador:', error);
  }
}

async function submitAuth(form) {
  if (submitting) return;
  const values = new FormData(form);
  const mode = form.dataset.mode;
  const email = String(values.get('email') || '').trim();
  const password = String(values.get('password') || '');
  const name = String(values.get('name') || '').trim();
  const role = String(values.get('role') || 'worker');
  const farmName = String(values.get('farmName') || 'Mi galpón').trim();
  setSubmitting(true, mode === 'register' ? 'Creando cuenta…' : 'Entrando…');
  setError('');

  let stage = 'authentication';
  try {
    let user;
    let invitationAccepted = false;
    const invite = invitationParams();
    if (mode === 'register' && hasInvitation(invite)) {
      stage = 'invite';
      await teams.updateMembershipStatus({
        teamId: invite.teamId,
        membershipId: invite.membershipId,
        userId: invite.userId,
        secret: invite.secret
      });
      user = await account.get();
      activeUser = user;
      stage = 'invite-password';
      await account.updatePassword({ password: password });
      if (name) await account.updateName({ name: name });
      clearInvitationParams();
      invitationAccepted = true;
    } else if (mode === 'register') {
      stage = 'registration';
      user = await account.create({
        userId: ID.unique(),
        email: email,
        password: password,
        name: name || email
      });
      await account.createEmailPasswordSession({ email: email, password: password });
      activeUser = user;
      if (hasInvitation(invitationParams())) {
        stage = 'invite';
        invitationAccepted = await acceptInvitation(user);
      } else if (role === 'worker') {
        localStorage.setItem(PENDING_WORKER_KEY + user.$id, JSON.stringify({
          farmName: farmName || 'Mi galpón'
        }));
        await createWorkerTeam(user, farmName);
      } else {
        showPendingOwner(email);
        return;
      }
    } else {
      stage = 'authentication';
      await account.createEmailPasswordSession({ email: email, password: password });
      user = await account.get();
      activeUser = user;
      stage = 'invite';
      invitationAccepted = await acceptInvitation(user);
    }
    user = await account.get();
    stage = 'team';
    showBusy('Conectando con Appwrite…');
    await openSession(user, invitationAccepted);
  } catch (error) {
    console.error('Error de acceso o sincronización Appwrite:', error);
    const message = errorText(error, stage);
    if (mode === 'register' && activeUser) {
      showRegistrationRecovery(activeUser, message);
    } else if (mode === 'register') {
      showRegister(message);
    } else {
      showLogin(message, Boolean(activeUser), email);
    }
    if (mode === 'register' && error && Number(error.code) === 409) {
      if (document.getElementById('authError')) {
        setError('Ese correo ya tiene una cuenta. Inicia sesión con ese correo.');
      }
    }
  } finally {
    setSubmitting(false);
  }
}

window.galponCloudSync = async function (data) {
  if (!activeUser || !activeTeamId || activeRole !== 'worker' || !remoteReady) return;
  localWriteVersion += 1;
  if (!navigator.onLine) {
    connectionAvailable = false;
    updateConnectionStatus('Desconectado', 'offline');
    try {
      saveCache(activeUser.$id, data);
      localStorage.setItem(ROW_CACHE_KEY + activeUser.$id + '_pending', '1');
    } catch (error) {
      console.error('No se pudo marcar la sincronización pendiente:', error);
    }
    return;
  }
  const snapshot = normalizedData(data);
  updateConnectionStatus('Sincronizando…', 'syncing');
  const write = syncQueue.then(async function () {
    localSyncDepth += 1;
    try {
      for (const section of SECTIONS) {
        let row = rowsBySection[section];
        const payload = JSON.stringify(snapshot[section]);
        if (!row) {
          row = await tables.createRow({
            databaseId: DATABASE_ID,
            tableId: TABLE_ID,
            rowId: rowIdFor(activeTeamId, section),
            data: {
              teamId: activeTeamId,
              section: section,
              recordId: section,
              payload: payload
            },
            permissions: rowPermissions(activeTeamId)
          });
        } else {
          row = await tables.updateRow({
            databaseId: DATABASE_ID,
            tableId: TABLE_ID,
            rowId: row.$id,
            data: { payload: payload }
          });
        }
        rowsBySection[section] = row;
      }
      saveCache(activeUser.$id, snapshot);
      connectionAvailable = true;
      updateConnectionStatus('En línea', 'online');
      try {
        localStorage.removeItem(ROW_CACHE_KEY + activeUser.$id + '_pending');
      } catch (error) {
        console.error('No se pudo limpiar el estado de sincronización pendiente:', error);
      }
    } finally {
      localSyncDepth -= 1;
      if (!localSyncDepth && realtimeRefreshPending) {
        realtimeRefreshPending = false;
        if (activeTeamId) scheduleRealtimeRefresh(activeTeamId);
      }
    }
  });
  const result = write.catch(function (error) {
    if (isNetworkFailure(error)) {
      connectionAvailable = false;
      updateConnectionStatus('Desconectado', 'offline');
    } else {
      updateConnectionStatus('Error al sincronizar', 'error');
    }
    saveCache(activeUser.$id, snapshot);
    try {
      localStorage.setItem(ROW_CACHE_KEY + activeUser.$id + '_pending', '1');
    } catch (cacheError) {
      console.error('No se pudo guardar el estado de sincronización pendiente:', cacheError);
    }
    throw error;
  });
  syncQueue = result.catch(function () {});
  return result;
};

window.galponAppwriteAccount = {
  signOut: async function () {
    await account.deleteSession({ sessionId: 'current' });
    const userId = activeUser && activeUser.$id;
    if (userId) {
      try {
        localStorage.removeItem(ROW_CACHE_KEY + userId);
        localStorage.removeItem(ROW_CACHE_KEY + userId + '_pending');
        localStorage.removeItem(PENDING_WORKER_KEY + userId);
        if (localStorage.getItem(LAST_USER_KEY) === userId) {
          localStorage.removeItem(LAST_USER_KEY);
        }
      } catch (error) {
        console.error('No se pudo limpiar la copia privada de la cuenta:', error);
      }
    }
    hideApp();
    showLogin();
  },
  inviteOwner: async function (email) {
    if (!activeTeamId || activeRole !== 'worker') {
      throw new Error('Solo la cuenta trabajadora puede invitar al dueño.');
    }
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) throw new Error('Escribe el correo del dueño.');
    if (!canInviteOwner(activeUser.email, normalizedEmail)) {
      const error = new Error('El correo del dueño debe ser distinto al correo de la cuenta trabajadora.');
      error.code = 'app/same-owner-worker-email';
      throw error;
    }
    return teams.createMembership({
      teamId: activeTeamId,
      roles: ['owner-readonly'],
      email: normalizedEmail,
      url:  https://little-papayas-post.loca.lt,
      name: 'Dueño del galpón'
    });
  }
};
window.galponAppwriteConnection = {
  isAvailable: function () { return connectionAvailable; }
};

root.addEventListener('click', function (event) {
  const modeButton = event.target.closest('[data-auth-mode]');
  if (modeButton) {
    const invitation = hasInvitation(invitationParams());
    if (modeButton.dataset.authMode === 'register') showRegister();
    else showLogin(invitation ? 'Inicia sesión con el correo invitado para aceptar la invitación.' : '');
    return;
  }
  if (event.target.closest('[data-sign-out]')) {
    window.galponAppwriteAccount.signOut().catch(function (error) {
      setError(errorText(error));
    });
  }
});

root.addEventListener('submit', function (event) {
  if (event.target.id !== 'authForm') return;
  event.preventDefault();
  submitAuth(event.target);
});

document.getElementById('accountBar').addEventListener('click', function (event) {
  if (event.target.id === 'signOut') {
    window.galponAppwriteAccount.signOut().catch(function (error) {
      appApi().showCloudError(errorText(error));
    });
  }
});

window.addEventListener('galpon-account-action', async function (event) {
  try {
    if (event.detail.action === 'sign-out') {
      await window.galponAppwriteAccount.signOut();
    } else if (event.detail.action === 'invite-owner') {
      await window.galponAppwriteAccount.inviteOwner(event.detail.email);
      appApi().showCloudError('Invitación enviada. El dueño debe abrir el correo y crear su cuenta con esa dirección.');
    }
  } catch (error) {
    console.error('No se pudo completar la acción de cuenta Appwrite:', error);
    appApi().showCloudError(error && error.code === 'app/same-owner-worker-email'
      ? error.message + ' El dueño debe usar otra cuenta Appwrite.'
      : errorText(error));
  }
});

window.addEventListener('online', async function () {
  updateConnectionStatus('Conectando…', 'syncing');
  if (!activeUser || !activeTeamId) {
    initialize();
    return;
  }
  const teamId = activeTeamId;
  try {
    rowsBySection = await listTeamRows(teamId);
    const pendingKey = ROW_CACHE_KEY + activeUser.$id + '_pending';
    if (activeRole === 'worker' && localStorage.getItem(pendingKey)) {
      await window.galponCloudSync(appApi().getData());
    } else {
      await refreshRemoteData();
    }
    await startRealtime(teamId);
    connectionAvailable = true;
    updateConnectionStatus('En línea', 'online');
  } catch (error) {
    if (isNetworkFailure(error)) {
      connectionAvailable = false;
      updateConnectionStatus('Desconectado', 'offline');
    } else {
      updateConnectionStatus('Error al sincronizar', 'error');
      appApi().showCloudError(errorText(error));
    }
  }
});

window.addEventListener('offline', function () {
  connectionAvailable = false;
  updateConnectionStatus('Desconectado', 'offline');
});

window.setInterval(verifyConnection, 30000);
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) verifyConnection();
});

async function initialize() {
  const invite = invitationParams();
  const cachedUserId = localStorage.getItem(LAST_USER_KEY);
  const cached = cachedUserId && getCachedSession(cachedUserId);
  if (!navigator.onLine && restoreCachedSession(cachedUserId, cached)) return;
  try {
    await window.appwritePing;
    const user = await account.get();
    activeUser = user;
    const accepted = hasInvitation(invite) ? await acceptInvitation(user) : false;
    await openSession(await account.get(), accepted);
  } catch (error) {
    if (isNetworkFailure(error) && restoreCachedSession(cachedUserId, cached)) {
      return;
    }
    if (Number(error && error.code) === 401) {
      if (hasInvitation(invite)) showRegister();
      else showLogin();
      return;
    }
    console.error('No se pudo iniciar Appwrite:', error);
    if (hasInvitation(invite) && activeUser) {
      showInviteAccountMismatch(activeUser.email);
    } else {
      showLogin(errorText(error, hasInvitation(invite) ? 'invite' : 'authentication'), Boolean(activeUser));
    }
  }
}

initialize();
