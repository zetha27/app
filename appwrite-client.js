import { Client } from 'appwrite';

export const client = new Client()
  .setEndpoint('https://nyc.cloud.appwrite.io/v1')
  .setProject('6ab74b12003e0416d37a');

let pingPromise;

function showPingStatus(message, state) {
  const status = document.getElementById('appwriteStatus');
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}

function pingOnce() {
  if (!pingPromise) {
    showPingStatus('Appwrite: comprobando conexión…', 'checking');
    pingPromise = client.ping().then(function (result) {
      console.info('Appwrite ping correcto:', result);
      showPingStatus('Appwrite: conectado', 'success');
      return result;
    }).catch(function (error) {
      console.error('Appwrite ping falló:', error);
      showPingStatus('Appwrite: error de conexión o dominio no autorizado', 'error');
      return false;
    });
  }
  return pingPromise;
}

window.appwriteClient = client;
window.appwritePing = pingOnce();
window.appwritePingCheck = function () {
  return client.ping();
};
