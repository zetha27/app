
(function(){
'use strict';

/* ---------- Datos ---------- */
var KEY='galpon_app_v1';
function defaults(){return {config:{nombre:'Mi galpón',porCanasta:30,precio:0,precioUnidad:0,
  tema:'Automático',percentilAlerta:75,ownerPayments:[]},gallinas:[],dias:[],pedidos:[],clientes:[],gastos:[]};}
function authErrorMessage(error){
  var code=error&&error.code||'';
  var messages={
    'auth/invalid-credential':'El correo o la contraseña no son correctos.',
    'auth/user-not-found':'No existe una cuenta con ese correo.',
    'auth/wrong-password':'El correo o la contraseña no son correctos.',
    'auth/email-already-in-use':'Ese correo ya tiene una cuenta. Inicia sesión.',
    'auth/invalid-email':'Escribe un correo electrónico válido.',
    'auth/weak-password':'La contraseña debe tener al menos 6 caracteres.',
    'auth/network-request-failed':'No hay conexión. Revisa internet e inténtalo de nuevo.',
    'auth/too-many-requests':'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
    'permission-denied':'Firebase rechazó el acceso. Publica las reglas de Firestore actualizadas y vuelve a intentarlo.'
  };
  if(error&&error.message==='INVALID_ACCESS_CODE')return 'El código no es válido o ya venció. Pídele al dueño uno nuevo.';
  if(error&&error.message==='ACCESS_CODE_REQUIRED')return 'Escribe el código de acceso que te dio el dueño.';
  return messages[code]||'No se pudo completar la operación. Revisa tu conexión y la configuración de Firebase.';
}
function load(){
  try{
    var o=window.MiGalponSync.load(KEY);
    if(o){
      var d=defaults();
      var config=Object.assign(d.config,o.config||{});
      config.ownerPayments=Array.isArray(config.ownerPayments)?config.ownerPayments:[];
      var gastos=Array.isArray(o.gastos)?o.gastos:[];
      if(!gastos.length&&Array.isArray(config.ownerPayments)){
        gastos=config.ownerPayments.map(function(p,i){return {id:p.id||('legacy-gasto-'+i),fecha:p.date||new Date().toISOString().slice(0,10),monto:p.amount||0,categoria:'Entrega al dueño',detalle:p.name||''};});
      }
      return {config:config,gallinas:o.gallinas||[],dias:o.dias||[],pedidos:o.pedidos||[],clientes:o.clientes||[],gastos:gastos};
    }
  }catch(e){}
  return defaults();
}
var db=load();
var syncState=window.MiGalponSync.getState();
var carpetaHandle=null;
var carpetaDbPromise=null;
var permisoAlmacenamientoPromise=null;
function obtenerFilesystem(){
  return window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.Filesystem;
}
function solicitarPermisoAlmacenamiento(){
  var Filesystem=obtenerFilesystem();
  if(!Filesystem)return Promise.resolve(true);
  if(permisoAlmacenamientoPromise)return permisoAlmacenamientoPromise;
  permisoAlmacenamientoPromise=Filesystem.checkPermissions().then(function(status){
    if(status.publicStorage==='granted')return true;
    return Filesystem.requestPermissions().then(function(request){
      if(request.publicStorage==='granted'){
        console.log('Permiso de almacenamiento concedido');
        return true;
      }
      alert('Se requiere permiso de almacenamiento para guardar archivos.');
      permisoAlmacenamientoPromise=null;
      return false;
    });
  }).catch(function(error){
    permisoAlmacenamientoPromise=null;
    console.error('Error al solicitar permisos:',error);
    return false;
  });
  return permisoAlmacenamientoPromise;
}
function save(){
  if(!window.MiGalponSync.save(KEY,db)){
    toast('No se pudo guardar en este teléfono. Haz una copia de seguridad.');
  }
}
function syncStatusText(){
  if(syncState.status==='offline')return {label:'Sin conexión · guardado local',className:'offline'};
  if(syncState.status==='signin')return {label:'Inicia sesión',className:'local'};
  if(syncState.status==='connecting')return {label:'Conectando…',className:'local'};
  if(syncState.status==='error')return {label:'Error de sincronización',className:'offline'};
  if(syncState.provider==='firebase')return {label:'Sincronizado',className:'online'};
  return {label:'Solo este teléfono',className:'local'};
}
function actualizarEstadoSync(){
  var el=document.getElementById('syncStatus');
  if(!el)return;
  var info=syncStatusText();
  el.textContent=info.label;
  el.className='sync-status '+info.className;
  el.title=syncState.lastSaved?'Último guardado: '+new Date(syncState.lastSaved).toLocaleTimeString('es-CO'):'Los cambios se guardan en este teléfono';
}
function aplicarTema(){
  var t=db.config.tema;
  if(t==='Automático')t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'Oscuro':'Claro';
  if(t==='Claro')document.documentElement.dataset.theme='light';
  else if(t==='Oscuro')document.documentElement.dataset.theme='dark';
  else delete document.documentElement.dataset.theme;
}
aplicarTema();
if(window.matchMedia){
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',function(){
    if(db.config.tema==='Automático')aplicarTema();
  });
}

var tab='inicio', periodoInicio='7', periodoHuevos='7', periodoPedidos='7', periodoVentas='7', periodoPagos='hoy', configGalponAbierta=false, gastosAbierta=false, ajustesSeccion=null, quickOpen=false, filtro='todos', pedidoBuscar='', clienteBuscar='', authMode='login', authRole='worker';

window.MiGalponSync.onChange(function(next){
  syncState=next;
  actualizarEstadoSync();
  if(typeof render==='function'&&typeof $==='function')render();
});
window.MiGalponSync.onRemoteChange=function(raw){
  try{
    var incoming=JSON.parse(raw);
    if(!incoming||!incoming.config)return;
    db=incoming;
    render();
  }catch(error){
    console.error('No se pudieron aplicar los cambios de otra pestaña:',error);
  }
};

function abrirBaseCarpeta(){
  if(carpetaDbPromise)return carpetaDbPromise;
  carpetaDbPromise=new Promise(function(resolve){
    if(!window.indexedDB){resolve(null);return;}
    var request=indexedDB.open('galpon_app_archivos',1);
    request.onupgradeneeded=function(){request.result.createObjectStore('config');};
    request.onsuccess=function(){resolve(request.result);};
    request.onerror=function(){resolve(null);};
  });
  return carpetaDbPromise;
}
function cargarCarpeta(){
  return abrirBaseCarpeta().then(function(idb){
    return new Promise(function(resolve){
      if(!idb){resolve(null);return;}
      var tx=idb.transaction('config','readonly'), request=tx.objectStore('config').get('carpeta');
      request.onsuccess=function(){carpetaHandle=request.result||null;resolve(carpetaHandle);};
      request.onerror=function(){resolve(null);};
    });
  });
}
function guardarCarpeta(handle){
  carpetaHandle=handle;
  return abrirBaseCarpeta().then(function(idb){
    return new Promise(function(resolve){
      if(!idb){resolve(false);return;}
      var tx=idb.transaction('config','readwrite');
      tx.objectStore('config').put(handle,'carpeta');
      tx.oncomplete=function(){resolve(true);};
      tx.onerror=function(){resolve(false);};
    });
  });
}
function elegirCarpeta(){
  if(!window.showDirectoryPicker){
    toast('Este navegador no permite elegir una carpeta. Usa Descargar archivo.');
    return;
  }
  window.showDirectoryPicker({mode:'readwrite'}).then(function(root){
    return root.getDirectoryHandle('Mi Galpon',{create:true});
  }).then(function(folder){
    return guardarCarpeta(folder);
  }).then(function(ok){
    toast(ok?'Carpeta Mi Galpon lista para guardar archivos.':'No se pudo guardar la carpeta.');
  }).catch(function(error){
    if(error&&error.name==='AbortError')return;
    toast('No se pudo dar permiso a la carpeta.');
  });
}
function guardarEnCarpeta(nombre,blob){
  if(!carpetaHandle)return Promise.resolve(false);
  return carpetaHandle.queryPermission({mode:'readwrite'}).then(function(permission){
    if(permission!=='granted')return carpetaHandle.requestPermission({mode:'readwrite'});
    return permission;
  }).then(function(permission){
    if(permission!=='granted')return false;
    return carpetaHandle.getFileHandle(nombre,{create:true}).then(function(fileHandle){
      return fileHandle.createWritable().then(function(writable){
        return writable.write(blob).then(function(){return writable.close();}).then(function(){return true;});
      });
    });
  }).catch(function(){return false;});
}

function estadoDePedidoBusqueda(p){
  var q=(pedidoBuscar||'').trim().toLowerCase();
  if(!q)return true;
  var texto=(p.cliente||'')+' '+(p.notas||'')+' '+pedidoTxt(p)+' '+(p.pago||'')+' '+(p.entrega||'');
  return texto.toLowerCase().indexOf(q)>=0;
}

/* ---------- Utilidades ---------- */
var $=function(s){return document.querySelector(s);};
var val=function(id){return document.getElementById(id).value;};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
var uid=function(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);};
var num=function(v){var n=parseFloat(String(v==null?'':v).replace(/\s/g,'').replace(',','.'));return isFinite(n)?n:0;};
var sum=function(a,f){return a.reduce(function(s,x){return s+f(x);},0);};
var pad2=function(n){return String(n).padStart(2,'0');};
var isoDate=function(d){return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());};
var hoy=function(){return isoDate(new Date());};
function haceDias(n){var d=new Date();d.setDate(d.getDate()-n);return isoDate(d);}
function fmtFecha(f){
  try{return new Date(f+'T12:00:00').toLocaleDateString('es-CO',{weekday:'short',day:'numeric',month:'short'}).replace(/\./g,'');}
  catch(e){return f;}
}
var nf=function(n){return Math.round(n).toLocaleString('es-CO');};
var nf1=function(n){return n.toLocaleString('es-CO',{maximumFractionDigits:1});};
var money=function(n){return '$'+Math.round(n).toLocaleString('es-CO');};
var pctTxt=function(p){return nf1(Math.round(p*10)/10)+' %';};
function pcBase(){return db.config.porCanasta>0?db.config.porCanasta:30;}
function canastasTxt(eggs,pc){
  pc=pc||pcBase(); eggs=Math.max(0,Math.round(eggs));
  var c=Math.floor(eggs/pc), s=eggs%pc;
  var a=c+(c===1?' canasta':' canastas');
  return s?a+' + '+s+(s===1?' suelto':' sueltos'):a;
}

/* ---------- Cálculos ---------- */
function totalGallinas(){return sum(db.gallinas,function(m){return m.tipo==='entrada'?m.cantidad:-m.cantidad;});}
function buenos(d){return Math.max(0,d.huevos-(d.rotos||0));}
function pcDe(p){return p.pc||pcBase();}
function huevosPedido(p){return Math.round(num(p.canastas))*pcDe(p)+Math.round(num(p.sueltos));}
function unidadDe(p){
  if(p.unidad)return {u:p.unidad,n:p.cantidad};
  return (p.sueltos>0)?{u:'Unidad',n:huevosPedido(p)}:{u:'Canasta',n:p.canastas};
}
function pedidoTxt(p){
  var k=unidadDe(p), n=k.n;
  if(k.u==='Canasta')return nf1(n)+(n===1?' canasta':' canastas');
  if(k.u==='Media')return nf1(n)+(n===1?' media canasta':' medias canastas');
  return nf1(n)+(n===1?' huevo':' huevos');
}
function stock(excl){
  var rec=sum(db.dias,buenos), ent=0, comp=0;
  db.pedidos.forEach(function(p){
    if(p.id===excl)return;
    if(p.entrega==='Entregado')ent+=huevosPedido(p); else comp+=huevosPedido(p);
  });
  return {rec:rec,ent:ent,comp:comp,total:rec-ent,libres:rec-ent-comp};
}
function posturaDia(d){return d.gallinas>0?d.huevos/d.gallinas*100:null;}
function fechaLibre(){
  for(var i=0;i<60;i++){var f=haceDias(i); if(!db.dias.some(function(d){return d.fecha===f;}))return f;}
  return hoy();
}
function desdePeriodo(valor){return valor==='hoy'?hoy():valor==='7'?haceDias(6):valor==='15'?haceDias(14):valor==='30'?haceDias(29):'0000-00-00';}
function resumenGastos(desde_){
  var gs=(db.gastos||[]).filter(function(g){return g.fecha>=desde_&&g.fecha<=hoy();});
  return {gastos:gs,total:sum(gs,function(g){return g.monto||0;})};
}

/* ---------- Clientes ---------- */
function statsCliente(nombre){
  var ln=(nombre||'').trim().toLowerCase();
  var ps=db.pedidos.filter(function(p){return (p.cliente||'').trim().toLowerCase()===ln;});
  var total=sum(ps,function(p){return p.total||0;});
  var pendiente=sum(ps.filter(function(p){return p.pago==='Pendiente';}),function(p){return p.total||0;});
  var canastasEq=sum(ps,function(p){return huevosPedido(p)/(p.pc||pcBase());});
  return {ps:ps,total:total,pendiente:pendiente,canastasEq:canastasEq,n:ps.length};
}

/* ---------- Mortalidad y morbilidad ---------- */
function semanaKey(fecha){
  var d=new Date(fecha+'T12:00:00'), dia=(d.getDay()+6)%7;
  d.setDate(d.getDate()-dia); return isoDate(d);
}
function percentil(arr,p){
  if(!arr.length)return 0;
  var s=arr.slice().sort(function(a,b){return a-b;}), idx=(p/100)*(s.length-1), lo=Math.floor(idx), hi=Math.ceil(idx);
  return lo===hi?s[lo]:s[lo]+(s[hi]-s[lo])*(idx-lo);
}
function semanasHistoricas(){
  var fechas=db.gallinas.map(function(m){return m.fecha;}).concat(db.dias.map(function(d){return d.fecha;}));
  if(!fechas.length)return [];
  var min=fechas.reduce(function(a,b){return b<a?b:a;});
  var fin=semanaKey(hoy()), out=[], d=new Date(semanaKey(min)+'T12:00:00');
  while(isoDate(d)<fin){out.push(isoDate(d));d.setDate(d.getDate()+7);}
  return out;
}
function mortalidadPorSemana(){
  var map={};
  db.gallinas.forEach(function(m){
    if(m.tipo==='baja'&&(m.causa||'Mortalidad')==='Mortalidad'){var k=semanaKey(m.fecha);map[k]=(map[k]||0)+m.cantidad;}
  });
  return map;
}
function morbilidadPorSemana(){
  var map={};
  db.dias.forEach(function(d){
    if(d.enfermas){var k=semanaKey(d.fecha);map[k]=(map[k]||0)+d.enfermas;}
  });
  return map;
}
function morbilidadSemana(k){return (morbilidadPorSemana())[k]||0;}
function alertaMortalidad(){
  var semanas=semanasHistoricas();
  if(semanas.length<3)return null;
  var map=mortalidadPorSemana(), historicas=semanas.map(function(k){return map[k]||0;});
  var p=db.config.percentilAlerta||75, umbral=percentil(historicas,p);
  var claveActual=semanaKey(hoy()), actual=map[claveActual]||0;
  if(actual>0&&actual>umbral)return {actual:actual,umbral:umbral,percentil:p};
  return null;
}
function alertaMorbilidad(){
  var semanas=semanasHistoricas();
  if(semanas.length<3)return null;
  var map=morbilidadPorSemana(), historicas=semanas.map(function(k){return map[k]||0;});
  var p=db.config.percentilAlerta||75, umbral=percentil(historicas,p);
  var claveActual=semanaKey(hoy()), actual=map[claveActual]||0;
  if(actual>0&&actual>umbral)return {actual:actual,umbral:umbral,percentil:p};
  return null;
}

/* ---------- Vistas ---------- */
var ICONS={
  inicio:'<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  huevos:'<path d="M12 3c3.5 0 6.5 6 6.5 10.2A6.5 6.5 0 0 1 12 20a6.5 6.5 0 0 1-6.5-6.8C5.5 9 8.5 3 12 3z"/>',
  pedidos:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>',
  gallinas:'<path d="M5 14c0-3.5 2.5-6 6-6h3c2 0 3.5 1 3.5 3v1c0 3.5-3 6-7 6-3.5 0-5.5-1.5-5.5-4z"/><path d="M14 8V6a1.5 1.5 0 0 1 3 0v2.5M17.5 11l2.5.5-2.5 1"/>',
  ventas:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M14.8 9.8c0-1.3-1.2-2-2.8-2s-2.7.8-2.7 1.9c0 2.7 5.5 1.3 5.5 4 0 1.1-1.1 1.9-2.8 1.9s-2.9-.7-2.9-2"/>',
  pagos:'<path d="M4 7h16v10H4z"/><path d="M4 10h16M8 14h3"/>',
  clientes:'<circle cx="9" cy="8" r="3"/><path d="M3.5 19c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2"/><circle cx="17" cy="8.5" r="2.3"/><path d="M15.3 13.6c2.3.4 4.2 2.2 4.2 4.9"/>',
  ajustes:'<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'
};
var TABS=[['inicio','Inicio'],['huevos','Huevos'],['pedidos','Pedidos'],['ventas','Ventas'],['ajustes','Ajustes']];

function empty(t,d){return '<div class="empty"><h3>'+t+'</h3><p>'+d+'</p></div>';}
function fld(id,label,attrs,v){return '<label class=\"f\"><span>'+label+'</span><input id=\"'+id+'\" value=\"'+esc(v)+'\" '+(attrs||'')+'></label>';}
function seg(id,opts,v){
  return '<div class=\"seg\" id=\"'+id+'\" role=\"radiogroup\">'+opts.map(function(o){
    return '<button type=\"button\" role=\"radio\" aria-checked=\"'+(o===v)+'\" data-v=\"'+o+'\" class=\"'+(o===v?'on':'')+'\">'+o+'</button>';
  }).join('')+'</div>';
}
function segVal(id){return document.querySelector('#'+id+' .on').dataset.v;}

function ring(p){
  var C=2*Math.PI*52, f=p==null?0:Math.min(100,p)/100;
  return '<svg class=\"ring\" viewBox=\"0 0 120 120\" role=\"img\" aria-label=\"Postura '+(p==null?'sin datos':pctTxt(p))+'\">'+
    '<circle cx=\"60\" cy=\"60\" r=\"52\" fill=\"none\" stroke=\"rgba(255,255,255,.22)\" stroke-width=\"10\"/>'+
    '<circle cx=\"60\" cy=\"60\" r=\"52\" fill=\"none\" style=\"stroke:var(--yema)\" stroke-width=\"10\" stroke-linecap=\"round\" stroke-dasharray=\"'+C.toFixed(1)+'\" stroke-dashoffset=\"'+(C*(1-f)).toFixed(1)+'\" transform=\"rotate(-90 60 60)\"/>'+
    '<text x=\"60\" y=\"63\" text-anchor=\"middle\" class=\"ringn\">'+(p==null?'–':nf1(Math.round(p*10)/10))+'</text>'+
    '<text x=\"60\" y=\"82\" text-anchor=\"middle\" class=\"ringu\">% de postura</text></svg>';
}

function chart14(){
  var out='<line x1=\"0\" x2=\"312\" y1=\"2\" y2=\"2\" style=\"stroke:var(--line)\" stroke-dasharray=\"3 3\"/>';
  for(var i=13;i>=0;i--){
    var f=haceDias(i), d=db.dias.find(function(x){return x.fecha===f;});
    var p=d?posturaDia(d):null, x=(13-i)*22+4;
    if(p==null){out+='<rect x=\"'+x+'\" y=\"92\" width=\"14\" height=\"2\" rx=\"1\" style=\"fill:var(--line)\"/>';}
    else{var h=Math.max(3,Math.min(100,p)*0.9);out+='<rect x=\"'+x+'\" y=\"'+(92-h).toFixed(1)+'\" width=\"14\" height=\"'+h.toFixed(1)+'\" rx=\"3\" style=\"fill:var(--yema)\"/>';}
    out+='<text x=\"'+(x+7)+'\" y=\"108\" text-anchor=\"middle\" class=\"cd\">'+parseInt(f.slice(8),10)+'</text>';
  }
  return '<svg viewBox=\"0 0 312 114\" class=\"chart\" role=\"img\" aria-label=\"Postura de los últimos 14 días\">'+out+'</svg>';
}

function resumenPeriodo(dd){
  var dias=db.dias.filter(function(d){return d.fecha>=dd;}).sort(function(a,b){return a.fecha.localeCompare(b.fecha);});
  var rec=sum(dias,function(d){return d.huevos||0;});
  var rotos=sum(dias,function(d){return d.rotos||0;});
  var alim=sum(dias,function(d){return d.alimento||0;});
  var diasConGallinas=dias.filter(function(d){return d.gallinas>0;});
  var pos=diasConGallinas.length>0?sum(diasConGallinas,function(d){return d.huevos/d.gallinas;})/diasConGallinas.length*100:null;
  var ventas=ventasResumen(dd);
  var pedidosPendientes=db.pedidos.filter(function(p){return p.pago==='Pendiente';}).length;
  return {dias:dias,rec:rec,rotos:rotos,alim:alim,pos:pos,ventas:ventas,pedidosPendientes:pedidosPendientes};
}

function viewInicio(){
  var tg=totalGallinas(), st=stock();
  var hoyRec=db.dias.find(function(d){return d.fecha===hoy();});
  var ult=hoyRec||db.dias.slice().sort(function(a,b){return b.fecha.localeCompare(a.fecha);})[0];
  var p=ult?posturaDia(ult):null;

  var periodoResumen=resumenPeriodo(desdePeriodo(periodoInicio));
  var kpis=[
    {label:'Gallinas',value:nf(tg)+'',meta:'en el galpón'},
    {label:'Huevos',value:nf(periodoResumen.rec),meta:'en '+(periodoResumen.dias.length?periodoResumen.dias.length+' días':'este periodo')},
    {label:'Postura',value:p==null?'–':pctTxt(p),meta:'hoy'},
    {label:'Stock',value:canastasTxt(st.total),meta: st.total>=0? 'disponible':''},
    {label:'Ventas',value:money(periodoResumen.ventas.total),meta:'periodo'},
    {label:'Cobrado',value:money(periodoResumen.ventas.cobrado),meta:'periodo'}
  ];

  var h='';
  if(tg===0){
    h+='<section class=\"hero solo\"><h2>Empieza contando tus gallinas</h2><p>Con el total de gallinas puedo calcular el porcentaje de postura de cada día.</p><button class=\"btn yema\" data-act=\"gal-in\">Registrar mis gallinas</button></section>';
  }else{
    h+='<section class=\"hero\">'+ring(p)+'<div class=\"hero-t\"><p class=\"big\">'+nf(tg)+' <span>gallinas</span></p><p>'+
      (hoyRec?nf(hoyRec.huevos)+' huevos hoy':ult?'Último registro: '+fmtFecha(ult.fecha):'Aún no hay recogidas')+
      '</p><button class=\"btn yema\" data-act=\"hoy\">'+(hoyRec?'Editar recogida de hoy':'Registrar recogida de hoy')+'</button></div></section>';
  }

  h+='<div class=\"kpis\">'+kpis.map(function(k){
    var cls='up';
    if(k.label==='Stock'){
      cls=st.total<0?'low':'up';
    }else if(k.label==='Ventas'){
      cls='up';
    }
    return '<div class=\"kpi\"><span class=\"small\">'+k.label+'</span><div class=\"big\">'+k.value+'</div><span class=\"trend '+cls+'\">'+k.meta+'</span></div>';
  }).join('')+'</div>';

  var alerta=alertaMortalidad(), alertaE=alertaMorbilidad();
  if(alerta)h+='<div class=\"panel pad\" style=\"border-color:var(--rojo);margin-bottom:12px\"><p class=\"row warnrow\" style=\"padding:0;border:0\">⚠ Esta semana llevas '+nf(alerta.actual)+' bajas por mortalidad, más que en la mayoría de las semanas anteriores. Revisa la salud del lote.</p></div>';
  if(alertaE)h+='<div class=\"panel pad\" style=\"border-color:var(--rojo);margin-bottom:12px\"><p class=\"row warnrow\" style=\"padding:0;border:0\">⚠ Esta semana reportaste '+nf(alertaE.actual)+' gallinas enfermas, más que en la mayoría de las semanas anteriores. Revisa la salud del lote.</p></div>';

  var c0=Math.floor(Math.max(0,st.total)/pcBase()), s0=Math.max(0,st.total)%pcBase();
  h+='<h2 class=\"sec\">En el galpón</h2><div class=\"panel\"><p class=\"stockn\">'+c0+' <small>'+(c0===1?'canasta':'canastas')+'</small> <span>+ '+s0+(s0===1?' suelto':' sueltos')+'</span></p>';
  h+='<div class=\"row\"><span>Huevos sin vender</span><b>'+nf(Math.max(0,st.total))+'</b></div>';
  if(st.comp>0)h+='<div class=\"row\"><span>Encargos por entregar</span><b>'+canastasTxt(st.comp)+'</b></div><div class=\"row\"><span>Libres para vender</span><b>'+canastasTxt(st.libres)+'</b></div>';
  if(st.total<0)h+='<div class=\"row warnrow\">Entregaste más huevos de los que registraste. Revisa las recogidas y los pedidos.</div>';
  h+='</div>';

  var dd=desdePeriodo(periodoInicio);
  var dsel=periodoResumen.dias;
  var dg=dsel.filter(function(d){return d.gallinas>0;});
  var rec=periodoResumen.rec, rotos=periodoResumen.rotos;
  var gd=sum(dg,function(d){return d.gallinas;});
  var pos=gd>0?sum(dg,function(d){return d.huevos;})/gd*100:null;
  var alim=periodoResumen.alim;
  var gpd=gd>0&&alim>0?alim*1000/gd:null;
  var psel=db.pedidos.filter(function(x){return x.fecha>=dd;});
  var vend=sum(psel.filter(function(x){return x.entrega==='Entregado';}),huevosPedido);
  var cobrado=sum(psel.filter(function(x){return x.pago==='Pagado';}),function(x){return x.total||0;});
  var porCobrar=sum(psel.filter(function(x){return x.pago==='Pendiente';}),function(x){return x.total||0;});

  h+='<h2 class=\"sec\">Resumen</h2><div class=\"chips\">'+[['hoy','Hoy'],['7','7 días'],['30','30 días']].map(function(o){
    return '<button class=\"chip'+(periodoInicio===o[0]?' on':'')+'" data-act=\"periodo\" data-v=\"'+o[0]+'\">'+o[1]+'</button>';}).join('')+'</div>';
  h+='<div class=\"panel\">'+
    '<div class=\"row\"><span>Huevos recogidos</span><b>'+nf(rec)+(rotos?' ('+nf(rotos)+' rotos)':'')+'</b></div>'+
    '<div class=\"row\"><span>Postura promedio</span><b>'+(pos==null?'–':pctTxt(pos))+'</b></div>'+
    '<div class=\"row\"><span>Alimento echado</span><b>'+nf1(alim)+' kg</b></div>'+
    '<div class=\"row\"><span>Alimento por gallina</span><b>'+(gpd==null?'–':nf(gpd)+' g al día')+'</b></div>'+
    '<div class=\"row\"><span>Vendido</span><b>'+canastasTxt(vend)+'</b></div>'+
    '<div class=\"row\"><span>Dinero cobrado</span><b>'+money(cobrado)+'</b></div>'+
    '<div class=\"row\"><span>Por cobrar (todos los pedidos)</span><b>'+money(porCobrar)+'</b></div></div>';

  h+='<h2 class=\"sec\">Postura de los últimos 14 días</h2><div class=\"panel\">'+chart14()+'<p class=\"cap\">Cada barra es un día. La línea punteada marca el 100 %.</p></div>';
  var recientes=db.dias.slice().sort(function(a,b){return b.fecha.localeCompare(a.fecha);}).slice(0,3);
  var pedidosRecientes=db.pedidos.filter(function(p){return p.pago==='Pendiente';}).slice().sort(function(a,b){return b.fecha.localeCompare(a.fecha);}).slice(0,3);
  h+='<h2 class="sec">Actividad reciente</h2><div class="panel activity-list">';
  if(recientes.length)h+='<div class="activity-group"><strong>Últimas recogidas</strong>'+recientes.map(function(d){return '<div class="activity-row"><span>'+fmtFecha(d.fecha)+'</span><b>'+nf(d.huevos)+' huevos</b></div>';}).join('')+'</div>';
  if(pedidosRecientes.length)h+='<div class="activity-group"><strong>Pedidos pendientes</strong>'+pedidosRecientes.map(function(p){return '<div class="activity-row"><span>'+esc(p.cliente)+'</span><b>'+money(p.total||0)+'</b></div>';}).join('')+'</div>';
  if(!recientes.length&&!pedidosRecientes.length)h+='<p class="hint">Todavía no hay actividad reciente.</p>';
  h+='<div class="activity-total"><span>Dinero por cobrar</span><b>'+money(porCobrar)+'</b></div></div>';
  return h;
}

function viewHuevos(){
  var l=db.dias.slice().sort(function(a,b){
    return b.fecha.localeCompare(a.fecha);
  });

  if(!l.length){
      return empty('Aún no hay recogidas','Registra los huevos del día para ver tu producción y la postura.');
  }
  var dd=desdePeriodo(periodoHuevos);
  var periodoDias=l.filter(function(d){return d.fecha>=dd;});
  var huevosPeriodo=sum(periodoDias,function(d){return buenos(d);});
  var periodoRotos=sum(periodoDias,function(d){return d.rotos||0;});

  function fechaPartes(fecha){
    var d=new Date(fecha+'T12:00:00');
    return {
      dia:d.getDate(),
      mes:d.toLocaleDateString('es-CO',{month:'short'}).replace('.',''),
      texto:fmtFecha(fecha)
    };
  }

  return '<div class="history-section-title">'+
    '<h2>Historial de huevos</h2>'+
    '<span class="history-count">'+periodoDias.length+' '+(periodoDias.length===1?'registro':'registros')+'</span>'+
    '</div>'+
    '<div class="chips">'+[['hoy','Hoy'],['7','7 días'],['15','15 días'],['30','30 días']].map(function(o){
      return '<button class="chip'+(periodoHuevos===o[0]?' on':'')+'" data-act="periodo" data-v="'+o[0]+'">'+o[1]+'</button>';
    }).join('')+'</div>'+
    '<div class="panel"><div class="row"><span>Huevos buenos</span><b>'+nf(huevosPeriodo)+'</b></div><div class="row"><span>Rotos o dañados</span><b>'+nf(periodoRotos)+'</b></div><div class="row"><span>Días registrados</span><b>'+nf(periodoDias.length)+'</b></div></div>'+
    '<h2 class="sec" style="margin-top:16px">Registros</h2>'+
    '<div class="history-list">'+
    periodoDias.map(function(d){
      var b=buenos(d);
      var p=posturaDia(d);
      var f=fechaPartes(d.fecha);
      var cls=p==null?'':p>=80?'ok':p>=60?'wait':'bad';

      return '<article class="history-card" role="button" tabindex="0" data-act="dia-view" data-id="'+d.id+'">'+
        '<div class="history-top">'+
          '<div class="history-date">'+
            '<div class="date-box">'+
              '<strong>'+f.dia+'</strong>'+
              '<small>'+f.mes+'</small>'+
            '</div>'+
            '<div>'+
              '<span class="history-title">'+
                (d.fecha===hoy()?'Hoy':f.texto)+
              '</span>'+
              '<span class="history-sub">Registro de producción</span>'+
            '</div>'+
          '</div>'+
          '<span class="pill '+cls+'">'+
            (p==null?'Sin postura':pctTxt(p))+
          '</span>'+
        '</div>'+

        '<div class="history-main">'+
          '<div>'+
            '<div class="history-number">'+nf(b)+' <small>huevos buenos</small></div>'+
            '<span class="history-sub">Buenos: '+nf(b)+' huevos</span>'+
            '<span class="history-sub">Rotos: '+nf(d.rotos||0)+' huevos</span>'+
          '</div>'+
          '<div class="history-side">'+
            '<strong>'+canastasTxt(b)+'</strong>'+
            '<span class="history-sub">producción útil</span>'+
          '</div>'+
        '</div>'+

        '<div class="history-footer">'+
          '<span class="history-stat">🐔 <strong>'+nf(d.gallinas)+'</strong> gallinas</span>'+
          (d.alimento?
            '<span class="history-stat">🌾 <strong>'+nf1(d.alimento)+'</strong> kg</span>':'')+
          (d.enfermas?
            '<span class="history-stat">⚠ <strong>'+nf(d.enfermas)+'</strong> enfermas</span>':'')+
        '</div>'+
      '</article>';
    }).join('')+
    '</div>';
}

function fichaDia(id){
  var d=db.dias.find(function(x){return x.id===id;});
  if(!d)return;
  var buenosHuevos=buenos(d), postura=posturaDia(d);
  var h='<div class="detail-hero">'+
    '<span class="detail-kicker">Registro de producción</span>'+ 
    '<strong class="detail-total">'+nf(buenosHuevos)+' huevos buenos</strong>'+ 
    '<span class="detail-date">'+(d.fecha===hoy()?'Hoy':fmtFecha(d.fecha))+'</span>'+ 
    '</div>'+ 
    '<div class="detail-list">'+
      '<div class="detail-row"><span>Huevos recogidos</span><b>'+nf(d.huevos)+'</b></div>'+ 
      '<div class="detail-row"><span>Huevos buenos</span><b>'+nf(buenosHuevos)+'</b></div>'+ 
      '<div class="detail-row"><span>Rotos o dañados</span><b>'+nf(d.rotos||0)+'</b></div>'+ 
      '<div class="detail-row"><span>Postura</span><b>'+(postura==null?'Sin dato':pctTxt(postura))+'</b></div>'+ 
      '<div class="detail-row"><span>Gallinas</span><b>'+nf(d.gallinas||0)+'</b></div>'+ 
      '<div class="detail-row"><span>Alimento echado</span><b>'+(d.alimento?nf1(d.alimento)+' kg':'Sin dato')+'</b></div>'+ 
      '<div class="detail-row"><span>Gallinas enfermas</span><b>'+nf(d.enfermas||0)+'</b></div>'+ 
      (d.notas?'<div class="detail-row detail-notes"><span>Notas</span><b>'+esc(d.notas)+'</b></div>':'')+ 
    '</div>'+ 
    '<div class="btnrow detail-actions"><button class="btn wide" data-do="editar">Editar información</button></div>';
  openSheet(d.fecha===hoy()?'Registro de hoy':'Detalle de recogida',h);
  act.editar=function(){openDia(id);};
}

function viewPedidos(){
  var all=db.pedidos.slice().sort(function(a,b){
    return b.fecha.localeCompare(a.fecha)||b.id.localeCompare(a.id);
  });
  var st=stock();
  var pedidosDelPeriodo=all.filter(function(p){return p.fecha>=desdePeriodo(periodoPedidos);});
  var periodoTotal=sum(pedidosDelPeriodo,function(p){return p.total||0;});
  var periodoHuevos=sum(pedidosDelPeriodo,huevosPedido);
  var porCobrar=sum(pedidosDelPeriodo.filter(function(p){return p.pago==='Pendiente';}),function(p){return p.total||0;});
  var pedidosFiltrados=pedidosDelPeriodo.filter(function(p){
    return filtro==='todos'?true:
      filtro==='cobrar'?p.pago==='Pendiente':
      filtro==='entregar'?p.entrega==='Encargo':
      filtro==='listos'?p.pago==='Pagado'&&p.entrega==='Entregado':
      true;
  }).filter(estadoDePedidoBusqueda);

  var h='<div class="history-section-title">'+
    '<h2>Pedidos</h2>'+
    '<span class="history-count">'+pedidosDelPeriodo.length+' '+(pedidosDelPeriodo.length===1?'pedido':'pedidos')+'</span>'+
    '</div>'+
    '<div class="chips">'+[['hoy','Hoy'],['7','7 días'],['15','15 días'],['30','30 días']].map(function(o){
      return '<button class="chip'+(periodoPedidos===o[0]?' on':'')+'" data-act="periodo" data-v="'+o[0]+'">'+o[1]+'</button>';
    }).join('')+'</div>'+
    '<div class="panel"><div class="row"><span>Ventas del periodo</span><b>'+money(periodoTotal)+'</b></div><div class="row"><span>Huevos comprometidos</span><b>'+nf(periodoHuevos)+'</b></div><div class="row"><span>Pedidos del periodo</span><b>'+nf(pedidosDelPeriodo.length)+'</b></div></div>'+
    '<div class="panel" style="margin-bottom:12px">'+
      '<div class="row"><span>Por cobrar</span><b>'+money(porCobrar)+'</b></div>'+ 
      '<div class="row"><span>Huevos comprometidos</span><b>'+canastasTxt(periodoHuevos)+'</b></div>'+
    '</div>'+
    '<div class="search"><input id="pedidoSearch" placeholder="Buscar cliente o pedido" value="'+esc(pedidoBuscar)+'"></div>';

  h+='<div class="chips" style="margin-top:2px">'+
    [
      ['todos','Todos'],
      ['cobrar','Por cobrar'],
      ['entregar','Por entregar'],
      ['listos','Completos']
    ].map(function(o){
      var cantidad=
        o[0]==='todos'?pedidosDelPeriodo.length:
        o[0]==='cobrar'?pedidosDelPeriodo.filter(function(p){
          return p.pago==='Pendiente';
        }).length:
        o[0]==='entregar'?pedidosDelPeriodo.filter(function(p){
          return p.entrega==='Encargo';
        }).length:
        pedidosDelPeriodo.filter(function(p){
          return p.pago==='Pagado'&&p.entrega==='Entregado';
        }).length;

      return '<button class="chip '+(filtro===o[0]?'on':'')+
        '" data-act="filtro" data-v="'+o[0]+'">'+
        o[1]+' · '+cantidad+
      '</button>';
    }).join('')+
  '</div>';

  if(!all.length){
    return h+empty(
      'Aún no hay pedidos',
      'Crea tu primer pedido para llevar el control de pagos y entregas.'
    );
  }

  if(!pedidosFiltrados.length){
    return h+empty(
      'No encontramos pedidos',
      'Prueba con otro filtro o cambia la búsqueda.'
    );
  }

  h+='<p class="cap">Toca un pedido para ver sus detalles. También puedes cambiar el pago o la entrega directamente.</p>';

  h+='<div class="history-list">'+
    pedidosFiltrados.map(function(p){
      var nombre=esc(p.cliente)||'Sin nombre';
      var inicial=(p.cliente||'S').trim().charAt(0).toUpperCase();

      return '<div class="order-card" role="button" tabindex="0" '+
        'data-act="pedido-view" data-id="'+p.id+'">'+

        '<div class="order-head">'+
          '<div class="order-client">'+
            '<div class="client-avatar">'+inicial+'</div>'+
            '<div>'+
              '<b>'+nombre+'</b>'+
              '<span class="order-date">'+fmtFecha(p.fecha)+'</span>'+
            '</div>'+
          '</div>'+
          '<span class="order-total">'+money(p.total||0)+'</span>'+
        '</div>'+

        '<div class="order-detail">'+
          '<div>'+
            '<strong>'+pedidoTxt(p)+'</strong>'+
            '<span>'+(p.entrega==='Encargo'&&p.fechaEntrega?
              'Entrega el '+fmtFecha(p.fechaEntrega):
              p.entrega)+'</span>'+
          '</div>'+
          '<span class="pill '+(p.entrega==='Entregado'?'ok':'wait')+'">'+
            (p.entrega==='Entregado'?'Listo':'Pendiente')+
          '</span>'+
        '</div>'+

        '<div class="order-status">'+
          '<button type="button" class="pill tg '+
            (p.pago==='Pagado'?'ok':'bad')+
            '" data-act="tog-pago" data-id="'+p.id+'">'+
            (p.pago==='Pagado'?'✓ Pagado':'Pendiente de pago')+
            ' ⇄</button>'+
          '<button type="button" class="pill tg '+
            (p.entrega==='Entregado'?'ok':'wait')+
            '" data-act="tog-ent" data-id="'+p.id+'">'+
            (p.entrega==='Entregado'?'✓ Entregado':'Por entregar')+
            ' ⇄</button>'+
        '</div>'+

      '</div>';
    }).join('')+
  '</div>';

  return h;
}

function fichaPedido(id){
  var p=db.pedidos.find(function(x){return x.id===id;});
  if(!p)return;
  var cliente=esc(p.cliente)||'Sin nombre';
  var entrega=p.entrega==='Encargo'&&p.fechaEntrega?'Entrega el '+fmtFecha(p.fechaEntrega):p.entrega;
  var h='<div class="detail-hero">'+
    '<span class="detail-kicker">Pedido de '+cliente+'</span>'+ 
    '<strong class="detail-total">'+money(p.total||0)+'</strong>'+ 
    '<span class="detail-date">'+fmtFecha(p.fecha)+'</span>'+ 
    '</div>'+ 
    '<div class="detail-list">'+
      '<div class="detail-row"><span>Cliente</span><b>'+cliente+'</b></div>'+ 
      '<div class="detail-row"><span>Cantidad</span><b>'+esc(pedidoTxt(p))+'</b></div>'+ 
      '<div class="detail-row"><span>Huevos</span><b>'+nf(huevosPedido(p))+'</b></div>'+ 
      '<div class="detail-row"><span>Pago</span><b>'+esc(p.pago||'Pendiente')+'</b></div>'+ 
      '<div class="detail-row"><span>Entrega</span><b>'+esc(entrega||'Pendiente')+'</b></div>'+ 
      '<div class="detail-row"><span>Precio aplicado</span><b>'+money(p.precio||0)+'</b></div>'+ 
      (p.notas?'<div class="detail-row detail-notes"><span>Notas</span><b>'+esc(p.notas)+'</b></div>':'')+ 
    '</div>'+ 
    '<div class="btnrow detail-actions"><button class="btn wide" data-do="editar">Editar información</button></div>';
  openSheet('Detalle del pedido',h);
  act.editar=function(){openPedido(id);};
}

function ventasResumen(desde_){
  var ps=db.pedidos.filter(function(p){return p.fecha>=desde_;});
  var grp={Canasta:{n:0,h:0},Media:{n:0,h:0},Unidad:{n:0,h:0}};
  ps.forEach(function(p){
    var u=unidadDe(p), k=grp[u.u]||grp.Unidad;
    k.n+=u.n; k.h+=huevosPedido(p);
  });
  var total=sum(ps,function(p){return p.total||0;});
  var cobrado=sum(ps.filter(function(p){return p.pago==='Pagado';}),function(p){return p.total||0;});
  var pend=total-cobrado;
  return {ps:ps,grp:grp,total:total,cobrado:cobrado,pend:pend};
}

function viewVentas(){
  var r=ventasResumen(desdePeriodo(periodoVentas));
  var g=resumenGastos(desdePeriodo(periodoVentas));
  var utilidad=r.cobrado-g.total;
  var h='<h2 class=\"sec\">Ventas</h2><div class=\"chips\">'+[['hoy','Hoy'],['7','7 días'],['15','15 días'],['30','30 días']].map(function(o){
    return '<button class=\"chip'+(periodoVentas===o[0]?' on':'')+'" data-act=\"periodo\" data-v=\"'+o[0]+'\">'+o[1]+'</button>';}).join('')+'</div>';
  h+='<div class=\"panel\">'+
    '<p class=\"stockn\">'+money(r.total)+' <small>vendido</small></p>'+
    '<div class=\"row\"><span>Dinero cobrado</span><b>'+money(r.cobrado)+'</b></div>'+
    '<div class=\"row\"><span>Falta por cobrar</span><b>'+money(r.pend)+'</b></div>'+
    '<div class=\"row\"><span>Gastos del periodo</span><b>'+money(g.total)+'</b></div>'+
    '<div class=\"row\"><span>Disponible después de gastos</span><b>'+money(utilidad)+'</b></div>'+
    '</div>';

  h+='<h2 class=\"sec\">Huevos vendidos por tipo</h2><div class=\"panel\">'+
    '<div class=\"row\"><span>Canastas</span><b>'+nf1(r.grp.Canasta.n)+' ('+nf(r.grp.Canasta.h)+' huevos)</b></div>'+
    '<div class=\"row\"><span>Medias canastas</span><b>'+nf1(r.grp.Media.n)+' ('+nf(r.grp.Media.h)+' huevos)</b></div>'+
    '<div class=\"row\"><span>Huevos sueltos</span><b>'+nf(r.grp.Unidad.n)+'</b></div>'+
    '<div class=\"row\"><span>Total de huevos vendidos</span><b>'+nf(r.grp.Canasta.h+r.grp.Media.h+r.grp.Unidad.h)+'</b></div>'+
    '</div>';

  if(!r.ps.length)h+='<p class=\"cap\">No hay pedidos en este periodo.</p>';
  return h;
}

function viewPagos(){
  var pagos=Array.isArray(db.config.ownerPayments)?db.config.ownerPayments:[];
  var desdePago=periodoPagos==='todo'?'0000-00-00':periodoPagos==='hoy'?hoy():haceDias(periodoPagos==='7'?6:29);
  var pagosPeriodo=pagos.filter(function(p){return p.date>=desdePago&&p.date<=hoy();});
  var total=sum(pagosPeriodo,function(p){return p.amount||0;});
  var h='<div class="settings-intro payments-intro"><span class="settings-kicker">Control financiero</span><h2>Pagos al dueño</h2><p>Registra y consulta cada entrega de dinero del galpón.</p></div>'+
    '<div class="panel pad owner-summary"><div class="owner-card-head"><div><span class="sub">Total entregado</span><b class="owner-period">Periodo seleccionado</b></div><span class="owner-total">'+money(total)+'</span></div></div>'+
    '<div class="chips payment-periods">'+[['hoy','Hoy'],['7','7 días'],['30','30 días'],['todo','Todo']].map(function(o){
      return '<button class="chip'+(periodoPagos===o[0]?' on':'')+'" data-act="periodo-pagos" data-v="'+o[0]+'">'+o[1]+'</button>';}).join('')+'</div>'+
    '<h2 class="sec">Registrar entrega</h2><div class="panel pad">'+
    fld('owner-name','Nombre','required autocomplete="off"','')+
    fld('owner-amount','Monto entregado','required inputmode="numeric" autocomplete="off"','')+
    fld('owner-date','Fecha','required type="date"',hoy())+
    '<button class="btn wide" style="margin-top:0" data-act="owner-payment">Registrar entrega</button></div>'+
    '<h2 class="sec">Historial de pagos</h2>';
  if(!pagosPeriodo.length){
    h+=empty('Aún no hay entregas en este periodo','Registra una entrega o selecciona otro periodo.');
  }else{
    h+='<div class="panel list payment-history">'+pagosPeriodo.slice().sort(function(a,b){return b.date.localeCompare(a.date)||b.id.localeCompare(a.id);}).map(function(p){
      return '<div class="item payment-history-row"><div><b>'+fmtFecha(p.date)+'</b><span class="sub">'+esc(p.name||'Sin nombre')+'</span></div><div class="payment-history-right"><strong>'+money(p.amount)+'</strong><span class="payment-locked" aria-label="Registro bloqueado">Bloqueado</span></div></div>';
    }).join('')+'</div>';
  }
  return h;
}

function viewClientes(){
  var registrados=db.clientes.slice();
  var nombresReg=registrados.map(function(c){return c.nombre.trim().toLowerCase();});
  var nombresPed=Array.from(new Set(db.pedidos.map(function(p){return (p.cliente||'').trim();}).filter(Boolean)));
  var frecuentes=nombresPed.filter(function(n){return nombresReg.indexOf(n.toLowerCase())<0;});
  var q=clienteBuscar.trim().toLowerCase();
  if(q){
    registrados=registrados.filter(function(c){return (c.nombre+' '+(c.telefono||'')).toLowerCase().indexOf(q)>=0;});
    frecuentes=frecuentes.filter(function(n){return n.toLowerCase().indexOf(q)>=0;});
  }

  var h='<div class="client-header"><button class="client-back-btn" type="button" data-act="clientes-atras" aria-label="Volver">&#8592;</button>'+
    '<div class="search client-search"><input id="clienteSearch" placeholder="Buscar por nombre o teléfono" value="'+esc(clienteBuscar)+'"></div></div>';
  if(!registrados.length&&!frecuentes.length)return h+empty('Aún no hay clientes','Anota un cliente para llevar su historial o un precio especial.');
  
  if(registrados.length){
    var conStats=registrados.map(function(c){return {c:c,s:statsCliente(c.nombre)};});
    conStats.sort(function(a,b){return (b.s.pendiente-a.s.pendiente)||(b.s.total-a.s.total);});
    h+='<h2 class=\"sec\">Directorio</h2><div class=\"panel list\">'+conStats.map(function(x){
      var c=x.c, s=x.s;
      return '<button class=\"item\" data-act=\"cli-open\" data-id=\"'+c.id+'\"><div><b>'+esc(c.nombre)+'</b>'+
        '<span class=\"sub\">'+(s.n?nf1(s.canastasEq)+' canastas compradas':'Sin compras todavía')+(c.precio?' · precio especial':'')+'</span></div>'+
        '<span'+(s.pendiente>0?' class=\"menos\"':' class=\"sub\"')+'>'+(s.pendiente>0?money(s.pendiente)+' por cobrar':'Al día')+'</span></button>';
    }).join('')+'</div>';
  }
  if(frecuentes.length){
    var conStats2=frecuentes.map(function(n){return {n:n,s:statsCliente(n)};});
    conStats2.sort(function(a,b){return b.s.n-a.s.n;});
    h+='<h2 class=\"sec\">Clientes frecuentes sin registrar</h2><p class=\"cap\">Compraron alguna vez pero no están en tu directorio. Agrégalos para asignarles un precio especial.</p><div class=\"panel list\">'+conStats2.map(function(x){
      return '<div class=\"item\" style=\"cursor:default\"><div><b>'+esc(x.n)+'</b><span class=\"sub\">'+x.s.n+(x.s.n===1?' pedido':' pedidos')+' · '+money(x.s.total)+'</span></div>'+
        '<button type=\"button\" class=\"mini\" data-act=\"cli-add\" data-nom=\"'+esc(x.n)+'\">Agregar</button></div>';
    }).join('')+'</div>';
  }
  return h;
}

function fichaCliente(id){
  var c=db.clientes.find(function(x){return x.id===id;});
  if(!c)return;
  var s=statsCliente(c.nombre);
  var h='<div class=\"panel pad\">'+
    (c.telefono?'<p class=\"hint\" style=\"margin:0 0 10px\">'+esc(c.telefono)+'</p>':'')+
    '<div class=\"row\" style=\"padding:0 0 8px;border:0\"><span>Precio especial</span><b>'+(c.precio?money(c.precio)+' la canasta':'Precio normal')+'</b></div>'+
    '<div class=\"row\" style=\"padding:8px 0;border-top:1px solid var(--line)\"><span>Comprado en total</span><b>'+money(s.total)+'</b></div>'+
    '<div class=\"row\" style=\"padding:8px 0;border-top:1px solid var(--line)\"><span>Saldo pendiente</span><b style=\"'+(s.pendiente>0?'color:var(--rojo)':'')+'\">'+money(s.pendiente)+'</b></div>'+
    '<div class=\"row\" style=\"padding:8px 0;border-top:1px solid var(--line)\"><span>Canastas equivalentes compradas</span><b>'+nf1(s.canastasEq)+'</b></div>'+
    (c.notas?'<div class=\"row\" style=\"padding:8px 0;border-top:1px solid var(--line)\"><span>Notas</span><b style=\"text-align:right;font-weight:400\">'+esc(c.notas)+'</b></div>':'')+
    '</div>';
  h+='<h3 class=\"lbl\" style=\"margin-top:16px\">Historial de compras</h3>';
  if(!s.ps.length){
    h+='<p class=\"hint\">Aún no hay pedidos de este cliente.</p>';
  }else{
    var ps=s.ps.slice().sort(function(a,b){return b.fecha.localeCompare(a.fecha);});
    h+='<div class=\"panel list\">'+ps.map(function(p){
      return '<button class=\"item\" data-open-pedido data-id=\"'+p.id+'\"><div><b>'+fmtFecha(p.fecha)+'</b><span class=\"sub\">'+esc(pedidoTxt(p))+'</span></div>'+
        '<div style=\"text-align:right\"><span class=\"money\" style=\"font:700 15px var(--serif)\">'+money(p.total||0)+'</span><br><span class=\"pill '+(p.pago==='Pagado'?'ok':'bad')+'\" style=\"margin-top:4px\">'+p.pago+'</span></div></button>';
    }).join('')+'</div>';
  }
  h+='<div class=\"btnrow\" style=\"margin-top:16px\"><button class=\"btn\" data-do=\"pedido\">Nuevo pedido</button><button class=\"btn sec\" data-do=\"editar\">Editar cliente</button></div>'+
    '<button class=\"btn warn wide\" data-do=\"quitar\">Quitar del directorio</button>';
  openSheet(c.nombre,h);
  act.editar=function(){openClienteForm(c.id);};
  act.pedido=function(){closeSheet();openPedido(null,c.nombre);};
  act.quitar=function(){
    confirmSheet('¿Quitar a '+esc(c.nombre)+' del directorio?','Sus pedidos siguen en Pedidos, pero se pierde el precio especial.','Quitar',function(){
      db.clientes=db.clientes.filter(function(x){return x.id!==c.id;});save();render();toast('Cliente quitado');
    });
  };
}

function openClienteForm(id,nombreSug){
  var ex=id?db.clientes.find(function(x){return x.id===id;}):null;
  var c=ex||{nombre:nombreSug||'',telefono:'',precio:'',notas:''};
  openSheet(ex?'Editar cliente':'Nuevo cliente',
    fld('cl-nombre','Nombre','autocomplete=\"off\"',c.nombre)+
    fld('cl-tel','Teléfono (opcional)','inputmode=\"tel\" autocomplete=\"off\"',c.telefono)+
    fld('cl-precio','Precio especial por canasta (opcional)','inputmode=\"numeric\" autocomplete=\"off\"',c.precio)+
    '<p class=\"hint\" style=\"margin:-6px 0 10px\">Si lo dejas vacío, se usa el precio normal del galpón.</p>'+
    fld('cl-notas','Notas (opcional)','autocomplete=\"off\"',c.notas)+
    '<p class=\"err\" id=\"err\" role=\"alert\"></p>'+
    '<div class=\"btnrow\"><button class=\"btn\" data-do=\"save\">Guardar</button>'+(ex?'<button class=\"btn warn\" data-do=\"del\">Eliminar</button>':'')+'</div>');
  act.save=function(){
    var nombre=val('cl-nombre').trim();
    if(!nombre)return err('Escribe el nombre del cliente.');
    if(db.clientes.some(function(x){return x.nombre.trim().toLowerCase()===nombre.toLowerCase()&&(!ex||x.id!==ex.id);}))return err('Ya hay un cliente con ese nombre.');
    var rec={id:ex?ex.id:uid(),nombre:nombre,telefono:val('cl-tel').trim(),precio:num(val('cl-precio'))||'',notas:val('cl-notas').trim()};
    if(ex)Object.assign(ex,rec); else db.clientes.push(rec);
    save();closeSheet();render();toast('Cliente guardado');
  };
  act.del=function(){
    confirmSheet('¿Quitar este cliente del directorio?','Sus pedidos siguen en Pedidos, pero se pierde el precio especial.','Quitar',function(){
      db.clientes=db.clientes.filter(function(x){return x.id!==ex.id;});save();render();toast('Cliente quitado');
    });
  };
  if(!ex)setTimeout(function(){var i=document.getElementById('cl-nombre');if(i)i.focus();},60);
}

function viewAjustes(){
  var c=db.config, tg=totalGallinas();
  var clientesAjustes='<h2 class="sec">Clientes</h2><div class="panel pad">'+
     '<div class="row" style="padding:0 0 10px;border:0"><span>Clientes registrados</span><b>'+nf(db.clientes.length)+'</b></div>'+
    '<p class="hint" style="margin:0 0 12px">Administra el directorio, los teléfonos y los precios especiales de tus clientes.</p>'+
    '<div class="btnrow"><button class="btn" data-act="clientes-ajustes">Ver clientes</button><button class="btn sec" data-act="cliente-nuevo-ajustes">Nuevo cliente</button></div></div>';
  var mov=db.gallinas.slice().sort(function(a,b){return b.fecha.localeCompare(a.fecha)||b.id.localeCompare(a.id);});
  var h='<h2 class=\"sec\">Galpón</h2><div class=\"panel pad\">'+
     fld('c-nombre','Nombre del galpón','autocomplete=\"off\"',c.nombre)+
    fld('c-pc','Huevos por canasta','inputmode=\"numeric\"',c.porCanasta)+
    fld('c-precio','Precio de una canasta (pesos)','inputmode=\"numeric\"',c.precio||'')+
    '<button class=\"btn wide\" style=\"margin-top:0\" data-act=\"cfg-save\">Guardar ajustes</button></div>';
  h+=clientesAjustes;

  h+='<h2 class=\"sec\">Apariencia</h2><div class=\"panel pad\">'+
    '<p class=\"lbl\">Tema</p>'+seg('s-tema',['Automático','Claro','Oscuro'],db.config.tema||'Automático')+
    '<p class=\"hint\" style=\"margin:0\">Automático sigue el tema que tenga puesto tu teléfono.</p></div>';

  h+='<h2 class=\"sec\">Gallinas</h2><div class=\"panel\"><p class=\"stockn\">'+nf(tg)+' <small>gallinas</small></p><div class=\"btnrow pad\"><button class=\"btn\" data-act=\"gal-in\">Entraron gallinas</button><button class=\"btn sec\" data-act=\"gal-out\">Salieron gallinas</button></div>';
  if(mov.length){
    h+='<div class=\"list\">'+mov.slice(0,8).map(function(m){
      var sub=m.tipo==='entrada'?'Entrada':((m.causa||'Salida')+(m.detalle?': '+esc(m.detalle):''));
      return '<button class=\"item\" data-act=\"gal-edit\" data-id=\"'+m.id+'\"><div><b>'+fmtFecha(m.fecha)+'</b><span class=\"sub\">'+sub+'</span></div>'+
        '<span class=\"'+(m.tipo==='entrada'?'mas':'menos')+'\">'+(m.tipo==='entrada'?'+':'−')+nf(m.cantidad)+'</span></button>';
    }).join('')+'</div>';
    if(mov.length>8)h+='<p class=\"cap\">Mostrando los 8 movimientos más recientes.</p>';
  }
  h+='</div>';

  var claveHoy=semanaKey(hoy()), mortHoy=(mortalidadPorSemana())[claveHoy]||0, morbHoy=morbilidadSemana(claveHoy);
  var sensLabel=db.config.percentilAlerta===60?'Alta':db.config.percentilAlerta===90?'Baja':'Media';
  h+='<h2 class=\"sec\">Salud del lote</h2><div class=\"panel pad\">'+
    '<div class=\"row\" style=\"padding:0 0 8px;border:0\"><span>Bajas por mortalidad esta semana</span><b>'+nf(mortHoy)+'</b></div>'+
    '<div class=\"row\" style=\"padding:8px 0;border-top:1px solid var(--line)\"><span>Gallinas enfermas reportadas esta semana</span><b>'+nf(morbHoy)+'</b></div>'+
    '<p class=\"lbl\" style=\"margin-top:14px\">Sensibilidad de la alerta</p>'+seg('s-sens',['Alta','Media','Baja'],sensLabel)+
    '<p class=\"hint\" style=\"margin:6px 0 0\">Alta avisa más seguido; Baja solo avisa cuando las bajas están muy por encima de lo normal para tu galpón.</p></div>';

  h+='<h2 class=\"sec\">Reporte</h2><div class=\"panel pad\"><p class=\"hint\">Genera un reporte con la producción, las ventas y los pedidos del periodo que elijas, listo para guardar o imprimir en PDF.</p>'+
    '<button class=\"btn wide\" style=\"margin-top:0\" data-act=\"reporte\">Generar reporte en PDF</button></div>';

  h+='<h2 class=\"sec\">Carpeta del teléfono</h2><div class=\"panel pad\"><p class=\"hint\">Autoriza una carpeta para guardar automáticamente reportes y copias de seguridad. Se creará dentro una carpeta llamada “Mi Galpon”.</p>'+
    '<button class=\"btn sec wide\" style=\"margin-top:0\" data-act=\"carpeta\">Elegir carpeta para guardar</button></div>';

  h+='<h2 class=\"sec\">Tus datos</h2><div class=\"panel pad\"><p class=\"hint\">Todo se guarda solo en este teléfono y funciona sin internet. Haz una copia de seguridad de vez en cuando.</p>'+
    '<div class=\"btnrow\"><button class=\"btn sec\" data-act=\"backup\">Copia de seguridad</button><button class=\"btn sec\" data-act=\"restore\">Restaurar copia</button></div>'+
    '<button class=\"btn sec wide\" data-act=\"importfile\" style=\"margin-top:10px\">Importar archivo JSON</button>'+
    '<button class=\"btn warn wide\" data-act=\"reset\">Borrar todos los datos</button></div>';
  return h;
}

function ajustesSeccionView(seccion){
  var c=db.config, tg=totalGallinas();
  var titles={business:'Datos principales',gastos:'Gastos',clientes:'Clientes',gallinas:'Gallinas',apariencia:'Apariencia',reporte:'Generar reporte',datos:'Copias de seguridad',sync:'Cuenta'};
  var h='<div class="settings-single-head"><button class="settings-back" data-act="settings-back" aria-label="Volver">‹</button><div><span class="settings-kicker">Ajustes</span><h2>'+titles[seccion]+'</h2></div></div>';
  if(seccion==='business'){
    h+='<div class="settings-card panel pad">'+
      fld('c-nombre','Nombre del galpón','autocomplete="off"',c.nombre)+
      fld('c-pc','Huevos por canasta','inputmode="numeric"',c.porCanasta)+
      fld('c-precio','Precio de una canasta (pesos)','inputmode="numeric"',c.precio||'')+
      fld('c-precio-unidad','Precio de un huevo suelto (pesos)','inputmode="numeric"',c.precioUnidad||'')+
      '<button class="btn wide" style="margin-top:0" data-act="cfg-save">Guardar ajustes</button></div>';
  }else if(seccion==='gastos'){
    var gastos=(db.gastos||[]).slice().sort(function(a,b){return b.fecha.localeCompare(a.fecha)||b.id.localeCompare(a.id);});
    var totalGastos=sum(gastos,function(g){return g.monto||0;});
    h+='<div class="settings-summary"><span>Total registrado</span><strong>'+money(totalGastos)+'</strong><small>'+gastos.length+' '+(gastos.length===1?'gasto':'gastos')+'</small></div>'+
      '<p class="hint">Los gastos se registran desde Acciones rápidas (+). Toca un movimiento para corregirlo.</p>'+
      '<h2 class="sec">Historial de gastos</h2>';
    h+=gastos.length?'<div class="history-list">'+gastos.map(function(g){
      return '<article class="history-card expense-card" role="button" tabindex="0" data-act="gasto-edit" data-id="'+g.id+'"><div class="history-top"><div class="history-date"><div class="date-box"><strong>'+new Date(g.fecha+'T12:00:00').getDate()+'</strong><small>'+new Date(g.fecha+'T12:00:00').toLocaleDateString('es-CO',{month:'short'}).replace('.','')+'</small></div><div><span class="history-title">'+esc(g.categoria||'Gasto general')+'</span><span class="history-sub">'+fmtFecha(g.fecha)+'</span></div></div><strong class="expense-amount">'+money(g.monto||0)+'</strong></div>'+(g.detalle?'<div class="history-footer"><span class="history-stat">'+esc(g.detalle)+'</span></div>':'')+'</article>';
    }).join('')+'</div>':empty('Aún no hay gastos','Registra el primer gasto del galpón para ver su historial.');
  }else if(seccion==='clientes'){
    h+='<div class="settings-card panel pad"><h3 class="settings-card-title">Directorio de clientes</h3><p class="hint">Administra teléfonos, precios especiales e historial de compras.</p><div class="btnrow"><button class="btn" data-act="clientes-ajustes">Ver clientes</button><button class="btn sec" data-act="cliente-nuevo-ajustes">Nuevo cliente</button></div></div>';
  }else if(seccion==='gallinas'){
    var mov=db.gallinas.slice().sort(function(a,b){return b.fecha.localeCompare(a.fecha)||b.id.localeCompare(a.id);});
    h+='<div class="settings-summary"><span>Gallinas actuales</span><strong>'+nf(tg)+'</strong><small>en el galpón</small></div><div class="settings-card panel pad"><div class="btnrow"><button class="btn" data-act="gal-in">Entraron gallinas</button><button class="btn sec" data-act="gal-out">Salieron gallinas</button></div></div><h2 class="sec">Movimientos recientes</h2>';
    h+=mov.length?'<div class="panel list">'+mov.map(function(m){return '<button class="item" data-act="gal-edit" data-id="'+m.id+'"><div><b>'+fmtFecha(m.fecha)+'</b><span class="sub">'+esc(m.tipo==='entrada'?'Entrada':(m.causa||'Salida'))+'</span></div><span class="'+(m.tipo==='entrada'?'mas':'menos')+'">'+(m.tipo==='entrada'?'+':'−')+nf(m.cantidad)+'</span></button>';}).join('')+'</div>':empty('Sin movimientos','Registra la entrada inicial de tus gallinas.');
  }else if(seccion==='apariencia'){
    h+='<div class="settings-card panel pad"><h3 class="settings-card-title">Tema de la aplicación</h3><p class="hint">Elige cómo quieres ver Mi Galpón.</p><p class="lbl">Tema</p>'+seg('s-tema',['Automático','Claro','Oscuro'],c.tema||'Automático')+'<p class="hint">El modo claro usa fondos blancos y el modo oscuro usa superficies oscuras.</p></div>';
  }else if(seccion==='reporte'){
    h+='<div class="settings-card panel pad"><h3 class="settings-card-title">Generar reporte</h3><p class="hint">Crea un PDF con la producción, ventas y pedidos del periodo que elijas.</p><button class="btn wide" data-act="reporte">Generar reporte en PDF</button></div>';
  }else if(seccion==='datos'){
    h+='<div class="settings-card panel pad"><h3 class="settings-card-title">Carpeta del teléfono</h3><p class="hint">Elige una ubicación para crear la carpeta “Mi Galpon” y guardar allí reportes y copias.</p><button class="btn sec wide" data-act="carpeta">Elegir carpeta para guardar</button></div><div class="settings-card panel pad"><h3 class="settings-card-title">Copia y restauración</h3><p class="hint">Guarda tus datos para recuperarlos en otro teléfono.</p><div class="btnrow"><button class="btn sec" data-act="backup">Copia de seguridad</button><button class="btn sec" data-act="restore">Restaurar copia</button></div><button class="btn sec wide" data-act="importfile">Importar archivo JSON</button></div><div class="settings-card panel pad danger-zone"><h3 class="settings-card-title">Zona de riesgo</h3><p class="hint">Esta acción elimina todos los datos guardados.</p><button class="btn warn wide" data-act="reset">Borrar todos los datos</button></div>';
  }else if(seccion==='sync'){
    var esDueno=syncState.role==='owner';
    var nombreCuenta=syncState.accountName||syncState.user||'';
    var dueno=esDueno?nombreCuenta:(syncState.ownerName||'No disponible');
    var vence=syncState.accessCodeExpiresAt?new Date(syncState.accessCodeExpiresAt):null;
    var codigoVigente=!!(syncState.accessCode&&vence&&vence.getTime()>Date.now());
    h+='<div class="settings-card panel pad"><h3 class="settings-card-title">Información de la cuenta</h3>'+
      '<div class="row" style="padding:0 0 10px;border:0"><span>Usuario</span><b>'+esc(nombreCuenta)+'</b></div>'+
      '<div class="row" style="padding:8px 0;border-top:1px solid var(--line)"><span>Correo</span><b>'+esc(syncState.user||'')+'</b></div>'+
      '<div class="row" style="padding:8px 0;border-top:1px solid var(--line)"><span>Rol</span><b>'+(syncState.role==='owner'?'Dueño':syncState.role==='worker'?'Trabajador':'Verificando…')+'</b></div>'+
      '<div class="row" style="padding:8px 0;border-top:1px solid var(--line)"><span>Dueño del galpón</span><b>'+esc(dueno)+'</b></div>'+
      (esDueno?'<div class="row" style="padding:8px 0;border-top:1px solid var(--line)"><span>Trabajadores vinculados</span><b>'+(syncState.workerCount==null?'No disponible':nf(syncState.workerCount))+'</b></div>':'')+
      '<div class="row" style="padding:8px 0;border-top:1px solid var(--line)"><span>Estado</span><b>'+esc(syncStatusText().label)+'</b></div>'+
      (esDueno?'<div class="panel pad" style="margin-top:14px;background:var(--verde-soft)"><strong>Código de acceso para trabajadores</strong>'+
        (codigoVigente?'<p style="font:700 30px var(--serif);letter-spacing:5px;margin:12px 0 4px">'+esc(syncState.accessCode)+'</p><p class="hint" style="margin:0 0 10px">Vence '+esc(vence.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}))+'; válido por 15 minutos. Generar otro invalida este.</p>':'<p class="hint" style="margin:6px 0 10px">Genera un código temporal y compártelo con el trabajador para vincularlo a este galpón.</p>')+
        '<button class="btn wide" data-act="sync-generate-code">'+(codigoVigente?'Generar otro código':'Generar código de acceso')+'</button></div>':'')+
      (syncState.error?'<p class="hint" style="color:var(--rojo);margin-bottom:0">'+esc(syncState.error)+'</p>':'')+
      '<button class="btn sec wide" style="margin-top:14px" data-act="sync-signout">Cerrar sesión</button></div>';
  }
  return h;
}

function ajustesMenuView(){
  var c=db.config;
  return '<div class="settings-drawer-head"><div class="settings-avatar">🐔</div><div><strong>'+esc(c.nombre)+'</strong><span>Ajustes del galpón</span></div></div>'+
    '<div class="settings-drawer-menu">'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="sync"><span class="settings-menu-icon">♙</span><strong>Cuenta</strong><span>›</span></button>'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="business"><span class="settings-menu-icon">▣</span><strong>Datos principales</strong><span>›</span></button>'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="gastos"><span class="settings-menu-icon">💸</span><strong>Gastos</strong><span>›</span></button>'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="clientes"><span class="settings-menu-icon">♙</span><strong>Clientes</strong><span>›</span></button>'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="gallinas"><span class="settings-menu-icon">🐔</span><strong>Gallinas</strong><span>›</span></button>'+
      '<div class="settings-menu-divider"></div>'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="reporte"><span class="settings-menu-icon">▤</span><strong>Generar reporte</strong><span>›</span></button>'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="apariencia"><span class="settings-menu-icon">◉</span><strong>Apariencia</strong><span>›</span></button>'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="datos"><span class="settings-menu-icon">▣</span><strong>Copias de seguridad</strong><span>›</span></button>'+
    '</div>';
}

function viewAjustesOrganizado(){
  if(ajustesSeccion)return ajustesSeccionView(ajustesSeccion);
  return ajustesMenuView();
  /*
  var c=db.config, tg=totalGallinas();
  var mov=db.gallinas.slice().sort(function(a,b){return b.fecha.localeCompare(a.fecha)||b.id.localeCompare(a.id);});
  var gastos=(db.gastos||[]).slice().sort(function(a,b){return b.fecha.localeCompare(a.fecha)||b.id.localeCompare(a.id);});
  var totalGastos=sum(gastos,function(g){return g.monto||0;});
  var h='<div class="settings-drawer-head"><div class="settings-avatar">🐔</div><div><strong>'+esc(c.nombre)+'</strong><span>Ajustes del galpón</span></div></div>'+
    '<div class="settings-drawer-menu">'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="settings-business"><span class="settings-menu-icon">▣</span><strong>Datos principales</strong><span>›</span></button>'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="settings-gastos"><span class="settings-menu-icon">💸</span><strong>Gastos</strong><span>›</span></button>'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="settings-clientes"><span class="settings-menu-icon">♙</span><strong>Clientes</strong><span>›</span></button>'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="settings-gallinas"><span class="settings-menu-icon">🐔</span><strong>Gallinas</strong><span>›</span></button>'+
      '<div class="settings-menu-divider"></div>'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="settings-apariencia"><span class="settings-menu-icon">◉</span><strong>Apariencia</strong><span>›</span></button>'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="settings-datos"><span class="settings-menu-icon">▣</span><strong>Copias de seguridad</strong><span>›</span></button>'+
    '</div>'+
    '<section class="settings-section" id="settings-business"><h2 class="settings-heading">Gestión de negocio</h2>'+ 
    '<div class="settings-card panel settings-config-card'+(configGalponAbierta?' is-open':'')+'"><button type="button" class="settings-collapse" data-act="toggle-config-galpon" aria-expanded="'+configGalponAbierta+'"><span><span class="settings-kicker">Datos principales</span><strong>Configuración del galpón</strong></span><span class="settings-chevron" aria-hidden="true">⌄</span></button><div class="settings-config-body pad">'+ 
    fld('c-nombre','Nombre del galpón','autocomplete="off"',c.nombre)+
    fld('c-pc','Huevos por canasta','inputmode="numeric"',c.porCanasta)+
    fld('c-precio','Precio de una canasta (pesos)','inputmode="numeric"',c.precio||'')+
    fld('c-precio-unidad','Precio de un huevo suelto (pesos)','inputmode="numeric"',c.precioUnidad||'')+
    '<button class="btn wide" style="margin-top:0" data-act="cfg-save">Guardar ajustes</button></div></div>'+
    '<div class="settings-card panel pad" id="settings-apariencia"><div class="theme-row"><div><h3 class="settings-card-title">Tema</h3><p class="hint">Automático sigue el tema del teléfono. Desactívalo para alternar manualmente.</p></div><label class="switch"><input type="checkbox" data-auto-theme '+(c.tema==='Automático'?'checked':'')+'><span class="switch-track"><span class="switch-thumb"></span></span></label></div><div class="theme-manual"><span>Tema oscuro manual</span><label class="switch"><input type="checkbox" data-theme-toggle '+(c.tema==='Oscuro'?'checked':'')+(c.tema==='Automático'?' disabled':'')+'><span class="switch-track"><span class="switch-thumb"></span></span></label></div></div>'+ 
    '<div class="settings-card panel pad" id="settings-clientes"><h3 class="settings-card-title">Clientes</h3>'+ 
    '<div class="row" style="padding:0 0 10px;border:0"><span>Clientes registrados</span><b>'+nf(db.clientes.length)+'</b></div>'+ 
    '<p class="hint" style="margin:0 0 12px">Administra el directorio, los teléfonos y los precios especiales de tus clientes.</p>'+ 
    '<div class="btnrow"><button class="btn" data-act="clientes-ajustes">Ver clientes</button><button class="btn sec" data-act="cliente-nuevo-ajustes">Nuevo cliente</button></div></div>'+
    '<div class="settings-card panel pad inventory-card" id="settings-gallinas"><h3 class="settings-card-title">Inventario de gallinas</h3><p class="stockn">'+nf(tg)+' <small>gallinas</small></p><div class="btnrow pad"><button class="btn" data-act="gal-in">Entraron gallinas</button><button class="btn sec" data-act="gal-out">Salieron gallinas</button></div>';
  if(mov.length){
    h+='<div class="list">'+mov.slice(0,8).map(function(m){
      var sub=m.tipo==='entrada'?esc(m.motivo||'Entrada'):((m.causa||'Salida')+(m.detalle?': '+esc(m.detalle):''));
      return '<button class="item" data-act="gal-edit" data-id="'+m.id+'"><div><b>'+fmtFecha(m.fecha)+'</b><span class="sub">'+sub+'</span></div><span class="'+(m.tipo==='entrada'?'mas':'menos')+'">'+(m.tipo==='entrada'?'+':'−')+nf(m.cantidad)+'</span></button>';
    }).join('')+'</div>';
    if(mov.length>8)h+='<p class="cap">Mostrando los 8 movimientos más recientes.</p>';
  }
  h+='</div>'+
    '<div class="settings-card panel settings-config-card'+(gastosAbierta?' is-open':'')+'" id="settings-gastos"><button type="button" class="settings-collapse" data-act="toggle-gastos" aria-expanded="'+gastosAbierta+'"><span><span class="settings-kicker">Control financiero</span><strong>Gastos</strong></span><span class="settings-chevron" aria-hidden="true">⌄</span></button><div class="settings-config-body pad">'+
    '<div class="owner-card-head"><div><span class="sub">Total registrado</span><b class="owner-period">'+gastos.length+' '+(gastos.length===1?'gasto':'gastos')+'</b></div><span class="owner-total">'+money(totalGastos)+'</span></div>'+
    '<p class="hint" style="margin:14px 0 12px">Registra en qué se usa el dinero del galpón y conserva el detalle de cada gasto.</p>'+
    fld('gasto-cat','Categoría','autocomplete="off" placeholder="Ej. alimento, transporte"','')+
    fld('gasto-monto','Monto','required inputmode="numeric" autocomplete="off"','')+
    fld('gasto-fecha','Fecha','type="date"',hoy())+
    fld('gasto-det','Detalle (opcional)','autocomplete="off"','')+
    '<button class="btn wide" style="margin-top:0" data-act="gasto-save">Registrar gasto</button>'+
    '<h3 class="settings-card-title" style="margin-top:20px">Historial de gastos</h3>'+
    (gastos.length?'<div class="history-list">'+gastos.map(function(g){
      return '<article class="history-card expense-card"><div class="history-top"><div class="history-date"><div class="date-box"><strong>'+new Date(g.fecha+'T12:00:00').getDate()+'</strong><small>'+new Date(g.fecha+'T12:00:00').toLocaleDateString('es-CO',{month:'short'}).replace('.','')+'</small></div><div><span class="history-title">'+esc(g.categoria||'Gasto general')+'</span><span class="history-sub">'+fmtFecha(g.fecha)+'</span></div></div><strong class="expense-amount">'+money(g.monto||0)+'</strong></div>'+(g.detalle?'<div class="history-footer"><span class="history-stat">'+esc(g.detalle)+'</span></div>':'')+'</article>';
    }).join('')+'</div>':empty('Aún no hay gastos','Registra el primer gasto del galpón para ver su historial.'))+
    '</div></div></section>';

  h+='<section class="settings-section" id="settings-datos"><h2 class="settings-heading">Datos y copias de seguridad</h2><div class="settings-card panel pad"><h3 class="settings-card-title">Carpeta del teléfono</h3><p class="hint">Elige una ubicación para crear la carpeta “Mi Galpon” y guardar allí reportes y copias.</p><button class="btn sec wide" data-act="carpeta">Elegir carpeta para guardar</button></div><div class="settings-card panel pad"><h3 class="settings-card-title">Copia y restauración</h3><p class="hint">Todo se guarda solo en este teléfono y funciona sin internet. Haz una copia de seguridad de vez en cuando.</p><div class="btnrow"><button class="btn sec" data-act="backup">Copia de seguridad</button><button class="btn sec" data-act="restore">Restaurar copia</button></div><button class="btn sec wide" data-act="importfile" style="margin-top:10px">Importar archivo JSON</button></div><div class="settings-card panel pad danger-zone"><h3 class="settings-card-title">Zona de riesgo</h3><p class="hint">Esta acción elimina todos los datos guardados en el teléfono.</p><button class="btn warn wide" data-act="reset">Borrar todos los datos</button></div></section>';
  return h;
  */
}

function render(){
  $('#nombre').textContent=db.config.nombre;
  actualizarEstadoSync();
  var fh=new Date().toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long'});
  $('#fechaHoy').textContent=fh.charAt(0).toUpperCase()+fh.slice(1);
  var view=$('#view'), y=view.scrollTop;
  if(syncState.provider==='firebase'&&(!syncState.user||!syncState.role)){
    document.body.classList.add('auth-required');
    view.innerHTML=syncState.user&&syncState.status==='error'?viewPerfilPendiente():viewAcceso();
    view.scrollTop=0;
    $('#fabSlot').innerHTML='';
    $('#nav').innerHTML='';
    return;
  }
  document.body.classList.remove('auth-required');
  document.body.classList.toggle('readonly-mode',syncState.role==='owner');
  document.body.classList.toggle('settings-active',tab==='ajustes');
  var views={inicio:viewInicio,huevos:viewHuevos,pedidos:viewPedidos,ventas:viewVentas,clientes:viewClientes,ajustes:viewAjustesOrganizado};
  var html=views[tab]();
  view.innerHTML=html;
  view.scrollTop=y;
  $('#fabSlot').innerHTML=syncState.role==='owner'?'':tab==='inicio'?'<div class="quick-bubble'+(quickOpen?' is-open':'')+'"><div class="quick-bubble-actions"><button data-act="quick-dia"><span>🥚</span>Registrar día</button><button data-act="quick-pedido"><span>📦</span>Nuevo pedido</button><button data-act="quick-gasto"><span>💸</span>Registrar gasto</button></div><button class="fab fab-plus" data-act="quick" aria-label="Acciones rápidas">'+(quickOpen?'×':'+')+'</button></div>':tab==='huevos'?'<button class=\"fab\" data-act=\"fab\">Registrar día</button>':tab==='pedidos'?'<button class=\"fab\" data-act=\"fab\">Nuevo pedido</button>':tab==='clientes'?'<button class=\"fab\" data-act=\"fab\">+ Nuevo cliente</button>':'';
  document.body.classList.toggle('no-fab-space',!['inicio','huevos','pedidos','clientes'].includes(tab));
  $('#nav').innerHTML=TABS.map(function(t){
    return '<button data-tab=\"'+t[0]+'\"'+(tab===t[0]?' aria-current=\"page\"':'')+'><span class=\"ic\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\">'+ICONS[t[0]]+'</svg></span>'+t[1]+'</button>';
  }).join('');
}

function viewPerfilPendiente(){
  return '<section class="auth-screen"><div class="auth-mark">🐔</div><span class="settings-kicker">Mi Galpón</span><h2>No se pudo validar la cuenta</h2><p class="hint">'+esc(syncState.error||'Comprueba tu conexión e inténtalo de nuevo.')+'</p>'+
    '<div class="auth-card panel pad"><p class="hint">Cuenta: <strong>'+esc(syncState.user)+'</strong></p>'+
    '<button class="btn wide" data-act="sync-retry-profile">Reintentar</button>'+
    '<button class="btn sec wide" data-act="sync-signout">Cambiar de cuenta</button></div></section>';
}

function viewAcceso(){
  var waiting=syncState.status==='booting'||syncState.status==='connecting';
  var registro=authMode==='signup';
  var title=waiting?'Conectando con Firebase':registro?'Crea tu cuenta':'Entra a Mi Galpón';
  var message=waiting?'Estamos comprobando tu sesión segura.':registro?'Crea tu cuenta para acceder al galpón compartido.':'Entra con tu correo y contraseña para abrir el galpón.';
  return '<section class="auth-screen"><div class="auth-mark">🐔</div><span class="settings-kicker">Mi Galpón</span><h2>'+title+'</h2><p class="hint">'+message+'</p>'+
    (waiting?'<div class="auth-loading"><span></span><span></span><span></span></div>':
    '<div class="auth-card panel pad">'+
      (registro?fld('auth-name','Cómo te llamas','autocomplete="name" placeholder="Tu nombre"','')+
      '<label class="lbl" for="auth-role">Tipo de cuenta</label><select id="auth-role"><option value="worker"'+(authRole==='worker'?' selected':'')+'>Trabajador</option><option value="owner"'+(authRole==='owner'?' selected':'')+'>Dueño</option></select>':'')+
      (registro&&authRole==='worker'?fld('auth-access-code','Código de acceso del dueño','inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="Código de 8 dígitos"',''):'')+
      fld('auth-email','Correo electrónico','type="email" autocomplete="email" placeholder="tu@correo.com"','')+
      fld('auth-password','Contraseña','type="password" autocomplete="new-password" placeholder="Mínimo 6 caracteres"','')+
      (registro?fld('auth-password-confirm','Repite la contraseña','type="password" autocomplete="new-password" placeholder="Repite tu contraseña"',''):'')+
      '<button class="btn wide" data-act="'+(registro?'sync-signup':'sync-signin')+'">'+(registro?'Crear cuenta':'Iniciar sesión')+'</button>'+
      '<button class="btn sec wide" data-act="'+(registro?'auth-login':'auth-signup')+'">'+(registro?'Ya tengo una cuenta':'Crear cuenta nueva')+'</button>'+
      '<p class="auth-note">'+(registro?(authRole==='worker'?'El código vincula tu cuenta al galpón; puedes usar tu propio correo, distinto al del dueño.':'Usa tu correo para proteger la cuenta y compartir el galpón.'):'Tu sesión se conservará en este teléfono aunque cierres o recargues la app.')+'</p>'+
      (syncState.error?'<p class="auth-error">'+esc(syncState.error)+'</p>':'')+
    '</div>')+
    '</section>';
}

var vistaAnterior='inicio';
function abrirVista(vista){
  history.pushState({ vista: 'abierta' }, '');
  vistaAnterior=tab;
  tab=vista;
  clienteBuscar='';
  ajustesSeccion=null;
  $('#view').scrollTop=0;
  render();
}
function abrirAjustesSeccion(seccion){
  history.pushState({ vista: 'abierta' }, '');
  ajustesSeccion=seccion;
  render();
}
window.manejarRetrocesoAndroid=function(){
  if(sheetOpen){
    closeSheet();
    return false;
  }
  if(tab!=='inicio'||ajustesSeccion){
    tab='inicio';
    ajustesSeccion=null;
    quickOpen=false;
    clienteBuscar='';
    render();
    return false;
  }
  return true;
};

/* ---------- Hoja inferior ---------- */
history.replaceState({galponBase:true},document.title);
history.pushState({galponApp:true},document.title);
var sheetOpen=false, sheetHistory=false, ignoreNextPopstate=false, act={};
function openSheet(title,body,extraClass){
  $('#sheetRoot').innerHTML='<div class=\"backdrop\" data-close></div><section class=\"sheet'+(extraClass?' '+extraClass:'')+'\" role=\"dialog\" aria-modal=\"true\" aria-label=\"'+esc(title)+'\"><header><h2>'+esc(title)+'</h2><button class=\"x\" type=\"button\" data-close aria-label=\"Cerrar\">&#10005;</button></header>'+body+'</section>';
  if(!sheetOpen){history.pushState({galponSheet:true},document.title);sheetHistory=true;}
  sheetOpen=true; act={};
}
function closeSheet(fromHistory){
  if(!sheetOpen)return;
  sheetOpen=false;$('#sheetRoot').innerHTML='';act={};
  if(!fromHistory&&sheetHistory){sheetHistory=false;ignoreNextPopstate=true;history.back();}
}
function err(m){var e=document.getElementById('err'); if(e)e.textContent=m;}
var tt;
function toast(m){var t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(tt);tt=setTimeout(function(){t.classList.remove('show');},2800);}
function confirmSheet(title,msg,okLabel,fn){
  openSheet(title,'<p>'+msg+'</p><div class=\"btnrow\"><button class=\"btn warn\" data-do=\"ok\">'+okLabel+'</button><button class=\"btn sec\" data-close>Cancelar</button></div>');
  act.ok=function(){closeSheet();fn();};
}

/* ---------- Formularios ---------- */
function openDia(id,fecha){
  var ex=id?db.dias.find(function(d){return d.id===id;}):null;
  var d=ex||{fecha:fecha||fechaLibre(),huevos:'',rotos:'',alimento:'',gallinas:totalGallinas()||'',enfermas:'',notas:''};
  openSheet(ex?'Editar recogida':'Registrar recogida',
    fld('f-fecha','Fecha','type=\"date\"',d.fecha)+
    fld('f-huevos','Huevos recogidos','inputmode=\"numeric\" autocomplete=\"off\"',d.huevos)+
    fld('f-rotos','Rotos o dañados (opcional)','inputmode=\"numeric\" autocomplete=\"off\"',d.rotos)+
    fld('f-alim','Alimento echado (kg)','inputmode=\"decimal\" autocomplete=\"off\"',d.alimento)+
    fld('f-gal','Gallinas ese día','inputmode=\"numeric\" autocomplete=\"off\"',d.gallinas)+
    fld('f-enf','Gallinas enfermas hoy (opcional)','inputmode=\"numeric\" autocomplete=\"off\"',d.enfermas)+
    fld('f-notas','Notas (opcional)','autocomplete=\"off\"',d.notas)+
    '<div class=\"prev\" id=\"prev\"></div><p class=\"err\" id=\"err\" role=\"alert\"></p>'+
    '<div class=\"btnrow\"><button class=\"btn\" data-do=\"save\">Guardar</button>'+(ex?'<button class=\"btn warn\" data-do=\"del\">Eliminar</button>':'')+'</div>');
  act.input=function(){
    var h=Math.round(num(val('f-huevos'))), r=Math.round(num(val('f-rotos'))), g=Math.round(num(val('f-gal')));
    $('#prev').innerHTML='<b>'+canastasTxt(Math.max(0,h-r))+'</b>'+(g>0?'<br>Postura: <b>'+pctTxt(h/g*100)+'</b>':'');
  };
  act.input();
  act.save=function(){
    var fecha=val('f-fecha'), hv=val('f-huevos').trim();
    if(!fecha)return err('Elige la fecha.');
    if(hv==='')return err('Escribe cuántos huevos recogiste.');
    var huevos=Math.round(num(hv)), rotos=Math.round(num(val('f-rotos'))), gal=Math.round(num(val('f-gal')));
    if(rotos>huevos)return err('Los rotos no pueden ser más que los huevos recogidos.');
    if(db.dias.some(function(x){return x.fecha===fecha&&(!ex||x.id!==ex.id);}))return err('Ya hay una recogida en esa fecha. Ábrela desde la lista para editarla.');
    var rec={id:ex?ex.id:uid(),fecha:fecha,huevos:huevos,rotos:rotos,alimento:num(val('f-alim')),gallinas:gal,enfermas:Math.round(num(val('f-enf')))||0,notas:val('f-notas').trim()};
    if(ex)Object.assign(ex,rec); else db.dias.push(rec);
    save();closeSheet();render();toast('Recogida guardada');
  };
  act.del=function(){
    confirmSheet('¿Eliminar esta recogida?','Se quitan los huevos y el alimento de ese día.','Eliminar',function(){
      db.dias=db.dias.filter(function(x){return x.id!==ex.id;});save();render();toast('Recogida eliminada');
    });
  };
  if(!ex)setTimeout(function(){var i=document.getElementById('f-huevos');if(i)i.focus();},60);
}

function openPedido(id,clienteNombre){
  var ex=id?db.pedidos.find(function(p){return p.id===id;}):null;
  var precioIni=db.config.precio||'';
  if(!ex&&clienteNombre){
    var cliPre=db.clientes.find(function(x){return x.nombre.trim().toLowerCase()===clienteNombre.trim().toLowerCase();});
    if(cliPre&&cliPre.precio)precioIni=cliPre.precio;
  }
  var p=ex||{cliente:clienteNombre||'',canastas:'',sueltos:'',precio:precioIni,fecha:hoy(),pago:'Pendiente',entrega:'Encargo',fechaEntrega:'',notas:''};
  var pc=ex?pcDe(ex):pcBase();
  var uni=ex?unidadDe(ex):{u:'Canasta',n:''};
  var eggs0=ex?huevosPedido(ex):pc;
  var precioBase=ex?num(p.precio):(uni.u==='Unidad'?num(db.config.precioUnidad):num(db.config.precio));
  openSheet(ex?'Editar pedido':'Nuevo pedido',
    '<label class=\"f\"><span>Cliente *</span><input id=\"p-cli\" required autocomplete=\"off\" value=\"'+esc(p.cliente)+'\"></label>'+ 
    '<label class=\"f\"><span>Vendido por</span><select id=\"p-uni\">'+
      [['Canasta','Canasta ('+pc+' huevos)'],['Media','Media canasta ('+Math.round(pc/2)+' huevos)'],['Unidad','Unidad (huevo suelto)']].map(function(o){
        return '<option value=\"'+o[0]+'\"'+(o[0]===uni.u?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select></label>'+
    fld('p-cant','Cantidad de huevos','inputmode=\"numeric\" autocomplete=\"off\"',eggs0)+
    fld('p-pre','Precio según la unidad','inputmode=\"numeric\" autocomplete=\"off\"',precioBase)+
    fld('p-fec','Fecha del pedido','type=\"date\"',p.fecha)+
    '<p class=\"lbl\">Pago</p>'+seg('s-pago',['Pendiente','Pagado'],p.pago)+
    '<p class=\"lbl\">Entrega</p>'+seg('s-ent',['Encargo','Entregado'],p.entrega)+
    fld('p-fent','Entregar el (opcional)','type=\"date\"',p.fechaEntrega)+
    fld('p-notas','Notas (opcional)','autocomplete=\"off\"',p.notas)+
    '<div class=\"prev\" id=\"prev\"></div><p class=\"err\" id=\"err\" role=\"alert\"></p>'+
    '<div class=\"btnrow\"><button class=\"btn\" data-do=\"save\">Guardar</button>'+(ex?'<button class=\"btn warn\" data-do=\"del\">Eliminar</button>':'')+'</div>');
  function calc(){
    var u=val('p-uni'), eggs=Math.max(0,Math.round(num(val('p-cant')))), pr=num(val('p-pre'));
    return {u:u,n:Math.round((u==='Canasta'?eggs/pc:(u==='Media'?eggs/(pc/2):eggs))*100)/100,pr:pr,eggs:eggs,c:Math.floor(eggs/pc),s:eggs%pc,total:Math.round(u==='Unidad'?eggs*pr:eggs*pr/pc)};
  }
  act.input=function(){
    var k=calc(), st=stock(ex&&ex.id);
    var h='<b>'+money(k.total)+'</b> por '+nf(k.eggs)+' huevos ('+canastasTxt(k.eggs,pc)+')';
    if(segVal('s-ent')==='Entregado'&&k.eggs>st.libres)h+='<br><span class=\"warnt\">En el galpón hay '+nf(Math.max(0,st.libres))+' huevos libres, menos de los que vas a entregar.</span>';
    $('#prev').innerHTML=h;
  };
  act.input();
  document.getElementById('p-cli').addEventListener('input',function(){
    if(ex)return;
    var nom=this.value.trim().toLowerCase(), cli=db.clientes.find(function(x){return x.nombre.trim().toLowerCase()===nom;});
    var campoPrecio=document.getElementById('p-pre');
    if(cli&&cli.precio&&campoPrecio&&Number(num(campoPrecio.value))===Number(db.config.precio||0)){
      campoPrecio.value=cli.precio; act.input();
    }
  });
  document.getElementById('p-uni').addEventListener('change',function(){
    var u=this.value, c=document.getElementById('p-cant');
    c.value=u==='Canasta'?pc:(u==='Media'?Math.round(pc/2):'');
    document.getElementById('p-pre').value=u==='Unidad'?(db.config.precioUnidad||0):(db.config.precio||0);
    act.input();
    if(u==='Unidad')c.focus();
  });
  act.save=function(){
    var k=calc();
    if(k.eggs<=0)return err('Escribe la cantidad que lleva el pedido.');
    if(!val('p-cli').trim())return err('Escribe el nombre del cliente.');
    var rec={id:ex?ex.id:uid(),cliente:val('p-cli').trim(),canastas:k.c,sueltos:k.s,unidad:k.u,cantidad:k.n,precio:k.pr,pc:pc,total:k.total,fecha:val('p-fec')||hoy(),
      pago:segVal('s-pago'),entrega:segVal('s-ent'),fechaEntrega:val('p-fent'),notas:val('p-notas').trim()};
    if(ex)Object.assign(ex,rec); else db.pedidos.push(rec);
    save();closeSheet();render();toast('Pedido guardado');
  };
  act.del=function(){
    confirmSheet('¿Eliminar este pedido?','Se quita del listado y de las cuentas.','Eliminar',function(){
      db.pedidos=db.pedidos.filter(function(x){return x.id!==ex.id;});save();render();toast('Pedido eliminado');
    });
  };
}

function openGasto(id){
  var ex=id?db.gastos.find(function(g){return g.id===id;}):null;
  var g=ex||{categoria:'',monto:'',fecha:hoy(),detalle:''};
  openSheet(ex?'Editar gasto':'Registrar gasto',
    fld('gasto-cat','Categoría','required autocomplete="off" placeholder="Ej. alimento, transporte"',g.categoria)+
    fld('gasto-monto','Monto','required inputmode="numeric" autocomplete="off"',g.monto)+
    fld('gasto-fecha','Fecha','required type="date"',g.fecha)+
    fld('gasto-det','Detalle (opcional)','autocomplete="off"',g.detalle)+
    '<p class="err" id="err" role="alert"></p><div class="btnrow"><button class="btn wide" data-do="save">Guardar cambios</button>'+(ex?'<button class="btn warn" data-do="del">Eliminar</button>':'')+'</div>',
    'expense-sheet');
  act.save=function(){
    var monto=Math.round(num(val('gasto-monto')));
    if(monto<=0)return err('Escribe un monto válido.');
    if(!val('gasto-cat').trim())return err('Escribe una categoría.');
    if(!Array.isArray(db.gastos))db.gastos=[];
    var rec={id:ex?ex.id:uid(),categoria:val('gasto-cat').trim(),monto:monto,fecha:val('gasto-fecha')||hoy(),detalle:val('gasto-det').trim()};
    if(ex)Object.assign(ex,rec); else db.gastos.push(rec);
    save();closeSheet();render();toast('Gasto registrado');
  };
  act.del=function(){
    confirmSheet('¿Eliminar este gasto?','Se quitará del historial y del cálculo de ventas.','Eliminar',function(){
      db.gastos=db.gastos.filter(function(x){return x.id!==ex.id;});save();closeSheet();render();toast('Gasto eliminado');
    });
  };
}

function openQuickActions(){
  openSheet('Acciones rápidas',
    '<p class="hint">Elige qué quieres registrar.</p>'+
    '<button class="quick-action" data-do="quick-dia"><span class="quick-action-icon">🥚</span><span><b>Registrar día</b><small>Huevos y producción de hoy</small></span><strong>›</strong></button>'+
    '<button class="quick-action" data-do="quick-pedido"><span class="quick-action-icon">📦</span><span><b>Nuevo pedido</b><small>Cliente, cantidad y entrega</small></span><strong>›</strong></button>'+
    '<button class="quick-action" data-do="quick-gasto"><span class="quick-action-icon">💸</span><span><b>Registrar gasto</b><small>Alimento, transporte y otros</small></span><strong>›</strong></button>');
  act['quick-dia']=function(){closeSheet();setTimeout(function(){openDia(null);},80);};
  act['quick-pedido']=function(){closeSheet();setTimeout(function(){openPedido(null);},80);};
  act['quick-gasto']=function(){closeSheet();setTimeout(function(){openGasto();},80);};
}

function openGal(tipo,id){
  var ex=id?db.gallinas.find(function(m){return m.id===id;}):null;
  if(ex)tipo=ex.tipo;
  var esIn=tipo==='entrada';
  var m=ex||{fecha:hoy(),cantidad:'',detalle:''};
  var causaActual=ex&&!esIn?(ex.causa||(['Mortalidad','Venta','Descarte'].indexOf(ex.motivo)>=0?ex.motivo:'Mortalidad')):'Mortalidad';
  var signed=function(x){return x.tipo==='entrada'?x.cantidad:-x.cantidad;};
  var body=fld('g-fec','Fecha','type=\"date\"',m.fecha)+fld('g-can','Cantidad de gallinas','inputmode=\"numeric\" autocomplete=\"off\"',m.cantidad);
  if(!esIn){
    body+='<p class=\"lbl\">Causa</p>'+seg('s-causa',['Mortalidad','Venta','Descarte'],causaActual)+
      fld('g-det','Detalle (opcional)','autocomplete=\"off\"',ex?(ex.detalle||''):'')+
      '<p class=\"hint\" style=\"margin:0 0 10px\">Marca "Mortalidad" para que estas bajas cuenten en la alerta de mortalidad.</p>';
  }
  body+='<p class=\"err\" id=\"err\" role=\"alert\"></p><div class=\"btnrow\"><button class=\"btn\" data-do=\"save\">Guardar</button>'+(ex?'<button class=\"btn warn\" data-do=\"del\">Eliminar</button>':'')+'</div>';
  openSheet(ex?'Editar movimiento':(esIn?'Entraron gallinas':'Salieron gallinas'),body);
  act.save=function(){
    var c=Math.round(num(val('g-can')));
    if(c<=0)return err('Escribe cuántas gallinas son.');
    var rec=esIn?{id:ex?ex.id:uid(),tipo:'entrada',fecha:val('g-fec')||hoy(),cantidad:c}:
      {id:ex?ex.id:uid(),tipo:'baja',fecha:val('g-fec')||hoy(),cantidad:c,causa:segVal('s-causa'),detalle:val('g-det').trim()};
    var nuevo=totalGallinas()-(ex?signed(ex):0)+signed(rec);
    if(nuevo<0)return err('No pueden salir más gallinas de las que hay.');
    if(ex)Object.assign(ex,rec); else db.gallinas.push(rec);
    save();closeSheet();render();toast('Movimiento guardado');
  };
  act.del=function(){
    if(totalGallinas()-signed(ex)<0)return err('Si quitas esta entrada, el total de gallinas quedaría en negativo.');
    confirmSheet('¿Eliminar este movimiento?','El total de gallinas se recalcula.','Eliminar',function(){
      db.gallinas=db.gallinas.filter(function(x){return x.id!==ex.id;});save();render();toast('Movimiento eliminado');
    });
  };
  if(!ex)setTimeout(function(){var i=document.getElementById('g-can');if(i)i.focus();},60);
}

function openBackup(){
  var txt=JSON.stringify(db);
  openSheet('Copia de seguridad',
    '<p class=\"hint\">Guarda este texto en un lugar seguro (una nota, un correo o un chat). Con él recuperas todo si cambias de celular o reinstalas la app.</p>'+
    '<textarea id=\"b-txt\" readonly>'+esc(txt)+'</textarea><div class=\"btnrow\" style=\"margin-top:12px\"><button class=\"btn\" data-do=\"copy\">Copiar texto</button><button class=\"btn sec\" data-do=\"down\">Descargar archivo</button></div>');
  act.copy=function(){
    var ta=document.getElementById('b-txt');
    var ok=function(){toast('Copia lista. Pégala en un lugar seguro.');};
    var fallback=function(){ta.focus();ta.select();try{document.execCommand('copy');ok();}catch(e){toast('Mantén presionado el texto para copiarlo.');}};
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(ok,fallback);}else fallback();
  };
  act.down=function(){
    var nombre='galpon-copia-'+hoy()+'.json', blob=new Blob([txt],{type:'application/json'});
    guardarEnCarpeta(nombre,blob).then(function(guardado){
      if(guardado){toast('Copia guardada en Mi Galpon.');return;}
      try{
        var a=document.createElement('a');
        a.href=URL.createObjectURL(blob);a.download=nombre;
        document.body.appendChild(a);a.click();a.remove();
        toast('Copia descargada. Revisa la carpeta de descargas.');
      }catch(e){toast('No se pudo descargar. Usa Copiar texto.');}
    });
  };
}

function openRestore(){
  openSheet('Restaurar copia',
    '<p class=\"hint\">Puedes pegar el texto de tu copia o seleccionar un archivo .json. Esto reemplaza todo lo que tienes ahora.</p>'+
    '<textarea id=\"r-txt\" placeholder=\"Pega la copia aquí\"></textarea>'+ 
    '<label class=\"f\"><span>O selecciona un archivo JSON</span><input id=\"r-file\" type=\"file\" accept=\".json,application/json\"></label><p class=\"err\" id=\"err\" role=\"alert\"></p>'+ 
    '<button class=\"btn wide\" data-do=\"go\" style=\"margin-top:0\">Restaurar y reemplazar datos</button>');
  act.go=function(){
    var file=document.getElementById('r-file').files && document.getElementById('r-file').files[0];
    function restaurarTexto(texto){
      try{
        var o=JSON.parse(texto);
        if(!Array.isArray(o.dias)||!Array.isArray(o.pedidos)||!Array.isArray(o.gallinas))throw new Error('x');
        var d=defaults();
        db={config:Object.assign(d.config,o.config||{}),gallinas:o.gallinas,dias:o.dias,pedidos:o.pedidos,clientes:o.clientes||[],gastos:o.gastos||[]};
        save();closeSheet();render();toast('Copia restaurada');
      }catch(e){err('La copia no es válida. Revisa el texto o selecciona otro archivo JSON.');}
    }
    if(file){
      var reader=new FileReader();
      reader.onload=function(){restaurarTexto(reader.result);};
      reader.onerror=function(){err('No se pudo leer el archivo JSON.');};
      reader.readAsText(file);
      return;
    }
    var texto=val('r-txt').trim();
    if(!texto){err('Pega una copia o selecciona un archivo JSON.');return;}
    restaurarTexto(texto);
  };
}

function openImportFile(){
  openSheet('Importar copia JSON',
    '<p class=\"hint\">Selecciona un archivo .json guardado previamente en tu teléfono.</p>'+
    '<input id=\"import-file\" type=\"file\" accept=\"application/json\" /><p class=\"err\" id=\"err\" role=\"alert\"></p>'+
    '<button class=\"btn wide\" data-do=\"go\" style=\"margin-top:10px\">Importar archivo</button>');
  act.go=function(){
    var file=document.getElementById('import-file').files && document.getElementById('import-file').files[0];
    if(!file){err('Primero selecciona un archivo JSON.');return;}
    var reader=new FileReader();
    reader.onload=function(){
      try{
        var o=JSON.parse(reader.result);
        if(!Array.isArray(o.dias)||!Array.isArray(o.pedidos)||!Array.isArray(o.gallinas))throw new Error('x');
        var d=defaults();
        db={config:Object.assign(d.config,o.config||{}),gallinas:o.gallinas,dias:o.dias,pedidos:o.pedidos,clientes:o.clientes||[],gastos:o.gastos||[]};
        save();closeSheet();render();toast('Archivo importado');
      }catch(e){err('El archivo no es una copia válida.');}
    };
    reader.readAsText(file);
  };
}


/* ---------- Reporte ---------- */
function periodoDesdeReporte(valor) {
  switch (valor) {
    case 'Hoy':
      return hoy();
    case '7 días':
      return haceDias(6);
    case '30 días':
      return haceDias(29);
    default:
      return '0000-00-00';
  }
}

function datosReporte(desdeFecha, etiquetaPeriodo) {
  var dias = db.dias
    .filter(function(d) { return d.fecha >= desdeFecha; })
    .sort(function(a, b) { return a.fecha.localeCompare(b.fecha); });

  var recogidos = sum(dias, function(d) { return d.huevos || 0; });
  var rotos = sum(dias, function(d) { return d.rotos || 0; });
  var alimento = sum(dias, function(d) { return d.alimento || 0; });

  var diasConGallinas = dias.filter(function(d) { return d.gallinas > 0; });
  var posturaPromedio = diasConGallinas.length
    ? (sum(diasConGallinas, function(d) { return d.huevos / d.gallinas; }) / diasConGallinas.length) * 100
    : null;

  var ventas = ventasResumen(desdeFecha);
  var pedidos = ventas.ps.slice().sort(function(a, b) {
    return a.fecha.localeCompare(b.fecha);
  });

  return {
    nombre: db.config.nombre,
    periodo: etiquetaPeriodo,
    fechaGenerado: new Date().toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }),
    gallinas: totalGallinas(),
    dias: dias,
    recogidos: recogidos,
    rotos: rotos,
    posturaPromedio: posturaPromedio,
    alimento: alimento,
    ventas: ventas,
    pedidos: pedidos
  };
}

function tablaReporte(encabezados, filas) {
  var head = '<thead><tr>' +
    encabezados.map(function(h) { return '<th>' + esc(h) + '</th>'; }).join('') +
    '</tr></thead>';

  var body = filas.length
    ? '<tbody>' + filas.map(function(fila) {
        return '<tr>' + fila.map(function(celda) {
          return '<td>' + esc(celda) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody>'
    : '<tbody><tr><td colspan="' + encabezados.length + '">Sin datos</td></tr></tbody>';

  return '<table>' + head + body + '</table>';
}

function htmlReporte(data) {
  var h = '<h1>' + esc(data.nombre) + '</h1>';
  h += '<p class="sub">Reporte del periodo: ' + esc(data.periodo) + ' · Generado el ' + esc(data.fechaGenerado) + '</p>';

  h += '<h2>Resumen</h2>';
  h += tablaReporte(['Concepto', 'Valor'], [
    ['Gallinas en el galpón', nf(data.gallinas)],
    ['Huevos recogidos', nf(data.recogidos) + (data.rotos ? ' (' + nf(data.rotos) + ' rotos)' : '')],
    ['Postura promedio', data.posturaPromedio == null ? '–' : pctTxt(data.posturaPromedio)],
    ['Alimento echado', nf1(data.alimento) + ' kg'],
    ['Vendido', money(data.ventas.total)],
    ['Cobrado', money(data.ventas.cobrado)],
    ['Falta por cobrar', money(data.ventas.pend)]
  ]);

  h += '<h2>Huevos vendidos por tipo</h2>';
  h += tablaReporte(['Tipo', 'Cantidad', 'Huevos'], [
    ['Canastas', nf1(data.ventas.grp.Canasta.n), nf(data.ventas.grp.Canasta.h)],
    ['Medias canastas', nf1(data.ventas.grp.Media.n), nf(data.ventas.grp.Media.h)],
    ['Huevos sueltos', nf(data.ventas.grp.Unidad.n), nf(data.ventas.grp.Unidad.h)]
  ]);

  h += '<h2>Recogidas de huevos</h2>';
  if (data.dias.length) {
    h += tablaReporte(['Fecha', 'Huevos', 'Rotos', 'Postura', 'Alimento'], data.dias.map(function(d) {
      var p = posturaDia(d);
      return [
        fmtFecha(d.fecha),
        nf(d.huevos),
        nf(d.rotos || 0),
        p == null ? '–' : pctTxt(p),
        d.alimento ? nf1(d.alimento) + ' kg' : '–'
      ];
    }));
  } else {
    h += '<p class="sub">Sin recogidas en este periodo.</p>';
  }

  h += '<h2>Pedidos</h2>';
  if (data.pedidos.length) {
    h += tablaReporte(['Fecha', 'Cliente', 'Cantidad', 'Total', 'Pago', 'Entrega'], data.pedidos.map(function(p) {
      return [
        fmtFecha(p.fecha),
        esc(p.cliente) || 'Sin nombre',
        esc(pedidoTxt(p)),
        money(p.total || 0),
        p.pago,
        p.entrega
      ];
    }));
  } else {
    h += '<p class="sub">Sin pedidos en este periodo.</p>';
  }

  return h;
}

function pdfAscii(text){
  return String(text==null?'':text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,'');
}
function pdfEscape(text){
  return pdfAscii(text).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
}
function pdfLines(data){
  var lines=[
    data.nombre,
    'Reporte del periodo: '+data.periodo,
    'Generado el: '+data.fechaGenerado,
    '',
    'RESUMEN',
    'Gallinas en el galpon: '+nf(data.gallinas),
    'Huevos recogidos: '+nf(data.recogidos),
    'Huevos rotos: '+nf(data.rotos),
    'Postura promedio: '+(data.posturaPromedio==null?'Sin dato':pctTxt(data.posturaPromedio)),
    'Alimento echado: '+nf1(data.alimento)+' kg',
    'Vendido: '+money(data.ventas.total),
    'Cobrado: '+money(data.ventas.cobrado),
    'Falta por cobrar: '+money(data.ventas.pend),
    '',
    'RECOGIDAS DE HUEVOS'
  ];
  data.dias.forEach(function(d){
    lines.push(fmtFecha(d.fecha)+' | huevos: '+nf(d.huevos)+' | rotos: '+nf(d.rotos||0)+' | postura: '+(posturaDia(d)==null?'Sin dato':pctTxt(posturaDia(d))));
  });
  lines.push('', 'PEDIDOS');
  data.pedidos.forEach(function(p){
    lines.push(fmtFecha(p.fecha)+' | '+(p.cliente||'Sin nombre')+' | '+pedidoTxt(p)+' | '+money(p.total||0)+' | '+(p.pago||'')+' | '+(p.entrega||''));
  });
  return lines.reduce(function(out,line){
    var clean=pdfAscii(line);
    while(clean.length>92){out.push(clean.slice(0,92));clean=clean.slice(92);}
    out.push(clean);
    return out;
  },[]);
}
function crearPdf(data){
  var lines=pdfLines(data), pages=[];
  for(var i=0;i<lines.length;i+=48)pages.push(lines.slice(i,i+48));
  var objects=[null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids ['+pages.map(function(_,i){return (5+i*2)+' 0 R';}).join(' ')+' ] /Count '+pages.length+' >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  pages.forEach(function(page,i){
    var content='BT /F1 10 Tf 40 800 Td '+page.map(function(line,index){return '('+pdfEscape(line)+') Tj'+(index<page.length-1?' 0 -15 Td':'');}).join(' ')+' ET';
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents '+(6+i*2)+' 0 R >>');
    objects.push('<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream');
  });
  var pdf='%PDF-1.4\n', offsets=[0];
  objects.slice(1).forEach(function(obj,index){offsets.push(pdf.length);pdf+=(index+1)+' 0 obj\n'+obj+'\nendobj\n';});
  var xref=pdf.length;
  pdf+='xref\n0 '+objects.length+'\n0000000000 65535 f \n';
  for(var j=1;j<objects.length;j++)pdf+=String(offsets[j]).padStart(10,'0')+' 00000 n \n';
  pdf+='trailer\n<< /Size '+objects.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
  return new Blob([pdf],{type:'application/pdf'});
}
function guardarPdfEnTelefono(data){
  var file=new File([crearPdf(data)],'reporte-'+hoy()+'.pdf',{type:'application/pdf'});
  guardarEnCarpeta(file.name,file).then(function(guardado){
    if(guardado){toast('Reporte PDF guardado en Mi Galpon.');return;}
    if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
      navigator.share({title:'Reporte del galpon',text:'Reporte generado desde Mi Galpon',files:[file]}).catch(function(){});
      return;
    }
    var url=URL.createObjectURL(file), a=document.createElement('a');
    a.href=url;a.download=file.name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},1000);
    toast('PDF descargado. Revisa la carpeta de descargas.');
  });
}

function openReporte() {
  openSheet(
    'Generar reporte',
    '<p class="lbl">Periodo del reporte</p>' +
    seg('r-per', ['Hoy', '7 días', '30 días', 'Todo'], '30 días') +
    '<p class="hint">En el teléfono puedes guardarlo directamente o compartirlo con la aplicación de archivos.</p>' +
    '<div class="btnrow"><button class="btn wide" data-do="download">Guardar PDF en el teléfono</button><button class="btn sec wide" data-do="go">Imprimir / Guardar como PDF</button></div>'
  );

  act.download = function() {
    var per=segVal('r-per'), data=datosReporte(periodoDesdeReporte(per),per);
    closeSheet();
    guardarPdfEnTelefono(data);
  };
  act.go = function() {
    var per = segVal('r-per');
    var desde = periodoDesdeReporte(per);
    var data = datosReporte(desde, per);
    $('#reporte').innerHTML = htmlReporte(data);
    var tituloAnterior=document.title;
    document.title='reporte-'+hoy()+'.pdf';
    closeSheet();
    setTimeout(function() {
      window.addEventListener('afterprint',function restaurarTitulo(){
        document.title=tituloAnterior;
        $('#reporte').innerHTML='';
        window.removeEventListener('afterprint',restaurarTitulo);
      });
      window.print();
    }, 150);
  };
}

/* ---------- Eventos ---------- */
document.addEventListener('click',function(e){
  var nav=e.target.closest('#nav button');
  if(nav){abrirVista(nav.dataset.tab);return;}

  var ts=e.target.closest('#s-tema button');
  if(ts){
    Array.prototype.forEach.call(ts.parentNode.children,function(b){b.classList.toggle('on',b===ts);b.setAttribute('aria-checked',b===ts);});
    db.config.tema=ts.dataset.v;save();aplicarTema();return;
  }
  var ss=e.target.closest('#s-sens button');
  if(ss){
    Array.prototype.forEach.call(ss.parentNode.children,function(b){b.classList.toggle('on',b===ss);b.setAttribute('aria-checked',b===ss);});
    var mapa={Alta:60,Media:75,Baja:90};
    db.config.percentilAlerta=mapa[ss.dataset.v]||75;save();return;
  }

  var t=e.target.closest('#view [data-act], #fabSlot [data-act]');
  if(!t)return;
  var a=t.dataset.act, id=t.dataset.id, p;
  if(syncState.role==='owner'&&['sync-signout','sync-generate-code','settings-jump','settings-back','periodo','periodo-pagos','filtro','toggle-config-galpon','toggle-gastos'].indexOf(a)<0){
    toast('Esta cuenta es de solo consulta. El trabajador registra la información.');
    return;
  }
  switch(a){
    case 'hoy':{var ex=db.dias.find(function(d){return d.fecha===hoy();});openDia(ex?ex.id:null,hoy());break;}
    case 'dia-view':fichaDia(id);break;
    case 'pedido-view':fichaPedido(id);break;
    case 'gal-in':openGal('entrada');break;
    case 'gal-out':openGal('baja');break;
    case 'gal-edit':openGal(null,id);break;
    case 'cli-new':openClienteForm(null,null);break;
    case 'cli-open':fichaCliente(id);break;
    case 'cli-add':openClienteForm(null,t.dataset.nom);break;
    case 'clientes-ajustes':abrirVista('clientes');break;
    case 'clientes-atras':history.back();break;
    case 'cliente-nuevo-ajustes':openClienteForm(null,null);break;
    case 'fab':if(tab==='huevos')openDia(null);else if(tab==='pedidos')openPedido(null);else if(tab==='clientes')openClienteForm(null,null);break;
    case 'quick':quickOpen=!quickOpen;render();break;
    case 'quick-dia':quickOpen=false;render();setTimeout(function(){openDia(null);},80);break;
    case 'quick-pedido':quickOpen=false;render();setTimeout(function(){openPedido(null);},80);break;
    case 'quick-gasto':quickOpen=false;render();setTimeout(function(){openGasto();},80);break;
    case 'gasto-edit':openGasto(id);break;
    case 'periodo':{
      var siguiente=t.dataset.v;
      if(tab==='inicio')periodoInicio=periodoInicio===siguiente?'todo':siguiente;
      else if(tab==='huevos')periodoHuevos=periodoHuevos===siguiente?'todo':siguiente;
      else if(tab==='pedidos')periodoPedidos=periodoPedidos===siguiente?'todo':siguiente;
      else if(tab==='ventas')periodoVentas=periodoVentas===siguiente?'todo':siguiente;
      render();
      break;
    }
    case 'periodo-pagos':periodoPagos=t.dataset.v;render();break;
    case 'toggle-config-galpon':configGalponAbierta=!configGalponAbierta;render();break;
    case 'toggle-gastos':gastosAbierta=!gastosAbierta;render();break;
    case 'settings-jump':
      if(t.dataset.target==='clientes'){abrirVista('clientes');}
      else {abrirAjustesSeccion(t.dataset.target);}
      break;
    case 'settings-back':history.back();break;
    case 'sync-signin':{
      var email=val('auth-email').trim(), password=val('auth-password');
      if(!email||!password){toast('Escribe correo y contraseña.');break;}
      window.MiGalponSync.signIn(email,password).catch(function(error){
        console.error('No se pudo iniciar sesión:',error);
        syncState=Object.assign({},syncState,{error:authErrorMessage(error)});
        render();
      });
      break;
    }
    case 'sync-signup':{
      var newName=val('auth-name').trim(), newEmail=val('auth-email').trim(), newPassword=val('auth-password'), confirmPassword=val('auth-password-confirm');
      if(!newName||!newEmail||!newPassword||!confirmPassword){toast('Completa todos los campos.');break;}
      if(newPassword.length<6){toast('La contraseña debe tener al menos 6 caracteres.');break;}
      if(newPassword!==confirmPassword){toast('Las contraseñas no coinciden.');break;}
      var roleEl=document.getElementById('auth-role');
      var role=roleEl?roleEl.value:'worker';
      var codeEl=document.getElementById('auth-access-code');
      var accessCode=codeEl?codeEl.value.trim():'';
      window.MiGalponSync.signUp(newEmail,newPassword,newName,role,accessCode).then(function(){
        toast('Cuenta creada. Entrando a Mi Galpón…');
      }).catch(function(error){
        console.error('No se pudo crear la cuenta:',error);
        syncState=Object.assign({},syncState,{error:authErrorMessage(error)});
        render();
      });
      break;
    }
    case 'auth-signup':authMode='signup';syncState=Object.assign({},syncState,{error:null});render();break;
    case 'auth-login':authMode='login';syncState=Object.assign({},syncState,{error:null});render();break;
    case 'sync-signout':
      window.MiGalponSync.signOut().catch(function(error){console.error('No se pudo cerrar sesión:',error);toast('No se pudo cerrar sesión.');});
      break;
    case 'sync-retry-profile':
      window.MiGalponSync.retryProfile().catch(function(error){
        console.error('No se pudo volver a validar la cuenta:',error);
        syncState=Object.assign({},syncState,{error:authErrorMessage(error)});
        render();
      });
      break;
    case 'sync-generate-code':
      window.MiGalponSync.generateAccessCode().then(function(){
        toast('Código de acceso generado. Vence en 15 minutos.');
      }).catch(function(error){
        console.error('No se pudo generar el código de acceso:',error);
        syncState=Object.assign({},syncState,{error:'No se pudo generar el código. Revisa la conexión e inténtalo de nuevo.'});
        render();
      });
      break;
    case 'filtro':filtro=t.dataset.v;render();break;
    case 'tog-pago':p=db.pedidos.find(function(x){return x.id===id;});if(p){p.pago=p.pago==='Pagado'?'Pendiente':'Pagado';save();render();toast(p.pago==='Pagado'?'Marcado como pagado':'Marcado como pendiente de pago');}break;
    case 'tog-ent':p=db.pedidos.find(function(x){return x.id===id;});if(p){p.entrega=p.entrega==='Entregado'?'Encargo':'Entregado';if(p.entrega==='Entregado')p.fechaEntrega=p.fechaEntrega||hoy();save();render();toast(p.entrega==='Entregado'?'Marcado como entregado':'Marcado como encargo');}break;
    case 'cobrar':p=db.pedidos.find(function(x){return x.id===id;});if(p){p.pago='Pagado';save();render();toast('Pedido marcado como pagado');}break;
    case 'entregar':p=db.pedidos.find(function(x){return x.id===id;});if(p){p.entrega='Entregado';p.fechaEntrega=p.fechaEntrega||hoy();save();render();toast('Pedido marcado como entregado');}break;
    case 'cfg-save':{
      db.config.nombre=val('c-nombre').trim()||'Mi galpón';
      var pc=Math.round(num(val('c-pc')));
      db.config.porCanasta=pc>0?pc:30;
      db.config.precio=Math.max(0,Math.round(num(val('c-precio'))));
      db.config.precioUnidad=Math.max(0,Math.round(num(val('c-precio-unidad'))));
      save();render();toast('Ajustes guardados');break;}
    case 'owner-payment':{
      var ownerName=val('owner-name').trim(), amount=Math.round(num(val('owner-amount')));
      if(!ownerName){toast('Escribe el nombre.');break;}
      if(amount<=0){toast('Escribe un monto válido para registrar el pago.');break;}
      if(!Array.isArray(db.config.ownerPayments))db.config.ownerPayments=[];
      db.config.ownerPayments.push({id:uid(),name:ownerName,amount:amount,date:val('owner-date')||hoy()});
      save();render();toast('Entrega registrada');break;}
    case 'backup':solicitarPermisoAlmacenamiento().then(function(ok){if(ok)openBackup();});break;
    case 'restore':openRestore();break;
    case 'importfile':openImportFile();break;
    case 'carpeta':solicitarPermisoAlmacenamiento().then(function(ok){if(ok)elegirCarpeta();});break;
    case 'reporte':solicitarPermisoAlmacenamiento().then(function(ok){if(ok)openReporte();});break;
    case 'reset':confirmSheet('¿Borrar todos los datos?','Se borran recogidas, pedidos y gallinas de este teléfono. Esto no se puede deshacer. Si no tienes una copia de seguridad, hazla antes.','Borrar todo',function(){
      db=defaults();save();tab='inicio';render();toast('Datos borrados');});break;
  }
});

document.addEventListener('change',function(e){
  if(e.target&&e.target.id==='auth-role'){
    authRole=e.target.value;
    render();
    return;
  }
  if(e.target.matches('[data-auto-theme]')){
    db.config.tema=e.target.checked?'Automático':'Claro';
    save();aplicarTema();render();
  }
  if(e.target.matches('[data-theme-toggle]')){
    db.config.tema=e.target.checked?'Oscuro':'Claro';
    save();aplicarTema();render();
  }
  if(e.target.matches('#s-tema button')){
    db.config.tema=e.target.dataset.v;
    save();aplicarTema();render();
  }
});

document.addEventListener('input',function(e){
  if(e.target && e.target.id==='pedidoSearch'){
    pedidoBuscar=e.target.value;
    if(tab==='pedidos'){
      var pedidoPos=e.target.selectionStart;
      render();
      var pedidoInput=document.getElementById('pedidoSearch');
      if(pedidoInput){pedidoInput.focus();pedidoInput.setSelectionRange(pedidoPos,pedidoPos);}
    }
  }
  if(e.target && e.target.id==='clienteSearch'){
    clienteBuscar=e.target.value;
    if(tab==='clientes'){
      var clientePos=e.target.selectionStart;
      render();
      var clienteInput=document.getElementById('clienteSearch');
      if(clienteInput){clienteInput.focus();clienteInput.setSelectionRange(clientePos,clientePos);}
    }
  }
});

document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&sheetOpen){closeSheet();return;}
  if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('[role="button"][data-act]')){e.preventDefault();e.target.click();}
});
window.addEventListener('popstate',function(){
  if(ignoreNextPopstate){
    ignoreNextPopstate=false;
    return;
  }
  if(sheetOpen){
    sheetHistory=false;
    closeSheet(true);
  }else if(ajustesSeccion){
    ajustesSeccion=null;
    render();
  }else if(tab==='clientes'){
    tab=vistaAnterior;
    clienteBuscar='';
    ajustesSeccion=null;
    render();
  }else{
    history.pushState({galponApp:true},document.title);
  }
});
document.addEventListener('backbutton',function(e){
  if(sheetOpen){
    if(e&&e.preventDefault)e.preventDefault();
    closeSheet();
  }else if(tab!=='inicio'||ajustesSeccion){
    if(e&&e.preventDefault)e.preventDefault();
    tab='inicio';
    ajustesSeccion=null;
    quickOpen=false;
    clienteBuscar='';
    render();
  }
  return false;
},true);
var root=$('#sheetRoot');
root.addEventListener('click',function(e){
  if(e.target.closest('[data-close]')){closeSheet();return;}
  var op=e.target.closest('[data-open-pedido]');
  if(op){openPedido(op.dataset.id);return;}
  var s=e.target.closest('.seg button');
  if(s){
    Array.prototype.forEach.call(s.parentNode.children,function(b){b.classList.toggle('on',b===s);b.setAttribute('aria-checked',b===s);});
    if(act.input)act.input();return;
  }
  var b=e.target.closest('[data-do]');
  if(b&&syncState.role==='owner'){
    toast('Esta cuenta es de solo consulta. El trabajador registra la información.');
    return;
  }
  if(b&&act[b.dataset.do])act[b.dataset.do]();
});
root.addEventListener('input',function(){if(act.input)act.input();});
document.addEventListener('visibilitychange',function(){if(!document.hidden&&!sheetOpen)render();});

solicitarPermisoAlmacenamiento().then(function(){return cargarCarpeta();}).then(function(){render();});
})();
