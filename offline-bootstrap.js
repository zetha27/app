(function(){
'use strict';

var CACHE_PREFIX='galpon_appwrite_cache_v1_';
var LAST_USER_KEY='galpon_appwrite_last_user';
var failedModule=false;

function readCache(){
  try{
    var userId=localStorage.getItem(LAST_USER_KEY);
    var raw=userId&&localStorage.getItem(CACHE_PREFIX+userId);
    var cached=raw&&JSON.parse(raw);
    if(!userId||!cached||!cached.teamId||!cached.data||
      (cached.role!=='worker'&&cached.role!=='owner')||
      !Array.isArray(cached.data.gallinas)||
      !Array.isArray(cached.data.dias)||
      !Array.isArray(cached.data.pedidos))return null;
    return {userId:userId,cached:cached};
  }catch(error){
    console.error('No se pudo abrir la sesión local sin conexión:',error);
    return null;
  }
}

function showOfflineSession(){
  if(document.body.classList.contains('authenticated'))return true;
  var app=window.galponApp, session=readCache();
  if(!app||!session)return false;
  var data=session.cached.data;
  app.setSession({
    role:session.cached.role,
    email:session.cached.email||'',
    name:session.cached.name||'',
    farmId:session.cached.teamId
  });
  document.body.classList.add('authenticated');
  if(!app.setRemoteData(data,session.userId)){
    document.body.classList.remove('authenticated');
    app.setSession(null);
    return false;
  }
  var accountBar=document.getElementById('accountBar');
  if(accountBar){
    accountBar.innerHTML='<span class="connection-status" id="connectionStatus" role="status" data-state="offline">Desconectado</span>';
  }
  window.galponOfflineSession={
    persist:function(updatedData){
      if(session.cached.role!=='worker')return;
      try{
        session.cached.data=updatedData;
        localStorage.setItem(CACHE_PREFIX+session.userId,JSON.stringify(session.cached));
        localStorage.setItem(LAST_USER_KEY,session.userId);
        localStorage.setItem(CACHE_PREFIX+session.userId+'_pending','1');
      }catch(error){
        console.error('No se pudieron guardar los cambios locales para sincronizarlos:',error);
      }
    }
  };
  return true;
}

function retryAuthModule(){
  if(!failedModule||window.galponAppwriteAuthReady)return;
  failedModule=false;
  var retry=document.createElement('script');
  retry.type='module';
  retry.src='appwrite-auth.js?retry='+Date.now();
  retry.addEventListener('error',function(){
    failedModule=true;
    showOfflineSession();
  });
  document.body.appendChild(retry);
}

var authModule=document.querySelector('script[type="module"][src="appwrite-auth.js"]');
if(authModule){
  authModule.addEventListener('error',function(){
    failedModule=true;
    showOfflineSession();
  });
}

window.addEventListener('online',retryAuthModule);
window.addEventListener('offline',function(){
  if(!window.galponAppwriteAuthReady)showOfflineSession();
});
})();
