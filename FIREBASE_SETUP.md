# Configuración de Firebase

La app usa Firebase Authentication con correo y contraseña y Cloud Firestore para sincronizar un galpón entre dos cuentas. Los grupos de datos se guardan por separado para que el historial no quede limitado al tamaño máximo de un único documento de Firestore.

## Activar y publicar

1. En Firebase Console, abre **Authentication → Sign-in method** y habilita **Correo electrónico/Contraseña**.
2. Crea o confirma la base de datos en **Firestore Database**.
3. En **Firestore Database → Rules**, publica el contenido de [`firestore.rules`](./firestore.rules). Estas reglas limitan cada galpón a un trabajador con lectura y escritura y a un dueño con solo lectura. No publiques reglas abiertas.
4. En **Authentication → Settings → Authorized domains**, agrega el dominio HTTPS donde está alojada la app. No abras la app directamente como archivo `file://`.

Las reglas incluidas controlan las colecciones `galpones` y `usuarios` que usa esta app. Si el proyecto ya tiene otras reglas o aplicaciones que dependen de Firestore, revisa e integra esas reglas antes de reemplazarlas.

## Vincular los dos teléfonos

1. En el teléfono del trabajador, crea una cuenta eligiendo **Trabajador**. Los datos que ya existían en ese teléfono se copian al nuevo galpón de Firebase.
2. Comparte con el dueño el código que aparece arriba en la app.
3. En el teléfono del dueño, crea una cuenta eligiendo **Dueño** e ingresa el código. El galpón se abre en modo de solo lectura.
4. Ambos teléfonos deben tener internet para recibir los cambios en tiempo real.

El código es una invitación privada y permite vincular una sola cuenta de dueño a cada galpón. La app no requiere ni debe guardar contraseñas de Firebase en el código fuente.

## Uso sin conexión

Una cuenta que ya inició sesión y abrió su galpón en ese teléfono puede consultar la última copia guardada y seguir registrando datos del trabajador sin internet. Esos cambios quedan pendientes en ese teléfono y se envían a Firestore cuando vuelve la conexión. El dueño sigue en solo lectura. La primera creación de cuenta, el primer inicio de sesión en un teléfono y la vinculación del dueño requieren internet; un teléfono nuevo todavía no tiene una copia local del galpón.

## Comprobación de Appwrite

La app también inicializa el SDK web de Appwrite y ejecuta una sola llamada `client.ping()` al cargar la página. El indicador verde **Appwrite: conectado** confirma que el endpoint acepta la conexión. Appwrite es actualmente una comprobación independiente; el inicio de sesión y la sincronización del galpón siguen usando Firebase.

En Appwrite Console, registra tu sitio como una plataforma **Web** con el dominio desde donde se abre la página. Para las pruebas locales con `http://127.0.0.1:<puerto>`, agrega `127.0.0.1`; para la URL del teléfono o el hosting, registra también su dominio. Si el origen no está autorizado, el indicador mostrará error de dominio/conexión y la consola del navegador incluirá el motivo.

El módulo está en [`appwrite-client.js`](./appwrite-client.js); importa la versión fijada `appwrite@28.1.0` del CDN para poder funcionar en esta web estática sin incorporar un paso de compilación al sitio.

## Actualizar la app Android

Después de cambiar archivos dentro de `www`, copia esos archivos al proyecto Android y genera un APK nuevo:

```text
npx cap sync android
```

Después, en Android Studio, abre el proyecto `android`, ejecuta **Sync Project with Gradle Files** y vuelve a instalar el APK en el teléfono. Un APK anterior conserva los archivos web que tenía al compilarse y no recoge automáticamente los cambios nuevos. Si utilizas una versión alojada en web, también debes publicar los archivos actualizados de `www` en el servidor donde está la app.
