
(function(){
'use strict';

/* ---------- Datos ---------- */
var KEY='galpon_app_v1';
function defaults(){return {config:{nombre:'Mi galpón',porCanasta:30,precio:0,precioUnidad:0,
  tema:'Automático',percentilAlerta:75,ownerPayments:[]},gallinas:[],dias:[],pedidos:[],clientes:[],gastos:[]};}
function load(){
  try{
    var raw=localStorage.getItem(KEY);
    if(raw){
      var o=JSON.parse(raw), d=defaults();
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
var galponSession=null;
var galponWorkerCount=null;
var remoteDataReady=false;
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
  try{localStorage.setItem(KEY,JSON.stringify(db));}
  catch(e){toast('No se pudo guardar en este teléfono. Haz una copia de seguridad.');}
  if(window.galponOfflineSession)window.galponOfflineSession.persist(db);
  if(galponSession&&galponSession.role==='worker'&&remoteDataReady&&window.galponCloudSync){
    window.galponCloudSync(db).catch(function(error){
      console.error('No se pudieron sincronizar los datos con Appwrite:',error);
      if(!window.galponAppwriteConnection||window.galponAppwriteConnection.isAvailable()){
        toast('No se pudo sincronizar con Appwrite. Revisa tu conexión.');
      }
    });
  }
}
function aplicarTema(){
  var t=db.config.tema;
  try{
    var preferencia=localStorage.getItem('galpon_theme_preference');
    if(preferencia==='Automático'||preferencia==='Claro'||preferencia==='Oscuro')t=preferencia;
  }catch(e){console.error('No se pudo leer la apariencia local:',e);}
  if(t==='Automático')t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'Oscuro':'Claro';
  if(t==='Claro')document.documentElement.dataset.theme='light';
  else if(t==='Oscuro')document.documentElement.dataset.theme='dark';
  else delete document.documentElement.dataset.theme;
}
function preferenciaTema(){
  try{return localStorage.getItem('galpon_theme_preference')||db.config.tema||'Automático';}
  catch(e){console.error('No se pudo leer la apariencia local:',e);return db.config.tema||'Automático';}
}
function selectorTema(){
  var actual=preferenciaTema();
  return '<div class="seg" id="s-tema" role="radiogroup" aria-label="Tema de la aplicación">'+
    ['Automático','Claro','Oscuro'].map(function(tema){
      return '<button type="button" role="radio" aria-checked="'+(actual===tema)+'" data-theme-choice="'+tema+'" class="'+(actual===tema?'on':'')+'">'+tema+'</button>';
    }).join('')+'</div>';
}
aplicarTema();
if(window.matchMedia){
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',function(){
    if(preferenciaTema()==='Automático')aplicarTema();
  });
}

var tab='inicio', periodoInicio='', periodoHuevos='', periodoPedidos='', periodoVentas='', periodoPagos='', configGalponAbierta=false, gastosAbierta=false, ajustesSeccion=null, quickOpen=false, homeEntrancePlayed=false, filtro='', pedidoBuscar='', clienteBuscar='';

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
var money=function(n){return '$'+(Math.round(num(n)/100)*100).toLocaleString('es-CO');};
var moneyPedido=function(n){return money(n);};
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
function montoRecibido(p){
  if(p.montoEfectivo!=null||p.montoTransferencia!=null){
    return Math.min(Math.max(0,num(p.total)),Math.max(0,num(p.montoEfectivo))+Math.max(0,num(p.montoTransferencia)));
  }
  return p.pago==='Pagado'?Math.max(0,num(p.total)):0;
}
function montoPendiente(p){return Math.max(0,num(p.total)-montoRecibido(p));}
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
function diasDesde(fecha){
  if(!fecha)return 0;
  var fechaPedido=new Date(fecha+'T12:00:00'), fechaActual=new Date(hoy()+'T12:00:00');
  return Math.max(0,Math.floor((fechaActual-fechaPedido)/86400000));
}
function resumenGastos(desde_){
  var gs=(db.gastos||[]).filter(function(g){return g.fecha>=desde_&&g.fecha<=hoy();});
  return {gastos:gs,total:sum(gs,function(g){return g.monto||0;})};
}

/* ---------- Clientes ---------- */
function statsCliente(nombre){
  var ln=(nombre||'').trim().toLowerCase();
  var ps=db.pedidos.filter(function(p){return (p.cliente||'').trim().toLowerCase()===ln;});
  var total=sum(ps,function(p){return p.total||0;});
  var pendiente=sum(ps,montoPendiente);
  var diasMora=ps.filter(function(p){return montoPendiente(p)>0;}).reduce(function(max,p){
    return Math.max(max,diasDesde(p.fecha));
  },0);
  var canastasEq=sum(ps,function(p){return huevosPedido(p)/(p.pc||pcBase());});
  return {ps:ps,total:total,pendiente:pendiente,diasMora:diasMora,canastasEq:canastasEq,n:ps.length};
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
function fld(id,label,attrs,v){return '<label class=\"f\"><span>'+label+'</span><input id=\"'+id+'\" value=\"'+esc(v)+'\" onfocus=\"if(this.inputMode===\'numeric\'||this.inputMode===\'decimal\')this.select()\" '+(attrs||'')+'></label>';}
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
    var etiqueta=fmtFecha(f)+': '+(d?pctTxt(p)+' de postura, '+nf(d.huevos)+' huevos recogidos':'sin registro');
    var retraso=((13-i)*22)+'ms';
    var hoyClase=f===hoy()?' chart-bar-today':'';
    if(p==null){out+='<rect class=\"chart-bar chart-bar-empty'+hoyClase+'\" x=\"'+x+'\" y=\"92\" width=\"14\" height=\"2\" rx=\"1\" style=\"animation-delay:'+retraso+'\"><title>'+esc(etiqueta)+'</title></rect>';}
    else{var h=Math.max(3,Math.min(100,p)*0.9);out+='<rect class=\"chart-bar'+hoyClase+'\" x=\"'+x+'\" y=\"'+(92-h).toFixed(1)+'\" width=\"14\" height=\"'+h.toFixed(1)+'\" rx=\"3\" style=\"animation-delay:'+retraso+'\"><title>'+esc(etiqueta)+'</title></rect>';}
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
  var pedidosPendientes=db.pedidos.filter(function(p){return montoPendiente(p)>0;}).length;
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
    {label:'Ventas',value:moneyPedido(periodoResumen.ventas.total),meta:'periodo'},
    {label:'Cobrado',value:moneyPedido(periodoResumen.ventas.cobrado),meta:'periodo'}
  ];

  var h='';
  if(tg===0){
    h+='<section class=\"hero solo\"><h2>Empieza contando tus gallinas</h2><p>Con el total de gallinas puedo calcular el porcentaje de postura de cada día.</p><button class=\"btn yema\" data-act=\"gal-in\">Registrar mis gallinas</button></section>';
  }else{
    h+='<section class=\"hero\">'+ring(p)+'<div class=\"hero-t\">'+
      '<div class=\"hero-eyebrow\"><span class=\"hero-live-dot\"></span>Resumen de hoy</div>'+
      '<p class=\"hero-collection\"><strong>'+(hoyRec?nf(hoyRec.huevos):'—')+'</strong><span> huevos recogidos</span></p>'+
      '<div class=\"hero-meta\"><span class=\"hero-hens\"><span aria-hidden=\"true\">🐔</span> '+nf(tg)+' ponedoras</span>'+
      '<span class=\"hero-date\">'+(hoyRec?'Producción registrada':ult?'Último registro · '+fmtFecha(ult.fecha):'Aún no hay recogidas')+'</span></div>'+
      '</div><span class=\"hero-glow\" aria-hidden=\"true\"></span></section>';
  }

  var kpiIcons={Gallinas:'🐔',Huevos:'🥚',Postura:'📈',Stock:'📦',Ventas:'💰',Cobrado:'✓'};
  h+='<div class=\"kpis\">'+kpis.map(function(k){
    var cls='up';
    if(k.label==='Stock'){
      cls=st.total<0?'low':'up';
    }else if(k.label==='Ventas'){
      cls='up';
    }
    return '<div class=\"kpi kpi-'+k.label.toLowerCase()+'\"><div class=\"kpi-top\"><span class=\"small\">'+k.label+'</span><span class=\"kpi-icon\" aria-hidden=\"true\">'+kpiIcons[k.label]+'</span></div><div class=\"big\">'+k.value+'</div><span class=\"trend '+cls+'\"><span class=\"trend-dot\"></span>'+k.meta+'</span></div>';
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
  var cobrado=sum(psel,montoRecibido);
  var porCobrar=sum(psel,montoPendiente);

  h+='<h2 class=\"sec\">Resumen</h2><div class=\"chips\">'+[['hoy','Hoy'],['7','7 días'],['30','30 días']].map(function(o){
    return '<button class=\"chip'+(periodoInicio===o[0]?' on':'')+'" data-act=\"periodo\" data-v=\"'+o[0]+'\">'+o[1]+'</button>';}).join('')+'</div>';
  h+='<div class=\"panel\">'+
    '<div class=\"row\"><span>Huevos recogidos</span><b>'+nf(rec)+(rotos?' ('+nf(rotos)+' rotos)':'')+'</b></div>'+
    '<div class=\"row\"><span>Postura promedio</span><b>'+(pos==null?'–':pctTxt(pos))+'</b></div>'+
    '<div class=\"row\"><span>Alimento echado</span><b>'+nf1(alim)+' kg</b></div>'+
    '<div class=\"row\"><span>Alimento por gallina</span><b>'+(gpd==null?'–':nf(gpd)+' g al día')+'</b></div>'+
    '<div class=\"row\"><span>Vendido</span><b>'+canastasTxt(vend)+'</b></div>'+
    '<div class=\"row\"><span>Dinero cobrado</span><b>'+moneyPedido(cobrado)+'</b></div>'+
    '<div class=\"row\"><span>Por cobrar (todos los pedidos)</span><b>'+moneyPedido(porCobrar)+'</b></div></div>';

  h+='<h2 class=\"sec\">Postura de los últimos 14 días</h2><div class=\"panel\">'+chart14()+'<p class=\"cap\">Cada barra es un día. La línea punteada marca el 100 %.</p></div>';
  var recientes=db.dias.slice().sort(function(a,b){return b.fecha.localeCompare(a.fecha);}).slice(0,3);
  var pedidosRecientes=db.pedidos.filter(function(p){return montoPendiente(p)>0;}).slice().sort(function(a,b){return b.fecha.localeCompare(a.fecha);}).slice(0,3);
  h+='<h2 class="sec">Actividad reciente</h2><div class="panel activity-list">';
  if(recientes.length)h+='<div class="activity-group"><strong>Últimas recogidas</strong>'+recientes.map(function(d){return '<div class="activity-row"><span>'+fmtFecha(d.fecha)+'</span><b>'+nf(d.huevos)+' huevos</b></div>';}).join('')+'</div>';
  if(pedidosRecientes.length)h+='<div class="activity-group"><strong>Cuentas por cobrar</strong>'+pedidosRecientes.map(function(p){return '<div class="activity-row"><span>'+esc(p.cliente)+'</span><b>'+moneyPedido(montoPendiente(p))+'</b></div>';}).join('')+'</div>';
  if(!recientes.length&&!pedidosRecientes.length)h+='<p class="hint">Todavía no hay actividad reciente.</p>';
  h+='<div class="activity-total"><span>Dinero por cobrar</span><b>'+moneyPedido(porCobrar)+'</b></div></div>';
  return h;
}

function viewHuevos(){
  var l=db.dias.slice().sort(function(a,b){
    return b.fecha.localeCompare(a.fecha);
  });
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
    '<span class="history-count">'+periodoDias.length+' '+(periodoDias.length===1?'día':'días')+'</span>'+
    '</div>'+
    '<div class="chips">'+[['hoy','Hoy'],['7','7 días'],['15','15 días'],['30','30 días']].map(function(o){
      return '<button class="chip'+(periodoHuevos===o[0]?' on':'')+'" data-act="periodo" data-v="'+o[0]+'">'+o[1]+'</button>';
    }).join('')+'</div>'+
    '<div class="panel"><div class="row"><span>Huevos buenos</span><b>'+nf(huevosPeriodo)+'</b></div><div class="row"><span>Rotos o dañados</span><b>'+nf(periodoRotos)+'</b></div><div class="row"><span>Recogidas registradas</span><b>'+nf(sum(periodoDias,function(d){return Array.isArray(d.recogidas)&&d.recogidas.length?d.recogidas.length:1;}))+'</b></div></div>'+
    '<h2 class="sec" style="margin-top:16px">Registros</h2>'+
    (periodoDias.length?'<div class="history-list">'+
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
              '<span class="history-sub">'+(Array.isArray(d.recogidas)&&d.recogidas.length?d.recogidas.length+' recogidas':'Registro diario')+'</span>'+
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
    '</div>':empty('Aún no hay recogidas en este periodo','Toca “Añadir recogida” cuando recojas huevos para sumarlos al día.'));
}

function fichaDia(id){
  var d=db.dias.find(function(x){return x.id===id;});
  if(!d)return;
  var buenosHuevos=buenos(d), postura=posturaDia(d);
  var recogidas=Array.isArray(d.recogidas)?d.recogidas:[];
  var detalleRecogidas=recogidas.length?
    '<div class="detail-row"><span>Recogidas individuales</span><b>'+recogidas.length+'</b></div>'+
    '<div class="history-list">'+recogidas.map(function(r){
      var hora='';
      try{hora=new Date(r.hora).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'});}catch(error){hora='';}
      return '<div class="history-card"><div class="history-top"><strong>'+esc(hora||'Recogida')+'</strong><strong>'+nf(r.huevos)+' huevos</strong></div>'+
        '<div class="history-footer"><span class="history-stat">Buenos: <strong>'+nf(Math.max(0,r.huevos-(r.rotos||0)))+'</strong></span>'+
        (r.rotos?'<span class="history-stat">Rotos: <strong>'+nf(r.rotos)+'</strong></span>':'')+
        (r.alimento?'<span class="history-stat">🌾 Alimento: <strong>'+nf1(r.alimento)+' kg</strong></span>':'')+
        (r.notas?'<span class="history-stat">'+esc(r.notas)+'</span>':'')+'</div></div>';
    }).join('')+'</div>'
    :'<p class="hint">Este día se registró como un total. Las nuevas recogidas quedarán guardadas por separado.</p>';
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
    '<h3 class="sec">Recogidas del día</h3>'+detalleRecogidas+
    '<div class="btnrow detail-actions"><button class="btn" data-do="agregar">Añadir recogida</button><button class="btn sec" data-do="editar">Editar datos del día</button></div>';
  openSheet(d.fecha===hoy()?'Registro de hoy':'Detalle de recogida',h);
  act.editar=function(){openDia(id);};
  act.agregar=function(){closeSheet();openRecogida(d.fecha);};
}

function viewPedidos(){
  var all=db.pedidos.slice().sort(function(a,b){
    return b.fecha.localeCompare(a.fecha)||b.id.localeCompare(a.id);
  });
  var st=stock();
  var pedidosDelPeriodo=all.filter(function(p){return p.fecha>=desdePeriodo(periodoPedidos);});
  var periodoTotal=sum(pedidosDelPeriodo,function(p){return p.total||0;});
  var periodoHuevos=sum(pedidosDelPeriodo,huevosPedido);
  var porCobrar=sum(pedidosDelPeriodo,montoPendiente);
  var pedidosFiltrados=pedidosDelPeriodo.filter(function(p){
    return !filtro||filtro==='todos'?true:
      filtro==='cobrar'?montoPendiente(p)>0:
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
    '<div class="panel"><div class="row"><span>Ventas del periodo</span><b>'+moneyPedido(periodoTotal)+'</b></div><div class="row"><span>Por cobrar</span><b>'+moneyPedido(porCobrar)+'</b></div><div class="row"><span>Huevos comprometidos</span><b>'+nf(periodoHuevos)+'</b></div><div class="row"><span>Pedidos del periodo</span><b>'+nf(pedidosDelPeriodo.length)+'</b></div></div>'+
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
          return montoPendiente(p)>0;
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
        'data-act="pedido-view" data-id="'+p.id+'" data-filter-text="'+esc((p.cliente||'')+' '+(p.notas||'')+' '+pedidoTxt(p)+' '+(p.pago||'')+' '+(p.entrega||''))+'">'+

        '<div class="order-head">'+
          '<div class="order-client">'+
            '<div class="client-avatar">'+inicial+'</div>'+
            '<div>'+
              '<b>'+nombre+'</b>'+
              '<span class="order-date">'+fmtFecha(p.fecha)+'</span>'+
            '</div>'+
          '</div>'+
          '<span class="order-total">'+moneyPedido(p.total||0)+'</span>'+
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
            (p.pago==='Pagado'?'ok':montoRecibido(p)>0?'wait':'bad')+
            '" data-act="tog-pago" data-id="'+p.id+'">'+
            (p.pago==='Pagado'?'✓ Pagado':montoRecibido(p)>0?'Abonado · falta '+moneyPedido(montoPendiente(p)):'Por cobrar')+
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
  var detalleFormaPago=p.montoEfectivo||p.montoTransferencia?
    '<div class="detail-row"><span>Detalle de abonos</span><b>'+moneyPedido(p.montoEfectivo||0)+' efectivo · '+moneyPedido(p.montoTransferencia||0)+' transferencia</b></div>':'';
  var h='<div class="detail-hero">'+
    '<span class="detail-kicker">Pedido de '+cliente+'</span>'+ 
    '<strong class="detail-total">'+moneyPedido(p.total||0)+'</strong>'+ 
    '<span class="detail-date">'+fmtFecha(p.fecha)+'</span>'+ 
    '</div>'+ 
    '<div class="detail-list">'+
      '<div class="detail-row"><span>Cliente</span><b>'+cliente+'</b></div>'+ 
      '<div class="detail-row"><span>Cantidad</span><b>'+esc(pedidoTxt(p))+'</b></div>'+ 
      '<div class="detail-row"><span>Huevos</span><b>'+nf(huevosPedido(p))+'</b></div>'+ 
      '<div class="detail-row"><span>Estado de pago</span><b>'+(p.pago==='Pagado'?'Pagado':montoRecibido(p)>0?'Abonado parcialmente':'Por cobrar')+'</b></div>'+
      '<div class="detail-row"><span>Forma de pago</span><b>'+esc(p.metodoPago||'No especificada')+'</b></div>'+
      '<div class="detail-row"><span>Recibido</span><b>'+moneyPedido(montoRecibido(p))+'</b></div>'+
      '<div class="detail-row"><span>Saldo pendiente</span><b>'+moneyPedido(montoPendiente(p))+'</b></div>'+
      detalleFormaPago+
      '<div class="detail-row"><span>Entrega</span><b>'+esc(entrega||'Pendiente')+'</b></div>'+ 
      '<div class="detail-row"><span>Precio aplicado</span><b>'+money(p.precio||0)+'</b></div>'+ 
      (p.notas?'<div class="detail-row detail-notes"><span>Notas</span><b>'+esc(p.notas)+'</b></div>':'')+ 
    '</div>'+ 
    '<div class="btnrow detail-actions"><button class="btn" data-do="editar">Editar información</button></div>';
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
  var cobrado=sum(ps,montoRecibido);
  var pend=sum(ps,montoPendiente);
  return {ps:ps,grp:grp,total:total,cobrado:cobrado,pend:pend};
}

function viewVentas(){
  var r=ventasResumen(desdePeriodo(periodoVentas));
  var g=resumenGastos(desdePeriodo(periodoVentas));
  var utilidad=r.cobrado-g.total;
  var canastasCompletas=Math.floor(r.grp.Canasta.h/pcBase());
  var huevosSueltos=r.grp.Unidad.h+r.grp.Canasta.h%pcBase()+r.grp.Media.h%Math.round(pcBase()/2);
  var mediasCompletas=Math.floor(r.grp.Media.h/Math.round(pcBase()/2));
  var h='<h2 class=\"sec\">Ventas</h2><div class=\"chips\">'+[['hoy','Hoy'],['7','7 días'],['15','15 días'],['30','30 días']].map(function(o){
    return '<button class=\"chip'+(periodoVentas===o[0]?' on':'')+'" data-act=\"periodo\" data-v=\"'+o[0]+'\">'+o[1]+'</button>';}).join('')+'</div>';
  h+='<div class=\"panel\">'+
    '<p class=\"stockn\">'+moneyPedido(r.total)+' <small>vendido</small></p>'+
    '<div class=\"row\"><span>Dinero cobrado</span><b>'+moneyPedido(r.cobrado)+'</b></div>'+
    '<div class=\"row\"><span>Falta por cobrar</span><b>'+moneyPedido(r.pend)+'</b></div>'+
    '<div class=\"row\"><span>Gastos del periodo</span><b>'+money(g.total)+'</b></div>'+
    '<div class=\"row\"><span>Disponible después de gastos</span><b>'+money(utilidad)+'</b></div>'+
    '</div>';

  h+='<h2 class=\"sec\">Huevos vendidos por tipo</h2><div class=\"panel\">'+
    '<div class=\"row\"><span>Canastas completas</span><b>'+nf(canastasCompletas)+' ('+nf(canastasCompletas*pcBase())+' huevos)</b></div>'+
    '<div class=\"row\"><span>Medias canastas</span><b>'+nf(mediasCompletas)+' ('+nf(mediasCompletas*Math.round(pcBase()/2))+' huevos)</b></div>'+
    '<div class=\"row\"><span>Huevos sueltos</span><b>'+nf(huevosSueltos)+'</b></div>'+
    '<div class=\"row\"><span>Total de huevos vendidos</span><b>'+nf(r.grp.Canasta.h+r.grp.Media.h+r.grp.Unidad.h)+'</b></div>'+
    '</div>';

  if(!r.ps.length)h+='<p class=\"cap\">No hay pedidos en este periodo.</p>';
  return h;
}

function viewPagos(){
  var pagos=Array.isArray(db.config.ownerPayments)?db.config.ownerPayments:[];
  var desdePago=periodoPagos===''||periodoPagos==='todo'?'0000-00-00':periodoPagos==='hoy'?hoy():haceDias(periodoPagos==='7'?6:29);
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
      var alertaDeuda=s.diasMora>30?'<span class=\"debt-age debt-age-critical\">Deuda · '+s.diasMora+' días</span>':
        s.diasMora>15?'<span class=\"debt-age debt-age-high\">Deuda · '+s.diasMora+' días</span>':
        s.diasMora>7?'<span class=\"debt-age debt-age-warning\">Deuda · '+s.diasMora+' días</span>':'';
      return '<button class=\"item\" data-act=\"cli-open\" data-id=\"'+c.id+'\" data-filter-text=\"'+esc(c.nombre+' '+(c.telefono||''))+'\"><div><b>'+esc(c.nombre)+'</b>'+
        '<span class=\"sub\">'+(s.n?nf1(s.canastasEq)+' canastas compradas':'Sin compras todavía')+(c.precio?' · precio especial':'')+'</span>'+alertaDeuda+'</div>'+
        '<span'+(s.pendiente>0?' class=\"menos\"':' class=\"sub\"')+'>'+(s.pendiente>0?moneyPedido(s.pendiente)+' por cobrar':'Al día')+'</span></button>';
    }).join('')+'</div>';
  }
  if(frecuentes.length){
    var conStats2=frecuentes.map(function(n){return {n:n,s:statsCliente(n)};});
    conStats2.sort(function(a,b){return b.s.n-a.s.n;});
    h+='<h2 class=\"sec\">Clientes frecuentes sin registrar</h2><p class=\"cap\">Compraron alguna vez pero no están en tu directorio. Agrégalos para asignarles un precio especial.</p><div class=\"panel list\">'+conStats2.map(function(x){
      return '<div class=\"item\" data-filter-text=\"'+esc(x.n)+'\" style=\"cursor:default\"><div><b>'+esc(x.n)+'</b><span class=\"sub\">'+x.s.n+(x.s.n===1?' pedido':' pedidos')+' · '+moneyPedido(x.s.total)+'</span></div>'+
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
    '<div class=\"row\" style=\"padding:8px 0;border-top:1px solid var(--line)\"><span>Comprado en total</span><b>'+moneyPedido(s.total)+'</b></div>'+
    '<div class=\"row\" style=\"padding:8px 0;border-top:1px solid var(--line)\"><span>Saldo pendiente</span><b style=\"'+(s.pendiente>0?'color:var(--rojo)':'')+'\">'+moneyPedido(s.pendiente)+'</b></div>'+
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
        '<div style=\"text-align:right\"><span class=\"money\" style=\"font:700 15px var(--serif)\">'+moneyPedido(p.total||0)+'</span><br><span class=\"pill '+(p.pago==='Pagado'?'ok':'bad')+'\" style=\"margin-top:4px\">'+p.pago+'</span></div></button>';
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
    var precioEspecial=Math.round(num(val('cl-precio')));
    var rec={id:ex?ex.id:uid(),nombre:nombre,telefono:val('cl-tel').trim(),precio:precioEspecial>0?precioEspecial:'',notas:val('cl-notas').trim()};
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
    '<p class=\"lbl\">Tema</p>'+selectorTema()+
    '<p class=\"hint\" style=\"margin:0\">Automático sigue el tema que tenga puesto tu teléfono. La preferencia se guarda en este dispositivo.</p></div>';

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

  h+='<h2 class=\"sec\">Carpeta del teléfono</h2><div class=\"panel pad\"><p class=\"hint\">Autoriza una carpeta para guardar copias de seguridad. Se creará dentro una carpeta llamada “Mi Galpon”.</p>'+
    '<button class=\"btn sec wide\" style=\"margin-top:0\" data-act=\"carpeta\">Elegir carpeta para guardar</button></div>';

  h+='<h2 class=\"sec\">Tus datos</h2><div class=\"panel pad\"><p class=\"hint\">Todo se guarda solo en este teléfono y funciona sin internet. Haz una copia de seguridad de vez en cuando.</p>'+
    '<div class=\"btnrow\"><button class=\"btn sec\" data-act=\"backup\">Copia de seguridad</button><button class=\"btn sec\" data-act=\"restore\">Restaurar copia</button></div>'+
    '<button class=\"btn sec wide\" data-act=\"importfile\" style=\"margin-top:10px\">Importar archivo JSON</button>'+
    '<button class=\"btn warn wide\" data-act=\"reset\">Borrar todos los datos</button></div>';
  return h;
}

function ajustesSeccionView(seccion){
  var c=db.config, tg=totalGallinas();
  var titles={cuenta:'Cuenta',business:'Datos principales',gastos:'Gastos',clientes:'Clientes',gallinas:'Ponedoras',apariencia:'Apariencia',datos:'Copias de seguridad'};
  var h='<div class="settings-single-head"><button class="settings-back" data-act="settings-back" aria-label="Volver">‹</button><div><span class="settings-kicker">Ajustes</span><h2>'+titles[seccion]+'</h2></div></div>';
  if(seccion==='cuenta'){
    var cuenta=galponSession||{}, esTrabajador=cuenta.role==='worker';
    h+='<div class="settings-card panel pad account-settings-card"><div class="account-profile-mark" aria-hidden="true">'+(esTrabajador?'T':'D')+'</div>'+
      '<h3 class="settings-card-title">'+(esTrabajador?'Cuenta de trabajador':'Cuenta de dueño')+'</h3>'+
      '<p class="account-email">'+esc(cuenta.email||'')+'</p>'+
      '<p class="hint">'+(esTrabajador?'Puedes registrar y actualizar la información del galpón.':'Tienes acceso de solo lectura a la información compartida del galpón.')+'</p>'+
      (esTrabajador?'<div class="invite-code-card"><label for="owner-invite-email">Invitar al dueño por correo</label><input id="owner-invite-email" type="email" autocomplete="email" placeholder="correo@ejemplo.com"><button class="btn sec wide" data-act="account-invite">Enviar invitación</button><p class="hint">El dueño debe abrir el correo de invitación y usar esa misma dirección para crear su cuenta.</p></div>':'')+
      '<button class="btn warn wide" data-act="account-signout">Cerrar sesión</button></div>';
  }else if(seccion==='business'){
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
    h+='<div class="settings-card panel pad"><h3 class="settings-card-title">Tema de la aplicación</h3><p class="hint">Elige cómo quieres ver Mi Galpón en este dispositivo.</p><p class="lbl">Tema</p>'+selectorTema()+'<p class="hint">Automático sigue el tema del teléfono. Esta opción no modifica los datos compartidos.</p></div>';
  }else if(seccion==='datos'){
    h+='<div class="settings-card panel pad"><h3 class="settings-card-title">Carpeta del teléfono</h3><p class="hint">Elige una ubicación para guardar copias de seguridad.</p><button class="btn sec wide" data-act="carpeta">Elegir carpeta para guardar</button></div><div class="settings-card panel pad"><h3 class="settings-card-title">Copia y restauración</h3><p class="hint">La cuenta conserva una copia local para trabajar sin conexión y sincroniza los cambios al volver a internet. La copia JSON te permite recuperar datos en otro teléfono.</p><div class="btnrow"><button class="btn sec" data-act="backup">Copia de seguridad</button><button class="btn sec" data-act="restore">Restaurar copia</button></div><button class="btn sec wide" data-act="importfile">Importar archivo JSON</button></div><div class="settings-card panel pad danger-zone"><h3 class="settings-card-title">Zona de riesgo</h3><p class="hint">Esta acción elimina todos los datos guardados.</p><button class="btn warn wide" data-act="reset">Borrar todos los datos</button></div>';
  }
  return h;
}

function ajustesMenuView(){
  var cuenta=galponSession||{};
  var nombreUsuario=cuenta.name||((cuenta.email||'').split('@')[0])||'Usuario';
  function menuIcon(name){
    var paths={
      account:'<circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path>',
      business:'<path d="M3 21h18"></path><path d="M5 21V7l7-4 7 4v14"></path><path d="M9 21v-5h6v5M9 9h.01M15 9h.01"></path>',
      expenses:'<path d="M12 2v20"></path><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>',
      customers:'<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="10" cy="7" r="4"></circle><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>',
      hens:'<path d="M7 16c-2 0-3 1-3 3s2 3 4 3h7a5 5 0 0 0 0-10h-1"></path><path d="M8 12a5 5 0 1 1 9.6 2M8 12l-3-2 1-2 3 1M18 7h.01"></path><path d="M12 7c0-2 1-3 3-3"></path>',
      appearance:'<circle cx="12" cy="12" r="9"></circle><path d="M12 3v18a9 9 0 0 0 0-18z"></path>',
      backup:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="m7 10 5-5 5 5M12 5v12"></path>'
    };
    return '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[name]+'</svg>';
  }
  var countText=galponWorkerCount===null?'Consultando trabajadores…':galponWorkerCount+' '+(galponWorkerCount===1?'trabajador':'trabajadores');
  return '<div class="settings-drawer-head"><div class="settings-avatar" aria-hidden="true">'+menuIcon('account')+'</div><div><strong>'+esc(nombreUsuario)+'</strong><small>'+esc(cuenta.email||'')+'</small><small id="settingsWorkerCount">'+countText+'</small></div></div>'+
    '<div class="settings-drawer-menu">'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="cuenta"><span class="settings-menu-icon">'+menuIcon('account')+'</span><strong>Cuenta</strong><span>›</span></button>'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="business"><span class="settings-menu-icon">'+menuIcon('business')+'</span><strong>Datos principales</strong><span>›</span></button>'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="gastos"><span class="settings-menu-icon">'+menuIcon('expenses')+'</span><strong>Gastos</strong><span>›</span></button>'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="clientes"><span class="settings-menu-icon">'+menuIcon('customers')+'</span><strong>Clientes</strong><span>›</span></button>'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="gallinas"><span class="settings-menu-icon">'+menuIcon('hens')+'</span><strong>Ponedoras</strong><span>›</span></button>'+
      '<div class="settings-menu-divider"></div>'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="apariencia"><span class="settings-menu-icon">'+menuIcon('appearance')+'</span><strong>Apariencia</strong><span>›</span></button>'+
      '<button class="settings-menu-row" data-act="settings-jump" data-target="datos"><span class="settings-menu-icon">'+menuIcon('backup')+'</span><strong>Copias de seguridad</strong><span>›</span></button>'+
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

  h+='<section class="settings-section" id="settings-datos"><h2 class="settings-heading">Datos y copias de seguridad</h2><div class="settings-card panel pad"><h3 class="settings-card-title">Carpeta del teléfono</h3><p class="hint">Elige una ubicación para guardar copias de seguridad.</p><button class="btn sec wide" data-act="carpeta">Elegir carpeta para guardar</button></div><div class="settings-card panel pad"><h3 class="settings-card-title">Copia y restauración</h3><p class="hint">Todo se guarda solo en este teléfono y funciona sin internet. Haz una copia de seguridad de vez en cuando.</p><div class="btnrow"><button class="btn sec" data-act="backup">Copia de seguridad</button><button class="btn sec" data-act="restore">Restaurar copia</button></div><button class="btn sec wide" data-act="importfile" style="margin-top:10px">Importar archivo JSON</button></div><div class="settings-card panel pad danger-zone"><h3 class="settings-card-title">Zona de riesgo</h3><p class="hint">Esta acción elimina todos los datos guardados en el teléfono.</p><button class="btn warn wide" data-act="reset">Borrar todos los datos</button></div></section>';
  return h;
  */
}

var previousRenderedTab=null;
var chartAnimationTimer=null;
function render(){
  $('#nombre').textContent=db.config.nombre||'Mi galpón';
  var fh=new Date().toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long'});
  $('#fechaHoy').textContent=fh.charAt(0).toUpperCase()+fh.slice(1);
  var view=$('#view'), y=view.scrollTop;
  if(homeEntrancePlayed)document.body.classList.remove('home-entering');
  document.body.classList.toggle('home-tab',tab==='inicio');
  document.body.classList.toggle('settings-active',tab==='ajustes');
  document.body.classList.toggle('eggs-tab',tab==='huevos');
  document.body.classList.toggle('orders-tab',tab==='pedidos');
  document.body.classList.remove('home-chart-entering');
  if(chartAnimationTimer)clearTimeout(chartAnimationTimer);
  chartAnimationTimer=null;
  if(tab==='inicio'&&previousRenderedTab!=='inicio'){
    document.body.classList.add('home-chart-entering');
    chartAnimationTimer=setTimeout(function(){document.body.classList.remove('home-chart-entering');},1000);
  }
  var views={inicio:viewInicio,huevos:viewHuevos,pedidos:viewPedidos,ventas:viewVentas,clientes:viewClientes,ajustes:viewAjustesOrganizado};
  var html=views[tab]();
  view.innerHTML=html;
  view.scrollTop=y;
  if(tab==='inicio'&&galponSession&&!homeEntrancePlayed){
    homeEntrancePlayed=true;
    document.body.classList.add('home-entering');
    setTimeout(function(){document.body.classList.remove('home-entering');},1100);
  }
  $('#fabSlot').innerHTML=tab==='inicio'?'<div class="quick-bubble'+(quickOpen?' is-open':'')+'"><div class="quick-bubble-actions"><button data-act="quick-dia"><span>🥚</span>Registrar día</button><button data-act="quick-pedido"><span>📦</span>Nuevo pedido</button><button data-act="quick-gasto"><span>💸</span>Registrar gasto</button></div><button class="fab fab-plus" data-act="quick" aria-label="Acciones rápidas">'+(quickOpen?'×':'+')+'</button></div>':tab==='huevos'?'<button class=\"fab\" data-act=\"fab\">Añadir recogida</button>':tab==='pedidos'?'<button class=\"fab\" data-act=\"fab\">Nuevo pedido</button>':tab==='clientes'?'<button class=\"fab\" data-act=\"fab\">+ Nuevo cliente</button>':'';
  document.body.classList.toggle('no-fab-space',!['inicio','huevos','pedidos','clientes'].includes(tab));
  $('#nav').innerHTML=TABS.map(function(t){
    return '<button data-tab=\"'+t[0]+'\"'+(tab===t[0]?' aria-current=\"page\"':'')+'><span class=\"ic\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\">'+ICONS[t[0]]+'</svg></span>'+t[1]+'</button>';
  }).join('');
  previousRenderedTab=tab;
}

function rutaActual(){
  return {
    tab:tab,ajustesSeccion:ajustesSeccion,scrollTop:$('#view').scrollTop,clienteBuscar:clienteBuscar,
    periodoInicio:periodoInicio,periodoHuevos:periodoHuevos,periodoPedidos:periodoPedidos,
    periodoVentas:periodoVentas,periodoPagos:periodoPagos,filtro:filtro
  };
}
function guardarRutaActual(){
  var estado=history.state||{};
  history.replaceState(Object.assign({},estado,{route:rutaActual()}),document.title);
}
function aplicarRuta(ruta){
  tab=ruta&&ruta.tab||'inicio';
  ajustesSeccion=ruta&&ruta.ajustesSeccion||null;
  clienteBuscar=ruta&&ruta.clienteBuscar||'';
  if(ruta){
    periodoInicio=ruta.periodoInicio==null?'':ruta.periodoInicio;
    periodoHuevos=ruta.periodoHuevos==null?'':ruta.periodoHuevos;
    periodoPedidos=ruta.periodoPedidos==null?'':ruta.periodoPedidos;
    periodoVentas=ruta.periodoVentas==null?'':ruta.periodoVentas;
    periodoPagos=ruta.periodoPagos==null?'':ruta.periodoPagos;
    filtro=ruta.filtro==null?'':ruta.filtro;
  }
  quickOpen=false;
  render();
  $('#view').scrollTop=ruta&&ruta.scrollTop||0;
}
function abrirVista(vista){
  guardarRutaActual();
  var ruta=rutaActual();
  ruta.tab=vista;
  ruta.ajustesSeccion=null;
  ruta.scrollTop=0;
  ruta.clienteBuscar='';
  if(vista==='inicio')ruta.periodoInicio='';
  if(vista==='huevos')ruta.periodoHuevos='';
  if(vista==='pedidos')ruta.periodoPedidos='';
  if(vista==='ventas')ruta.periodoVentas='';
  if(vista==='pagos')ruta.periodoPagos='';
  if(vista==='pedidos')ruta.filtro='';
  history.pushState({galponApp:true,route:ruta},document.title);
  aplicarRuta(ruta);
}
function abrirAjustesSeccion(seccion){
  guardarRutaActual();
  var ruta=rutaActual();
  ruta.ajustesSeccion=seccion;
  ruta.scrollTop=0;
  history.pushState({galponApp:true,route:ruta},document.title);
  aplicarRuta(ruta);
}
window.manejarRetrocesoAndroid=function(){
  if(sheetOpen){
    closeSheet();
    return false;
  }
  if(tab!=='inicio'||ajustesSeccion){
    history.back();
    return false;
  }
  return true;
};

/* ---------- Hoja inferior ---------- */
history.replaceState({galponBase:true},document.title);
history.pushState({galponApp:true,route:rutaActual()},document.title);
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

function openRecogida(fechaInicial){
  var fecha=fechaInicial||hoy();
  openSheet('Añadir recogida',
    fld('r-fecha','Fecha','type="date"',fecha)+
    fld('r-huevos','Huevos recogidos ahora','type="text" inputmode="numeric" autocomplete="off"','')+
    fld('r-rotos','Rotos o dañados (opcional)','type="text" inputmode="numeric" autocomplete="off"','0')+
    fld('r-alimento','Alimento echado ahora (kg)','type="text" inputmode="decimal" autocomplete="off"','0')+
    fld('r-notas','Nota (opcional)','autocomplete="off" placeholder="Ej. recogida de la tarde"','')+
    '<div class="prev" id="prev"></div><p class="err" id="err" role="alert"></p>'+
    '<div class="btnrow"><button class="btn" data-do="save">Agregar recogida</button></div>');
  function preview(){
    var cantidad=Math.max(0,Math.round(num(val('r-huevos'))));
    var rotos=Math.max(0,Math.round(num(val('r-rotos'))));
    var alimento=Math.max(0,num(val('r-alimento')));
    var diaSeleccionado=db.dias.find(function(d){return d.fecha===val('r-fecha');});
    var acumulado=diaSeleccionado?num(diaSeleccionado.huevos):0;
    $('#prev').innerHTML='En esta recogida: <b>'+nf(Math.max(0,cantidad-rotos))+' huevos buenos</b>'+
      '<br>Total del día después de guardar: <b>'+nf(acumulado+cantidad)+' huevos</b>'+
      (alimento>0?'<br>Alimento añadido: <b>'+nf1(alimento)+' kg</b>':'');
  }
  act.input=preview;
  preview();
  act.save=function(){
    var fechaRecogida=val('r-fecha');
    var huevos=Math.round(num(val('r-huevos')));
    var rotos=Math.round(num(val('r-rotos')));
    var alimento=num(val('r-alimento'));
    if(!fechaRecogida)return err('Elige la fecha de la recogida.');
    if(!val('r-huevos').trim()||huevos<=0)return err('Escribe una cantidad de huevos mayor que cero.');
    if(rotos<0||rotos>huevos)return err('Los huevos rotos deben estar entre cero y la cantidad recogida.');
    if(alimento<0)return err('La cantidad de alimento no puede ser negativa.');
    var registroDia=db.dias.find(function(d){return d.fecha===fechaRecogida;});
    if(!registroDia){
      registroDia={id:uid(),fecha:fechaRecogida,huevos:0,rotos:0,alimento:0,gallinas:totalGallinas(),enfermas:0,notas:''};
      db.dias.push(registroDia);
    }
    if(!Array.isArray(registroDia.recogidas))registroDia.recogidas=[];
    var recogida={id:uid(),hora:new Date().toISOString(),huevos:huevos,rotos:rotos,alimento:alimento,notas:val('r-notas').trim()};
    registroDia.recogidas.push(recogida);
    registroDia.huevos=Math.max(0,Math.round(num(registroDia.huevos)))+huevos;
    registroDia.rotos=Math.max(0,Math.round(num(registroDia.rotos)))+rotos;
    registroDia.alimento=Math.max(0,num(registroDia.alimento))+alimento;
    save();closeSheet();render();toast('Recogida agregada al total del día');
  };
  setTimeout(function(){var input=document.getElementById('r-huevos');if(input)input.focus();},60);
}

function openPedido(id,clienteNombre){
  var ex=id?db.pedidos.find(function(p){return p.id===id;}):null;
  var precioIni=db.config.precio||'';
  function precioClientePorUnidad(nombre,unidad){
    var cliente=db.clientes.find(function(x){return x.nombre.trim().toLowerCase()===(nombre||'').trim().toLowerCase();});
    if(!cliente||!num(cliente.precio))return unidad==='Unidad'?num(db.config.precioUnidad):num(db.config.precio);
    if(unidad==='Unidad')return Math.round(num(cliente.precio)/pcBase());
    return Math.round(num(cliente.precio));
  }
  if(!ex&&clienteNombre){
    var cliPre=db.clientes.find(function(x){return x.nombre.trim().toLowerCase()===clienteNombre.trim().toLowerCase();});
    if(cliPre&&cliPre.precio)precioIni=cliPre.precio;
  }
  var p=ex||{cliente:clienteNombre||'',canastas:'',sueltos:'',precio:precioIni,fecha:hoy(),pago:'Pendiente',entrega:'Encargo',fechaEntrega:'',notas:''};
  var metodoPagoInicial=ex?(p.metodoPago||''):'Efectivo';
  var pc=ex?pcDe(ex):pcBase();
  var uni=ex?unidadDe(ex):{u:'Canasta',n:1};
  var huevosExistentes=ex?huevosPedido(ex):0;
  var cantidadInicial=ex&&uni.u==='Canasta'?Math.floor(huevosExistentes/pc):uni.n;
  var huevosSueltosIniciales=ex&&uni.u==='Canasta'?huevosExistentes%pc:0;
  var precioBase=ex?num(p.precio):clienteNombre?precioClientePorUnidad(clienteNombre,uni.u):(uni.u==='Unidad'?num(db.config.precioUnidad):num(db.config.precio));
  openSheet(ex?'Editar pedido':'Nuevo pedido',
    '<label class=\"f\"><span>Cliente *</span><input id=\"p-cli\" required autocomplete=\"off\" value=\"'+esc(p.cliente)+'\"></label>'+ 
    '<label class=\"f\"><span>Vendido por</span><select id=\"p-uni\">'+
      [['Canasta','Canasta ('+pc+' huevos)'],['Media','Media canasta ('+Math.round(pc/2)+' huevos)'],['Unidad','Unidad (huevo suelto)']].map(function(o){
        return '<option value=\"'+o[0]+'\"'+(o[0]===uni.u?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select></label>'+
    fld('p-cant',uni.u==='Canasta'?'Cantidad de canastas':(uni.u==='Media'?'Cantidad de medias canastas':'Cantidad de huevos'),'type=\"text\" inputmode=\"decimal\" autocomplete=\"off\"',cantidadInicial)+
    '<label class=\"f\" id=\"p-sueltos-wrap\"'+(uni.u==='Canasta'?'':' hidden')+'><span>Huevos sueltos adicionales</span><input id=\"p-sueltos\" type=\"text\" inputmode=\"numeric\" autocomplete=\"off\" value=\"'+huevosSueltosIniciales+'\"></label>'+
    fld('p-pre','Precio según la unidad','inputmode=\"numeric\" autocomplete=\"off\"',precioBase)+
    fld('p-fec','Fecha del pedido','type=\"date\"',p.fecha)+
    '<p class=\"lbl\">Pago</p>'+seg('s-pago',['Pendiente','Pagado'],p.pago)+
    '<label class=\"f\"><span>Forma de pago</span><select id=\"p-metodo\">'+
      (ex&&!ex.metodoPago?'<option value=\"\">No especificada</option>':'')+
      ['Efectivo','Transferencia','Mixto'].map(function(metodo){
        return '<option value=\"'+metodo+'\"'+(metodo===metodoPagoInicial?' selected':'')+'>'+metodo+'</option>';
      }).join('')+'</select></label>'+
    fld('p-efectivo','Abono en efectivo','inputmode=\"numeric\" autocomplete=\"off\"',ex?ex.montoEfectivo||'':'')+
    fld('p-transferencia','Abono por transferencia','inputmode=\"numeric\" autocomplete=\"off\"',ex?ex.montoTransferencia||'':'')+
    '<p class=\"hint\" style=\"margin-top:-6px\">Si paga una parte de cada forma, elige Mixto e indica ambos abonos.</p>'+
    '<p class=\"lbl\">Entrega</p>'+seg('s-ent',['Encargo','Entregado'],p.entrega)+
    fld('p-fent','Entregar el (opcional)','type=\"date\"',p.fechaEntrega)+
    fld('p-notas','Notas (opcional)','autocomplete=\"off\"',p.notas)+
    '<div class=\"prev\" id=\"prev\"></div><p class=\"err\" id=\"err\" role=\"alert\"></p>'+
    '<div class=\"btnrow\"><button class=\"btn\" data-do=\"save\">Guardar</button>'+(ex?'<button class=\"btn warn\" data-do=\"del\">Eliminar</button>':'')+'</div>');
  function calc(){
    var u=val('p-uni'), n=Math.max(0,Math.round(num(val('p-cant'))*100)/100), pr=Math.round(num(val('p-pre')));
    var huevosSueltos=u==='Canasta'?Math.max(0,Math.round(num(val('p-sueltos')))):0;
    var eggs=Math.max(0,Math.round(n*(u==='Canasta'?pc:(u==='Media'?pc/2:1)))+huevosSueltos);
    var total=u==='Unidad'?eggs*pr:eggs*pr/pc;
    return {u:u,n:n,pr:pr,eggs:eggs,c:Math.floor(eggs/pc),s:eggs%pc,total:Math.round(total/100)*100};
  }
  act.totalPedido=function(){return calc().total;};
  act.input=function(){
    var k=calc(), st=stock(ex&&ex.id);
    var metodo=val('p-metodo');
    document.getElementById('p-efectivo').parentNode.hidden=metodo!=='Efectivo'&&metodo!=='Mixto';
    document.getElementById('p-transferencia').parentNode.hidden=metodo!=='Transferencia'&&metodo!=='Mixto';
    var efectivo=Math.max(0,Math.round(num(val('p-efectivo'))));
    var transferencia=Math.max(0,Math.round(num(val('p-transferencia'))));
    var label=k.u==='Canasta'?(k.n===1?'canasta':'canastas'):(k.u==='Media'?(k.n===1?'media canasta':'medias canastas'):(k.n===1?'huevo':'huevos'));
    var h='<b>'+nf(k.n)+' '+label+'</b>'+
      (k.u==='Canasta'&&num(val('p-sueltos'))?' + '+nf(Math.round(num(val('p-sueltos'))))+' huevos sueltos':'')+
      ' = '+nf(k.eggs)+' huevos<br><b>'+moneyPedido(k.total)+'</b>';
    if(efectivo+transferencia>0){
      var detalleAbono=efectivo&&transferencia?
        ' ('+moneyPedido(efectivo)+' efectivo + '+moneyPedido(transferencia)+' transferencia)':
        ' ('+(efectivo?'efectivo':'transferencia')+')';
      h+='<br><span>Abono recibido: '+moneyPedido(efectivo+transferencia)+detalleAbono+'</span>';
    }
    if(segVal('s-ent')==='Entregado'&&k.eggs>st.libres)h+='<br><span class=\"warnt\">En el galpón hay '+nf(Math.max(0,st.libres))+' huevos libres, menos de los que vas a entregar.</span>';
    $('#prev').innerHTML=h;
  };
  act.input();
  document.getElementById('p-cli').addEventListener('input',function(){
    if(ex)return;
    var nom=this.value.trim(), cli=db.clientes.find(function(x){return x.nombre.trim().toLowerCase()===nom.toLowerCase();});
    var campoPrecio=document.getElementById('p-pre');
    if(cli&&campoPrecio){
      campoPrecio.value=precioClientePorUnidad(cli.nombre,val('p-uni')); act.input();
    }
  });
  document.getElementById('p-uni').addEventListener('change',function(){
    var u=this.value, c=document.getElementById('p-cant');
    c.value=1;
    c.parentNode.querySelector('span').textContent=u==='Canasta'?'Cantidad de canastas':(u==='Media'?'Cantidad de medias canastas':'Cantidad de huevos');
    document.getElementById('p-sueltos-wrap').hidden=u!=='Canasta';
    document.getElementById('p-sueltos').value=0;
    document.getElementById('p-pre').value=precioClientePorUnidad(val('p-cli'),u);
    act.input();
    if(u==='Unidad')c.focus();
  });
  document.getElementById('p-metodo').addEventListener('change',function(){
    var efectivo=document.getElementById('p-efectivo');
    var transferencia=document.getElementById('p-transferencia');
    if(this.value==='Efectivo')transferencia.value=0;
    else if(this.value==='Transferencia')efectivo.value=0;
    if(segVal('s-pago')==='Pagado'){
      var total=calc().total;
      efectivo.value=this.value==='Transferencia'?0:total;
      transferencia.value=this.value==='Transferencia'?total:0;
    }
    act.input();
  });
  act.save=function(){
    var k=calc();
    if(k.eggs<=0)return err('Escribe la cantidad que lleva el pedido.');
    if(!val('p-cli').trim())return err('Escribe el nombre del cliente.');
    var metodo=val('p-metodo');
    var efectivo=Math.max(0,Math.round(num(val('p-efectivo'))));
    var transferencia=Math.max(0,Math.round(num(val('p-transferencia'))));
    var abono=efectivo+transferencia;
    if(abono>k.total)return err('Los abonos no pueden superar el total del pedido.');
    if(!metodo&&abono>0)return err('Elige la forma de pago para registrar los abonos.');
    if(segVal('s-pago')==='Pagado'&&abono!==k.total&&!(ex&&!ex.metodoPago&&abono===0)){
      return err('Para marcarlo como pagado, los abonos deben completar el total.');
    }
    var pago=abono>=k.total?'Pagado':segVal('s-pago');
    var rec={id:ex?ex.id:uid(),cliente:val('p-cli').trim(),canastas:k.c,sueltos:k.s,unidad:k.u,cantidad:k.n,precio:Math.round(k.pr),pc:pc,total:Math.round(k.total),fecha:val('p-fec')||hoy(),
      pago:pago,metodoPago:metodo,montoEfectivo:metodo?efectivo:null,montoTransferencia:metodo?transferencia:null,
      entrega:segVal('s-ent'),fechaEntrega:val('p-fent'),notas:val('p-notas').trim()};
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
    var Capacitor=window.Capacitor, Filesystem=obtenerFilesystem();
    if(Capacitor&&Capacitor.isNativePlatform&&Capacitor.isNativePlatform()&&Filesystem){
      solicitarPermisoAlmacenamiento().then(function(ok){
        if(!ok)throw new Error('No se concedió permiso para guardar en Documentos.');
        return Filesystem.writeFile({
          path:nombre,
          data:txt,
          directory:'DOCUMENTS',
          encoding:'utf8',
          recursive:true
        });
      }).then(function(){
        toast('Copia guardada en Documentos del teléfono: '+nombre);
      }).catch(function(error){
        console.error('No se pudo guardar la copia en el teléfono:',error);
        toast('No se pudo guardar en Documentos. '+(error&&error.message?error.message:'Intenta copiar el texto.'));
      });
      return;
    }
    guardarEnCarpeta(nombre,blob).then(function(guardado){
      if(guardado){toast('Copia guardada en Mi Galpon.');return;}
      if(window.showSaveFilePicker){
        return window.showSaveFilePicker({suggestedName:nombre,types:[{description:'Copia de seguridad',accept:{'application/json':['.json']}}]})
          .then(function(handle){return handle.createWritable();})
          .then(function(writable){return writable.write(blob).then(function(){return writable.close();});})
          .then(function(){toast('Copia guardada en el dispositivo.');})
          .catch(function(error){
            if(error&&error.name==='AbortError')return;
            console.error('No se pudo guardar la copia:',error);
            toast('No se pudo guardar el archivo. Usa Copiar texto.');
          });
      }
      try{
        var a=document.createElement('a');
        a.href=URL.createObjectURL(blob);a.download=nombre;
        document.body.appendChild(a);a.click();a.remove();
        setTimeout(function(){URL.revokeObjectURL(a.href);},60000);
        toast('Copia descargada. Revisa la carpeta de descargas.');
      }catch(e){console.error('No se pudo descargar la copia:',e);toast('No se pudo descargar. Usa Copiar texto.');}
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


/* ---------- Eventos ---------- */
document.addEventListener('click',function(e){
  if(quickOpen&&!e.target.closest('#fabSlot .quick-bubble')){
    quickOpen=false;
    var bubble=document.querySelector('#fabSlot .quick-bubble');
    if(bubble){
      bubble.classList.remove('is-open');
      var quickButton=bubble.querySelector('[data-act="quick"]');
      if(quickButton)quickButton.textContent='+';
    }
  }
  var nav=e.target.closest('#nav button');
  if(nav){abrirVista(nav.dataset.tab);return;}

  var theme=e.target.closest('[data-theme-choice]');
  if(theme){
    var choice=theme.dataset.themeChoice;
    if(['Automático','Claro','Oscuro'].indexOf(choice)<0)return;
    try{localStorage.setItem('galpon_theme_preference',choice);}
    catch(error){console.error('No se pudo guardar la apariencia local:',error);toast('No se pudo guardar la apariencia en este dispositivo.');}
    aplicarTema();
    render();
    return;
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
    case 'fab':if(tab==='huevos')openRecogida(hoy());else if(tab==='pedidos')openPedido(null);else if(tab==='clientes')openClienteForm(null,null);break;
    case 'quick':quickOpen=!quickOpen;render();break;
    case 'quick-dia':quickOpen=false;render();setTimeout(function(){openDia(null);},80);break;
    case 'quick-pedido':quickOpen=false;render();setTimeout(function(){openPedido(null);},80);break;
    case 'quick-gasto':quickOpen=false;render();setTimeout(function(){openGasto();},80);break;
    case 'gasto-edit':openGasto(id);break;
    case 'periodo':{
      var siguiente=t.dataset.v;
      if(tab==='inicio')periodoInicio=periodoInicio===siguiente?'':siguiente;
      else if(tab==='huevos')periodoHuevos=periodoHuevos===siguiente?'':siguiente;
      else if(tab==='pedidos')periodoPedidos=periodoPedidos===siguiente?'':siguiente;
      else if(tab==='ventas')periodoVentas=periodoVentas===siguiente?'':siguiente;
      render();
      break;
    }
    case 'periodo-pagos':periodoPagos=periodoPagos===t.dataset.v?'':t.dataset.v;render();break;
    case 'toggle-config-galpon':configGalponAbierta=!configGalponAbierta;render();break;
    case 'toggle-gastos':gastosAbierta=!gastosAbierta;render();break;
    case 'settings-jump':
      if(t.dataset.target==='clientes'){abrirVista('clientes');}
      else {abrirAjustesSeccion(t.dataset.target);}
      break;
    case 'settings-back':history.back();break;
    case 'account-signout':
      window.dispatchEvent(new CustomEvent('galpon-account-action',{detail:{action:'sign-out'}}));break;
    case 'account-invite':{
      var inviteEmail=val('owner-invite-email').trim();
      if(!inviteEmail){toast('Escribe el correo del dueño para enviar la invitación.');break;}
      window.dispatchEvent(new CustomEvent('galpon-account-action',{detail:{action:'invite-owner',email:inviteEmail}}));break;
    }
    case 'filtro':filtro=filtro===t.dataset.v?'':t.dataset.v;render();break;
    case 'tog-pago':p=db.pedidos.find(function(x){return x.id===id;});if(p){
      p.pago=p.pago==='Pagado'?'Pendiente':'Pagado';
      if(p.pago==='Pagado'){
        var restante=Math.max(0,num(p.total)-montoRecibido(p));
        if(p.metodoPago==='Transferencia')p.montoTransferencia=num(p.montoTransferencia)+restante;
        else p.montoEfectivo=num(p.montoEfectivo)+restante;
      }else{
        p.montoEfectivo=0;
        p.montoTransferencia=0;
      }
      save();render();toast(p.pago==='Pagado'?'Marcado como pagado':'Marcado como por cobrar');
    }break;
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
    case 'backup':openBackup();break;
    case 'restore':openRestore();break;
    case 'importfile':openImportFile();break;
    case 'carpeta':solicitarPermisoAlmacenamiento().then(function(ok){if(ok)elegirCarpeta();});break;
    case 'reset':confirmSheet('¿Borrar todos los datos?','Se borran recogidas, pedidos y gallinas de este teléfono. Esto no se puede deshacer. Si no tienes una copia de seguridad, hazla antes.','Borrar todo',function(){
      db=defaults();save();tab='inicio';render();toast('Datos borrados');});break;
  }
});

var accionesLecturaDueno={
  'dia-view':true,'pedido-view':true,'cli-open':true,'clientes-ajustes':true,
  'clientes-atras':true,'periodo':true,'periodo-pagos':true,'toggle-config-galpon':true,
  'toggle-gastos':true,'settings-jump':true,'settings-back':true,'filtro':true,
  'backup':true,'carpeta':true,'account-signout':true
};
document.addEventListener('click',function(e){
  if(!galponSession||galponSession.role!=='owner')return;
  var target=e.target;
  if(target.closest('[data-theme-choice]'))return;
  var close=target.closest('#sheetRoot [data-close]');
  if(close)return;
  if(target.closest('#sheetRoot .seg button'))return;
  var action=target.closest('#view [data-act], #fabSlot [data-act]');
  if(action&&accionesLecturaDueno[action.dataset.act])return;
  var sheetAction=target.closest('#sheetRoot [data-do]');
  if(sheetAction&&['download','go','copy'].indexOf(sheetAction.dataset.do)>=0)return;
  if(target.closest('#nav button'))return;
  if(target.closest('#view button, #fabSlot button, #sheetRoot button')){
    e.preventDefault();
    e.stopImmediatePropagation();
    toast('La cuenta de dueño es de solo lectura.');
  }
},true);

document.addEventListener('change',function(e){
  if(e.target.closest('[data-theme-choice]'))return;
  if(galponSession&&galponSession.role==='owner'){
    if(e.target.closest('#view, #sheetRoot')){
      e.preventDefault();
      e.stopImmediatePropagation();
      toast('La cuenta de dueño es de solo lectura.');
    }
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
});

document.addEventListener('input',function(e){
  if(galponSession&&galponSession.role==='owner'&&e.target.closest('#view, #sheetRoot')&&
     !['pedidoSearch','clienteSearch'].includes(e.target.id)){
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  if(e.target && e.target.id==='pedidoSearch'){
    pedidoBuscar=e.target.value;
    if(tab==='pedidos'){
      var qPedido=pedidoBuscar.trim().toLowerCase();
      Array.prototype.forEach.call(document.querySelectorAll('#view [data-act="pedido-view"]'),function(item){
        item.hidden=!!qPedido&&item.dataset.filterText.toLowerCase().indexOf(qPedido)<0;
      });
    }
  }
  if(e.target && e.target.id==='clienteSearch'){
    clienteBuscar=e.target.value;
    if(tab==='clientes'){
      var qCliente=clienteBuscar.trim().toLowerCase();
      Array.prototype.forEach.call(document.querySelectorAll('#view [data-filter-text]'),function(item){
        item.hidden=!!qCliente&&item.dataset.filterText.toLowerCase().indexOf(qCliente)<0;
      });
      Array.prototype.forEach.call(document.querySelectorAll('#view .panel.list'),function(panel){
        var visibles=panel.querySelectorAll('[data-filter-text]:not([hidden])').length;
        panel.hidden=visibles===0;
        var encabezado=panel.previousElementSibling;
        if(encabezado&&(encabezado.matches('h2,.cap')))encabezado.hidden=visibles===0;
        if(encabezado&&encabezado.classList.contains('cap')&&encabezado.previousElementSibling){
          encabezado.previousElementSibling.hidden=visibles===0;
        }
      });
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
  }else if(history.state&&history.state.route){
    aplicarRuta(history.state.route);
  }else{
    var ruta={tab:'inicio',ajustesSeccion:null,scrollTop:0,clienteBuscar:'',periodoInicio:'',periodoHuevos:'',periodoPedidos:'',periodoVentas:'',periodoPagos:'',filtro:''};
    aplicarRuta(ruta);
    history.pushState({galponApp:true,route:ruta},document.title);
  }
});
document.addEventListener('backbutton',function(e){
  if(sheetOpen){
    if(e&&e.preventDefault)e.preventDefault();
    closeSheet();
  }else if(tab!=='inicio'||ajustesSeccion){
    if(e&&e.preventDefault)e.preventDefault();
    history.back();
  }
  return tab!=='inicio'||ajustesSeccion?false:true;
},true);
var root=$('#sheetRoot');
root.addEventListener('click',function(e){
  if(e.target.closest('[data-close]')){closeSheet();return;}
  var op=e.target.closest('[data-open-pedido]');
  if(op){openPedido(op.dataset.id);return;}
  var s=e.target.closest('.seg button');
  if(s){
    Array.prototype.forEach.call(s.parentNode.children,function(b){b.classList.toggle('on',b===s);b.setAttribute('aria-checked',b===s);});
    if(s.parentNode.id==='s-pago'&&s.dataset.v==='Pagado'){
      var metodo=val('p-metodo');
      var abonoActual=num(val('p-efectivo'))+num(val('p-transferencia'));
      if(abonoActual===0){
        var total=act.totalPedido?act.totalPedido():0;
        if(metodo==='Efectivo'||metodo==='Mixto')document.getElementById('p-efectivo').value=total;
        else if(metodo==='Transferencia')document.getElementById('p-transferencia').value=total;
      }
    }
    if(act.input)act.input();return;
  }
  var b=e.target.closest('[data-do]');
  if(b&&act[b.dataset.do])act[b.dataset.do]();
});
root.addEventListener('input',function(){if(act.input)act.input();});
window.galponApp={
  getData:function(){return db;},
  setSession:function(session){
    galponSession=session;
    galponWorkerCount=null;
    if(session)document.body.dataset.role=session.role;
    else delete document.body.dataset.role;
    remoteDataReady=false;
  },
  setWorkerCount:function(count){
    galponWorkerCount=count===null?null:Math.max(0,Math.floor(Number(count)||0));
    var countNode=document.getElementById('settingsWorkerCount');
    if(countNode)countNode.textContent=galponWorkerCount===null?'No disponible':galponWorkerCount+' '+(galponWorkerCount===1?'trabajador':'trabajadores');
  },
  setRemoteData:function(data,uid){
    if(!data||typeof data!=='object'||!Array.isArray(data.dias)||!Array.isArray(data.pedidos)||!Array.isArray(data.gallinas)){
      this.showCloudError('Los datos del galpón en Appwrite no tienen un formato válido.');
      return false;
    }
    var d=defaults();
    var incoming={
      config:Object.assign(d.config,data.config||{}),
      gallinas:data.gallinas,
      dias:data.dias,
      pedidos:data.pedidos,
      clientes:Array.isArray(data.clientes)?data.clientes:[],
      gastos:Array.isArray(data.gastos)?data.gastos:[]
    };
    var changed=JSON.stringify(db)!==JSON.stringify(incoming);
    if(changed)db=incoming;
    remoteDataReady=true;
    try{localStorage.setItem(KEY,JSON.stringify(db));}
    catch(error){console.error('No se pudo guardar la copia local:',error);}
    if(uid)window.dispatchEvent(new CustomEvent('galpon-data-cached',{detail:{data:db}}));
    if(changed)render();
    return true;
  },
  showCloudError:function(message){toast(message);}
};

solicitarPermisoAlmacenamiento().then(function(){return cargarCarpeta();}).then(function(){render();});
})();
