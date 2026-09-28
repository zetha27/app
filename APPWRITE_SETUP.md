# Configuración de Appwrite

La app usa Appwrite Account para iniciar sesión, Teams para invitar al dueño y TablesDB para compartir los datos del galpón. El trabajador puede modificar los datos; el dueño invitado tiene acceso de lectura.

## Proyecto y plataforma web

- Endpoint: `https://nyc.cloud.appwrite.io/v1`
- Project ID: `6ab74b12003e0416d37a`
- Database ID: `6ab752bb0016a137498d`
- Table ID: `6ab7570700016ad274cc`

En Appwrite Console, registra como plataforma **Web** cada hostname desde el que usarás la app, por ejemplo `127.0.0.1` para pruebas locales y el dominio de producción. No abras la app como `file://`.

## Tabla de datos

La tabla debe tener Row security activada y estas columnas requeridas, sin valores por defecto:

| Columna | Tipo | Longitud |
| --- | --- | --- |
| `teamId` | Varchar | 64 |
| `section` | Varchar | 32 |
| `recordId` | Varchar | 64 |
| `payload` | Mediumtext | — |

Crea el índice tipo `key` `teamId_idx` para la columna `teamId` ascendente. En permisos de tabla concede únicamente `Create` al rol autenticado `Users`; no concedas acceso global de lectura, actualización o eliminación ni acceso a `Any`. La app concede permisos por fila: lectura a miembros del equipo y actualización/eliminación solo al rol interno `worker`.

## Registro y vinculación

1. En el teléfono del trabajador, crea una cuenta de tipo **Trabajador**. La app crea su Team y copia los datos locales existentes a Appwrite.
2. En Appwrite Console, habilita las invitaciones para el proyecto desde la configuración de Auth/Teams. Si están desactivadas, `createMembership` responde `501` con `Invites authentication is disabled for this project`.
3. En **Ajustes → Cuenta**, escribe el correo del dueño y envía la invitación. Debe ser un correo distinto al que usa el trabajador.
4. El dueño abre el enlace recibido. Si ya tiene cuenta Appwrite, elige **Inicia sesión con tu correo de dueño** y usa su propio correo y contraseña. Si no tiene cuenta, crea la contraseña desde el enlace de invitación. No uses las credenciales del trabajador en el teléfono del dueño.
5. El trabajador conserva permisos de edición y el dueño invitado solo puede consultar. Ambos teléfonos necesitan internet para recibir cambios en tiempo real.

No se usa un código de galpón como sustituto directo de la invitación: el ID o código por sí solo no puede agregar de forma segura al dueño al Team ni asignarle permisos de solo lectura. Eso requeriría un backend confiable (por ejemplo, Appwrite Function); sin él, habilitar las invitaciones de Appwrite es la opción segura.

Las cuentas y contraseñas antiguas de Firebase no se migran: cada persona debe crear una cuenta nueva en Appwrite.

## Uso sin conexión

Después de iniciar sesión y abrir el galpón en un dispositivo, se conserva una copia local. Si se pierde la conexión, la sesión muestra «Desconectado» y permite seguir usando esa copia; los cambios del trabajador quedan pendientes y se envían a Appwrite al recuperar la conexión. El dueño puede consultar la última copia descargada, pero no modificarla. Un dispositivo nuevo necesita conectarse para entrar y descargar los datos por primera vez.

En Android, **Descargar archivo** guarda la copia JSON en la carpeta Documentos del teléfono. En un navegador, permite elegir dónde guardarla cuando el navegador admite esa opción; de lo contrario usa la carpeta de descargas.

## Verificación y APK

La cuenta y la sincronización se implementan en `appwrite-auth.js`. El ping de Appwrite se ejecuta al inicio; el estado de conexión se muestra en Inicio.

Después de cambiar archivos dentro de `www`, ejecuta `npx cap sync android`, sincroniza Gradle en Android Studio y vuelve a instalar el APK. Una app web alojada debe recibir los archivos publicados de `www`.

## Prueba local de permisos entre dos dispositivos

Ejecuta `node --test www/tests/appwrite-two-devices.test.mjs` desde la raíz del proyecto. Esta simulación usa la misma política de permisos Appwrite que la app: el trabajador escribe, el dueño recibe la actualización y una escritura del dueño es rechazada. Es una prueba local de la política, no sustituye la prueba en dos teléfonos con cuentas reales y la invitación habilitada en Appwrite.
