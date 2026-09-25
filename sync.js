(function(global){
  'use strict';

  var localKey='galpon_app_v1';
  var listeners=[];
  var remoteListener=null;
  var workersListener=null;
  var firebaseUser=null;
  var firebaseReady=false;
  var syncing=false;
  var pendingUpload=null;
  var signupInProgress=false;
  var cloudBootstrapStarted=false;
  var cloudRemoteDataReceived=false;
  var state={provider:'firebase',status:'booting',lastSaved:null,user:null,accountName:null,role:null,ownerUid:null,ownerName:null,workerCount:null,accessCode:null,accessCodeExpiresAt:null,error:null};
  var firebaseConfig={
    apiKey:'AIzaSyCVdET9xBNcC93ngsR7_ZypXcrpOl8Kh8Y',
    authDomain:'mi-galpon-da046.firebaseapp.com',
    projectId:'mi-galpon-da046',
    storageBucket:'mi-galpon-da046.firebasestorage.app',
    messagingSenderId:'191036510273',
    appId:'1:191036510273:web:91be8fa00a07db7742b6c0'
  };

  function notify(){
    listeners.slice().forEach(function(listener){listener(Object.assign({},state));});
  }
  function setState(next){
    state=Object.assign({},state,next);
    notify();
  }
  function cloudErrorMessage(error,fallback){
    if(error&&error.code==='permission-denied')return 'Firebase rechazó el acceso. Publica las reglas de Firestore actualizadas y vuelve a intentarlo.';
    if(error&&error.code==='unavailable')return 'No hay conexión con Firebase. Verifica internet para cargar el galpón y el rol de la cuenta.';
    return fallback;
  }
  function localLoad(key){
    try{
      var raw=localStorage.getItem(key||localKey);
      return raw?JSON.parse(raw):null;
    }catch(error){
      console.error('No se pudieron leer los datos locales:',error);
      return null;
    }
  }
  function localSave(key,value){
    try{
      localStorage.setItem(key||localKey,JSON.stringify(value));
      return true;
    }catch(error){
      console.error('No se pudieron guardar los datos locales:',error);
      return false;
    }
  }
  function profileRef(user){
    return global.firebase.firestore().collection('users').doc(user.uid);
  }
  function cloudRef(userId){
    return global.firebase.firestore().collection('users').doc(userId).collection('galpones').doc('principal');
  }
  function workersRef(ownerUid){
    return global.firebase.firestore().collection('users').doc(ownerUid).collection('workers');
  }
  function ensureWorkerMembership(ownerUid,user,name){
    var membershipRef=workersRef(ownerUid).doc(user.uid);
    return membershipRef.get().then(function(membership){
      if(membership.exists)return;
      return membershipRef.set({
        uid:user.uid,
        name:name||user.displayName||user.email,
        email:user.email,
        joinedAt:global.firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  }
  function asIso(value){
    if(!value)return null;
    var date=value.toDate?value.toDate():new Date(value);
    return isNaN(date.getTime())?null:date.toISOString();
  }
  function hasData(value){
    if(!value||typeof value!=='object')return false;
    var lists=['gallinas','dias','pedidos','clientes','gastos'];
    if(lists.some(function(key){return Array.isArray(value[key])&&value[key].length>0;}))return true;
    var config=value.config||{};
    return !!(config.nombre&&config.nombre!=='Mi galpón')||!!config.precio||!!config.precioUnidad;
  }
  function mergeData(remote,local){
    var merged=Object.assign({},local||{},remote||{});
    merged.config=Object.assign({},(local&&local.config)||{},(remote&&remote.config)||{});
    ['gallinas','dias','pedidos','clientes','gastos'].forEach(function(key){
      var entries=(remote&&Array.isArray(remote[key])?remote[key]:[]).concat(local&&Array.isArray(local[key])?local[key]:[]);
      var byId={};
      var withoutId=[];
      entries.forEach(function(item){
        if(item&&item.id)byId[item.id]=item;
        else withoutId.push(item);
      });
      merged[key]=Object.keys(byId).map(function(id){return byId[id];}).concat(withoutId);
    });
    return merged;
  }
  function applyRemote(value){
    if(!value||typeof value!=='object')return;
    syncing=true;
    localSave(localKey,value);
    if(typeof global.MiGalponSync.onRemoteChange==='function'){
      global.MiGalponSync.onRemoteChange(JSON.stringify(value));
    }
    syncing=false;
  }
  function finishUpload(){
    syncing=false;
    if(pendingUpload){
      var next=pendingUpload;
      pendingUpload=null;
      upload(next);
    }
  }
  function upload(value){
    if(!firebaseUser||!firebaseReady)return;
    if(syncing){
      pendingUpload=value;
      return;
    }
    syncing=true;
    cloudRef(firebaseUser.ownerUid||firebaseUser.uid).set({data:value,updatedAt:global.firebase.firestore.FieldValue.serverTimestamp()})
      .then(function(){
        setState({provider:'firebase',status:'synced',lastSaved:new Date().toISOString(),error:null});
      })
      .catch(function(error){
        console.error('No se pudieron sincronizar los datos:',error);
        setState({status:'error',error:cloudErrorMessage(error,'No se pudo sincronizar. Se conservaron los datos locales.')});
      })
      .then(finishUpload);
  }
  function legacyCloudData(){
    if(!firebaseUser||firebaseUser.role!=='worker'||firebaseUser.ownerUid===firebaseUser.uid)return Promise.resolve(null);
    return cloudRef(firebaseUser.uid).get().then(function(snapshot){
      return snapshot.exists?snapshot.data().data:null;
    });
  }
  function initialCloudData(sharedData){
    var local=localLoad(localKey);
    if(hasData(local))return Promise.resolve(local);
    return legacyCloudData().then(function(legacy){
      if(hasData(legacy))return legacy;
      return sharedData||local||{};
    });
  }
  function startCloud(){
    if(!firebaseUser)return;
    if(remoteListener)remoteListener();
    if(workersListener){workersListener();workersListener=null;}
    cloudBootstrapStarted=false;
    cloudRemoteDataReceived=false;
    setState({provider:'firebase',status:'connecting',user:firebaseUser.email,accountName:firebaseUser.name||firebaseUser.displayName||firebaseUser.email,role:firebaseUser.role||'worker',ownerUid:firebaseUser.ownerUid||firebaseUser.uid,error:null});
    if(firebaseUser.role==='owner'){
      workersListener=workersRef(firebaseUser.uid).onSnapshot(function(snapshot){
        setState({workerCount:snapshot.size});
      },function(error){
        console.error('No se pudo consultar la cantidad de trabajadores:',error);
        setState({workerCount:null,error:cloudErrorMessage(error,'No se pudo consultar la cantidad de trabajadores.')});
      });
    }
    remoteListener=cloudRef(firebaseUser.ownerUid||firebaseUser.uid).onSnapshot(function(snapshot){
      var remote=snapshot.exists?snapshot.data().data:null;
      if(hasData(remote)){
        var local=localLoad(localKey);
        if(!cloudBootstrapStarted&&firebaseUser.role==='worker'&&hasData(local)){
          cloudBootstrapStarted=true;
          cloudRemoteDataReceived=true;
          var merged=mergeData(remote,local);
          if(JSON.stringify(merged)!==JSON.stringify(remote))upload(merged);
          else applyRemote(remote);
          return;
        }
        cloudRemoteDataReceived=true;
        cloudBootstrapStarted=true;
        applyRemote(remote);
        setState({provider:'firebase',status:'synced',user:firebaseUser.email,error:null});
        return;
      }
      if(cloudBootstrapStarted){
        if(hasData(localLoad(localKey)))upload(localLoad(localKey));
        else if(remote)applyRemote(remote);
        return;
      }
      cloudBootstrapStarted=true;
      initialCloudData(remote).then(function(initial){
        if(cloudRemoteDataReceived)return;
        if(hasData(initial))upload(initial);
        else if(initial)applyRemote(initial);
        else setState({provider:'firebase',status:'synced',user:firebaseUser.email,error:null});
      }).catch(function(error){
        console.error('No se pudieron recuperar los datos locales anteriores:',error);
        var local=localLoad(localKey);
        if(local)upload(local);
        else setState({status:'error',error:cloudErrorMessage(error,'No se pudieron recuperar los datos del galpón.')});
      });
    },function(error){
      console.error('No se pudo escuchar Firestore:',error);
      setState({status:'error',error:cloudErrorMessage(error,'No se pudo conectar con la nube.')});
    });
  }
  function finishAuthenticatedProfile(user,data,ownerData){
    var isOwner=data.role==='owner';
    firebaseUser=user;
    firebaseUser.role=isOwner?'owner':'worker';
    firebaseUser.ownerUid=isOwner?user.uid:(data.ownerUid||'');
    firebaseUser.name=data.name||user.displayName||user.email;
    var ownerName=isOwner?firebaseUser.name:(ownerData&&(ownerData.name||ownerData.email))||'';
    var expiresAt=isOwner?data.accessCodeExpiresAt:null;
    setState({
      provider:'firebase',
      status:'connecting',
      user:user.email,
      accountName:firebaseUser.name,
      role:firebaseUser.role,
      ownerUid:firebaseUser.ownerUid,
      ownerName:ownerName,
      accessCode:isOwner?data.accessCode||null:null,
      accessCodeExpiresAt:asIso(expiresAt),
      error:null
    });
    startCloud();
  }
  function readAuthenticatedProfile(user){
    firebaseUser=user;
    setState({provider:'firebase',status:'connecting',user:user.email,accountName:user.displayName||user.email,role:null,ownerUid:null,ownerName:null,workerCount:null,accessCode:null,accessCodeExpiresAt:null,error:null});
    profileRef(user).get().then(function(profile){
      var data;
      if(profile.exists){
        data=profile.data();
      }else{
        data={role:'owner',ownerUid:user.uid,email:user.email,name:user.displayName||''};
        return profileRef(user).set(Object.assign({},data,{createdAt:global.firebase.firestore.FieldValue.serverTimestamp()}),{merge:true})
          .then(function(){return {data:data,ownerData:null};});
      }
      if(data.role!=='worker'){
        if(!data.ownerUid){
          data.role='owner';
          data.ownerUid=user.uid;
          return profileRef(user).set({role:'owner',ownerUid:user.uid},{merge:true})
            .then(function(){return {data:data,ownerData:null};});
        }
        return {data:data,ownerData:null};
      }
      if(!data.ownerUid)throw new Error('El perfil de trabajador no está vinculado a un dueño.');
      return ensureWorkerMembership(data.ownerUid,user,data.name).then(function(){
        return profileRef({uid:data.ownerUid}).get();
      }).then(function(ownerProfile){
        if(!ownerProfile.exists||ownerProfile.data().role!=='owner')throw new Error('No se encontró el dueño asociado a esta cuenta.');
        return {data:data,ownerData:ownerProfile.data()};
      });
    }).then(function(result){
      if(result)finishAuthenticatedProfile(user,result.data,result.ownerData);
    }).catch(function(error){
      console.error('No se pudo leer el perfil de la cuenta:',error);
      setState({status:'error',error:error.code?cloudErrorMessage(error,'No se pudo comprobar el tipo de usuario.'):error.message||'No se pudo comprobar el tipo de usuario.'});
    });
  }
  function initFirebase(){
    if(!global.firebase||!global.firebase.initializeApp){
      setState({status:'error',error:'No se cargó Firebase. Revisa la conexión.'});
      return;
    }
    try{
      if(!global.firebase.apps.length)global.firebase.initializeApp(firebaseConfig);
      firebaseReady=true;
      var auth=global.firebase.auth();
      auth.setPersistence(global.firebase.auth.Auth.Persistence.LOCAL).then(function(){
        auth.onAuthStateChanged(function(user){
          if(!user){
            firebaseUser=null;
            if(remoteListener){remoteListener();remoteListener=null;}
            if(workersListener){workersListener();workersListener=null;}
            if(signupInProgress)return;
            setState({provider:'firebase',status:'signin',user:null,accountName:null,role:null,ownerUid:null,ownerName:null,workerCount:null,accessCode:null,accessCodeExpiresAt:null,error:null});
            return;
          }
          if(signupInProgress)return;
          readAuthenticatedProfile(user);
        });
      }).catch(function(error){
        console.error('No se pudo conservar la sesión en este teléfono:',error);
        setState({status:'error',error:'No se pudo guardar la sesión. Revisa la configuración de Firebase.'});
      });
    }catch(error){
      console.error('No se pudo iniciar Firebase:',error);
      setState({status:'error',error:'No se pudo iniciar Firebase.'});
    }
  }
  function validateAccessCode(code){
    if(!code) return Promise.reject(new Error('ACCESS_CODE_REQUIRED'));
    var db=global.firebase.firestore();
    return db.collection('accessCodes').doc(code).get().then(function(invitation){
      if(!invitation.exists)throw new Error('INVALID_ACCESS_CODE');
      var data=invitation.data();
      var expires=data.expiresAt&&data.expiresAt.toDate?data.expiresAt.toDate():new Date(data.expiresAt);
      if(!data.active||!data.ownerUid||isNaN(expires.getTime())||expires.getTime()<=Date.now())throw new Error('INVALID_ACCESS_CODE');
      return {code:code,ownerUid:data.ownerUid,ownerName:data.ownerName||''};
    });
  }
  global.MiGalponSync={
    load:localLoad,
    save:function(key,value){
      if(!localSave(key,value))return false;
      state.lastSaved=new Date().toISOString();
      notify();
      if(firebaseUser)upload(value);
      return true;
    },
    onChange:function(listener){
      if(typeof listener!=='function')return function(){};
      listeners.push(listener);
      listener(Object.assign({},state));
      return function(){listeners=listeners.filter(function(item){return item!==listener;});};
    },
    getState:function(){return Object.assign({},state);},
    signIn:function(email,password){
      return global.firebase.auth().signInWithEmailAndPassword(email,password);
    },
    signUp:function(email,password,name,role,accessCode){
      var accountRole=role==='owner'?'owner':'worker';
      signupInProgress=true;
      var createdUser=null;
      var invitationCode=(accessCode||'').trim();
      if(accountRole==='worker'&&!invitationCode){
        signupInProgress=false;
        return Promise.reject(new Error('ACCESS_CODE_REQUIRED'));
      }
      return global.firebase.auth().createUserWithEmailAndPassword(email,password).then(function(result){
        createdUser=result.user;
        var invitationPromise=accountRole==='worker'?validateAccessCode(invitationCode):Promise.resolve(null);
        return invitationPromise.then(function(invitation){
          var profile={
            email:email,
            name:name||'',
            role:accountRole,
            ownerUid:accountRole==='owner'?result.user.uid:invitation.ownerUid,
            createdAt:global.firebase.firestore.FieldValue.serverTimestamp()
          };
          if(invitation)profile.accessCode=invitation.code;
          var operations=[profileRef(result.user).set(profile,{merge:true})];
          if(name&&result.user.updateProfile)operations.push(result.user.updateProfile({displayName:name}));
          return Promise.all(operations).then(function(){
            if(!invitation)return;
            return ensureWorkerMembership(invitation.ownerUid,result.user,name);
          }).then(function(){
            firebaseUser=result.user;
            firebaseUser.role=accountRole;
            firebaseUser.ownerUid=profile.ownerUid;
            firebaseUser.name=name||email;
            if(accountRole==='owner'){
              finishAuthenticatedProfile(result.user,profile,null);
              return result;
            }
            finishAuthenticatedProfile(result.user,profile,{role:'owner',name:invitation.ownerName});
            return result;
          });
        });
      }).catch(function(error){
        if(!createdUser)return Promise.reject(error);
        return createdUser.delete().catch(function(cleanupError){
          console.error('No se pudo limpiar la cuenta incompleta:',cleanupError);
        }).then(function(){throw error;});
      }).then(function(result){
        return result;
      }).finally(function(){
        signupInProgress=false;
      });
    },
    generateAccessCode:function(){
      if(!firebaseUser||firebaseUser.role!=='owner')return Promise.reject(new Error('Solo el dueño puede generar un código.'));
      if(!global.crypto||!global.crypto.getRandomValues)return Promise.reject(new Error('Este teléfono no permite generar un código seguro.'));
      var random=new Uint32Array(1);
      global.crypto.getRandomValues(random);
      var code=String(random[0]%100000000).padStart(8,'0');
      var expires=new Date(Date.now()+15*60*1000);
      var timestamp=global.firebase.firestore.Timestamp.fromDate(expires);
      var db=global.firebase.firestore();
      var codeRef=db.collection('accessCodes').doc(code);
      var ownerRef=profileRef(firebaseUser);
      return codeRef.set({
        code:code,
        ownerUid:firebaseUser.uid,
        ownerName:firebaseUser.name||firebaseUser.email,
        active:true,
        expiresAt:timestamp,
        createdAt:global.firebase.firestore.FieldValue.serverTimestamp()
      }).then(function(){
        return ownerRef.update({accessCode:code,accessCodeExpiresAt:timestamp});
      }).then(function(){
        setState({accessCode:code,accessCodeExpiresAt:expires.toISOString(),error:null});
      });
    },
    retryProfile:function(){
      var user=global.firebase.auth().currentUser;
      if(!user)return Promise.reject(new Error('No hay una sesión activa en este teléfono.'));
      readAuthenticatedProfile(user);
      return Promise.resolve();
    },
    signOut:function(){
      return global.firebase.auth().signOut();
    },
    onRemoteChange:null
  };
  window.addEventListener('online',function(){if(!firebaseUser)setState({status:'local'});});
  window.addEventListener('offline',function(){setState({status:'offline'});});
  window.addEventListener('storage',function(event){
    if(event.key!==localKey||!event.newValue||firebaseUser)return;
    setState({status:'local'});
    if(typeof global.MiGalponSync.onRemoteChange==='function')global.MiGalponSync.onRemoteChange(event.newValue);
  });
  initFirebase();
})(window);
