// GestorIA v1.5 · Escáner + fotos que nunca se pierden.
// Regla: ninguna foto se descarta. El original y el recorte se guardan en IndexedDB del aparato
// en cuanto se hace la foto, y solo se marcan "subidos" cuando el servidor confirma (sha256/tamaño).
// La copia local NO se borra nunca automáticamente.
const KEY='gestoria-v1';const CFG='gestoria-ocr-keys';const PEND='gestoria-docs-pendientes';const now=new Date();
const $=id=>document.getElementById(id);
const money=n=>(Number(n)||0).toLocaleString('es-ES',{style:'currency',currency:'EUR'});
const nid=()=>(crypto.randomUUID?crypto.randomUUID():'id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
const MAX_LADO=1600, CALIDAD_JPEG=0.8, LADO_TRABAJO=3200, LADO_DETECCION=480;
function load(){const raw=localStorage.getItem(KEY);return raw?JSON.parse(raw):{entidades:[{id:'e1',nif:'',nombre:'Mi actividad'}],docs:[],pagos:{},version:0};}
// Antes (v1.4) aquí se ponía archivo=null si la foto pasaba de 700.000 caracteres: se perdían casi todas.
// Ahora el estado ya no lleva fotos (van en IndexedDB) y nunca se borra nada.
function save(s){saveLocalOnly(s);pushState();}
function saveLocalOnly(s){try{localStorage.setItem(KEY,JSON.stringify(s||state));}catch(e){aviso('AVISO: no cabe el estado en este aparato ('+e.message+'). Las fotos siguen a salvo en el almacén local.');}}
function keys(){try{return JSON.parse(localStorage.getItem(CFG)||'{}');}catch(e){return {};}}
function saveKeys(){localStorage.setItem(CFG,JSON.stringify({mindee:$('keyMindee').value.trim(),space:$('keySpace').value.trim(),apiUrl:$('apiUrl').value.trim().replace(/\/$/,''),apiPin:$('apiPin').value.trim()}));localStorage.removeItem('gestoria-servidor-solo-file');$('keyMsg').textContent='Guardado en este aparato. Recarga para sincronizar.';}
function api(){const k=keys();return k.apiUrl&&k.apiPin?k:{};}
async function apiFetch(path,opts){const k=api();if(!k.apiUrl)return null;const headers=Object.assign({'x-pin':k.apiPin},(opts&&opts.headers)||{});return fetch(k.apiUrl+path,Object.assign({},opts||{},{headers:headers}));}
// fetch de una URL absoluta del servidor con el PIN (un <img src> no manda la cabecera x-pin -> 401).
function fetchConPin(url,opts){const k=api();const headers=Object.assign({},(opts&&opts.headers)||{});if(k.apiUrl&&String(url).indexOf(k.apiUrl)===0)headers['x-pin']=k.apiPin;return fetch(url,Object.assign({},opts||{},{headers:headers}));}
function aviso(msg){if($('ocrMsg'))$('ocrMsg').textContent=msg;}
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ---------- Documentos con cambios locales aún no confirmados por el servidor ----------
function docsPendientes(){try{return new Set(JSON.parse(localStorage.getItem(PEND)||'[]'));}catch(e){return new Set();}}
function marcarPendiente(id){const s=docsPendientes();s.add(id);localStorage.setItem(PEND,JSON.stringify([...s]));}
function limpiarPendientes(ids){const s=docsPendientes();ids.forEach(i=>s.delete(i));localStorage.setItem(PEND,JSON.stringify([...s]));}

async function pullState(){try{const r=await apiFetch('/api/state');if(!r)return;if(!r.ok){aviso('No se pudo sincronizar: API '+r.status);return;}const remote=await r.json();if(remote&&remote.docs){if(typeof remote.version!=='number')remote.version=0;
  // Fusión: lo guardado aquí y aún no confirmado por el servidor no se pisa con la versión remota.
  const pend=docsPendientes();let fusion=0;
  pend.forEach(id=>{const local=state.docs.find(d=>d.id===id);if(!local)return;const i=remote.docs.findIndex(d=>d.id===id);if(i>=0)remote.docs[i]=Object.assign({},remote.docs[i],local);else remote.docs.push(local);fusion++;});
  state=remote;saveLocalOnly();renderEnt();renderLista();render303();aviso('Sincronizado. v'+state.version+(fusion?' · '+fusion+' cambio(s) locales conservados':''));if(fusion)pushState();revisarHuerfanas();sincronizarImagenes();}}catch(e){aviso('No se pudo sincronizar: '+e.message);}}
let pushTimer=null,pushing=false;
function pushState(){const k=api();if(!k.apiUrl)return;clearTimeout(pushTimer);pushTimer=setTimeout(doPush,400);}
async function doPush(){if(pushing){pushState();return;}const k=api();if(!k.apiUrl)return;pushing=true;const sent=state.version||0;const enviados=[...docsPendientes()];try{const body=structuredClone(state);body.version=sent;/* versión esperada en el cuerpo (sin cabecera If-Match: el servidor de producción no la admite en CORS) */const r=await apiFetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(r.status===409){aviso('Otro aparato cambio los datos. Recargo y conservo lo de este aparato.');pushing=false;await pullState();return;}if(!r.ok){aviso('No se pudo guardar en el servidor: API '+r.status+'. Se reintentará.');return;}let j={};try{j=await r.json();}catch(e){}
state.version=typeof j.version==='number'?j.version:sent+1;limpiarPendientes(enviados);saveLocalOnly();aviso('Guardado. v'+state.version);}catch(e){aviso('Error al guardar: '+e.message+'. Se reintentará.');}finally{pushing=false;}}
let state=load(),archivoBlob=null,archivoNombre='',editId=null,captura=null;
if(typeof state.version!=='number')state.version=0;

// ---------- Almacén local de fotos (IndexedDB). Nunca se borra nada desde la app. ----------
const IDB_NAME='gestoria-imagenes',IDB_STORE='imagenes';let idbP=null;const memoria=new Map();
function idb(){if(!idbP)idbP=new Promise((res,rej)=>{if(!window.indexedDB)return rej(new Error('sin IndexedDB'));const r=indexedDB.open(IDB_NAME,1);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(IDB_STORE))db.createObjectStore(IDB_STORE,{keyPath:'id'});};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||new Error('IndexedDB'));});return idbP;}
function idbReq(mode,fn){return idb().then(db=>new Promise((res,rej)=>{const tx=db.transaction(IDB_STORE,mode);let out;const rq=fn(tx.objectStore(IDB_STORE));rq.onsuccess=()=>{out=rq.result;};tx.oncomplete=()=>res(out);tx.onerror=()=>rej(tx.error||new Error('IndexedDB'));tx.onabort=()=>rej(tx.error||new Error('IndexedDB abortado'));}));}
async function imgPut(rec){try{await idbReq('readwrite',st=>st.put(rec));memoria.delete(rec.id);}catch(e){memoria.set(rec.id,rec);aviso('AVISO: no pude guardar la foto en el almacén del aparato ('+e.message+'). No cierres la app hasta que diga "subida".');}}
async function imgGet(id){if(memoria.has(id))return memoria.get(id);try{return await idbReq('readonly',st=>st.get(id));}catch(e){return null;}}
async function imgAll(){let a=[];try{a=await idbReq('readonly',st=>st.getAll());}catch(e){}const ids=new Set(a.map(r=>r.id));memoria.forEach((r,id)=>{if(!ids.has(id))a.push(r);});return a;}
let persistPedida=false;function pedirPersistencia(){if(persistPedida)return;persistPedida=true;try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist();}catch(e){}}
function nuevoRegistro(o){return Object.assign({id:nid(),docId:null,creado:new Date().toISOString(),subido:false,intentos:0},o);}
async function sha256(blob){try{if(!crypto.subtle)return null;const h=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('');}catch(e){return null;}}
function refsDoc(d){const r=[d.imgId,d.imgOrigId];(d.historial||[]).forEach(h=>{r.push(h.imgId,h.imgOrigId);});return r.filter(Boolean);}
function docDeRegistro(id){return state.docs.find(d=>refsDoc(d).includes(id));}

// ---------- Subida con reintentos hasta que el servidor confirme ----------
let subiendo=false,estadoFotos={};
function espera(n,grande){return grande?6*3600000:Math.min(600000,10000*Math.pow(2,Math.min(n,6)));}
async function subirCampos(campos){const fd=new FormData();campos.forEach(c=>fd.append(c.campo,c.rec.blob,c.rec.nombre||'foto.jpg'));const r=await apiFetch('/api/upload',{method:'POST',body:fd});let j=null;try{j=await r.json();}catch(e){}return {r,j};}
async function confirmar(rec,info){const k=api();if(!info||!info.url)return 'sin respuesta';const url=k.apiUrl+info.url;const local=await sha256(rec.blob);
  if(info.sha256&&local){if(info.sha256!==local)return 'sha256 distinto';}
  else if(typeof info.size==='number'){if(info.size!==rec.blob.size)return 'tamaño distinto';}
  else{ // servidor antiguo: respondió 200 con id; compruebo que el archivo existe y, si se puede leer, su tamaño
    try{const h=await fetchConPin(url,{method:'HEAD'});const cl=h.headers.get('content-length');if(!h.ok)return 'no confirmado (HEAD '+h.status+')';if(cl!==null&&cl!==''&&Number(cl)!==rec.blob.size)return 'tamaño distinto en el servidor';}catch(e){return 'no confirmado: '+e.message;}}
  rec.subido=true;rec.remoto=url;rec.remotoId=info.id;rec.sha256=local;rec.subidoEn=new Date().toISOString();rec.error=null;await imgPut(rec);
  const d=docDeRegistro(rec.id);if(d){if(d.imgId===rec.id)d.archivo=url;if(d.imgOrigId===rec.id)d.archivoOriginal=url;(d.historial||[]).forEach(h=>{if(h.imgId===rec.id)h.archivo=url;if(h.imgOrigId===rec.id)h.archivoOriginal=url;});marcarPendiente(d.id);}
  return null;}
async function fallo(rec,msg){rec.intentos=(rec.intentos||0)+1;rec.error=msg;rec.proximo=Date.now()+espera(rec.intentos,rec.blob&&rec.blob.size>8*1024*1024&&/API (413|500)/.test(msg));await imgPut(rec);}
async function subirGrupo(g){const p=g.find(r=>r.rol==='principal'),o=g.find(r=>r.rol==='original');const campos=[];if(p)campos.push({campo:'file',rec:p});if(o)campos.push({campo:'original',rec:o});
  const SOLO='gestoria-servidor-solo-file';let soloFile=localStorage.getItem(SOLO)==='1';
  let {r,j}=soloFile?{r:{ok:false,status:0},j:null}:await subirCampos(campos);
  if(!r.ok&&(soloFile||campos.some(c=>c.campo==='original'))&&![401,403].includes(r.status)){
    if(!soloFile&&campos.length>1&&r.status>=400){localStorage.setItem(SOLO,'1');}
    // Servidor en producción (solo acepta el campo 'file'): de una en una, primero el recorte.
    // Si el original no cabe (límite 8 MB del servidor antiguo) sigue guardado en este aparato y se reintenta más espaciado.
    for(const c of campos){const x=await subirCampos([{campo:'file',rec:c.rec}]);if(!x.r.ok){await fallo(c.rec,'API '+x.r.status+(c.rec.blob.size>8*1024*1024?' (original de más de 8 MB: queda guardado en este aparato)':''));continue;}const e=await confirmar(c.rec,x.j);if(e)await fallo(c.rec,e);}return;}
  if(!r.ok){for(const c of campos)await fallo(c.rec,'API '+r.status+(r.status===413?' (demasiado grande para el servidor)':''));return;}
  const files=(j&&j.files)||{};
  for(const c of campos){const info=c.campo==='file'?(files.file||j):files.original;const e=await confirmar(c.rec,info);if(e)await fallo(c.rec,e);}}
async function sincronizarImagenes(forzar){if(!api().apiUrl||subiendo){await infoSync();return;}subiendo=true;let hubo=false;
  try{const recs=(await imgAll()).filter(r=>r.rol!=='cache'&&!r.subido&&docDeRegistro(r.id)&&(forzar||!r.proximo||r.proximo<=Date.now()));
    const grupos={};recs.forEach(r=>{const g=r.captura||r.id;(grupos[g]=grupos[g]||[]).push(r);});
    for(const g of Object.values(grupos)){hubo=true;try{await subirGrupo(g);}catch(e){for(const r of g)await fallo(r,e.message);}}
  }finally{subiendo=false;if(hubo){save(state);renderLista();}await infoSync();}}
async function infoSync(){const recs=(await imgAll()).filter(r=>r.rol!=='cache'&&docDeRegistro(r.id));estadoFotos={};
  recs.forEach(r=>{const d=docDeRegistro(r.id);if(!d)return;const e=estadoFotos[d.id]||{pend:0,ok:0,error:''};if(r.subido)e.ok++;else{e.pend++;if(r.error)e.error=r.error;}estadoFotos[d.id]=e;});
  const pend=recs.filter(r=>!r.subido).length,box=$('syncInfo');if(!box)return;
  if(!recs.length)box.textContent='';
  else if(!api().apiUrl)box.textContent=recs.length+' foto(s) guardadas solo en este aparato (no hay servidor configurado).';
  else box.textContent=pend?pend+' foto(s) guardadas en este aparato, pendientes de subir. Se reintenta solo.':'Todas las fotos están confirmadas en el servidor (y siguen también en este aparato).';
  $('syncBtn').classList.toggle('hidden',!(pend&&api().apiUrl));renderLista();}

// ---------- Fotos guardadas que no están en ningún documento: se ofrecen para recuperar ----------
let huerfanas=[];
async function revisarHuerfanas(){const actual=new Set(captura?[captura.originalId,captura.principalId]:[]);huerfanas=(await imgAll()).filter(r=>r.rol!=='cache'&&!actual.has(r.id)&&!docDeRegistro(r.id));const b=$('recuperar');if(!b)return;const n=new Set(huerfanas.map(r=>r.captura||r.id)).size;b.classList.toggle('hidden',!n);$('recuperarTxt').textContent='Hay '+n+' foto(s) guardadas en este aparato que no están en ningún documento.';}
async function recuperarHuerfanas(){const grupos={};huerfanas.forEach(r=>{const g=r.captura||r.id;(grupos[g]=grupos[g]||[]).push(r);});
  for(const g of Object.values(grupos)){const p=g.find(r=>r.rol==='principal')||g[0],o=g.find(r=>r.rol==='original')||p;const id=nid();
    state.docs.push({id,entidadId:(state.entidades[0]||{}).id||'',tipo:'recibida',nif:'',nombre:'Foto recuperada',numero:'',fecha:(p.creado||'').slice(0,10),base:'',ivaTipo:'21',cuota:'',total:'',imgId:p.id,imgOrigId:o.id,archivoNombre:p.nombre||'',estado:'revisar'});
    for(const r of g){r.docId=id;await imgPut(r);}marcarPendiente(id);}
  save(state);renderLista();await revisarHuerfanas();sincronizarImagenes(true);}

// Fotos antiguas (v1.4) guardadas como data: dentro del estado -> también al almacén y a la cola de subida.
async function migrarDataUrls(){let n=0;for(const d of state.docs){if(d.archivo&&String(d.archivo).indexOf('data:')===0&&!d.imgId){try{const blob=await (await fetch(d.archivo)).blob();const rec=nuevoRegistro({captura:nid(),docId:d.id,rol:'principal',blob,nombre:d.archivoNombre||'documento',tipo:blob.type,tam:blob.size,migrado:true});await imgPut(rec);d.imgId=rec.id;marcarPendiente(d.id);n++;}catch(e){}}}if(n)saveLocalOnly();}
function es3T(f){if(!f)return false;const[y,m]=f.split('-').map(Number);return y===2026&&m>=7&&m<=9;}
function clock(){const d=new Date('2026-10-15T23:59:59'),p=new Date('2026-10-20T23:59:59');const via=now<=d?'Aun cabe domiciliar (hasta el 15 de octubre).':now<=p?'Ya no cabe domiciliar. Paga y guarda el NRC.':'Fuera de plazo voluntario del 3T.';$('clock').innerHTML='<b>3T 2026 · IVA</b><p>Domiciliacion: 15 oct · Presentacion: 20 oct.<br>'+via+'</p>';if($('viaPago'))$('viaPago').textContent=via;}
function fillEnt(sel){if(!sel)return;sel.innerHTML=state.entidades.map(e=>'<option value="'+e.id+'">'+(e.nombre||'Sin nombre')+(e.nif?' · '+e.nif:'')+'</option>').join('');}
function renderEnt(){fillEnt($('entidad'));fillEnt($('entidad303'));$('listaEnt').innerHTML=state.entidades.map(e=>'<div class="item"><div><b>'+e.nombre+'</b><br><small>'+(e.nif||'Sin NIF')+'</small></div><button class="btn ghost" data-del-ent="'+e.id+'">Quitar</button></div>').join('');}
function cuadran(d){const b=+d.base||0,c=+d.cuota||0,t=+d.total||0;if(!t&&!b)return false;return Math.abs(b+c-t)<0.05;}
function duplicado(doc,ignoreId){if(!doc.nif||!doc.numero)return false;return state.docs.some(d=>d.id!==ignoreId&&d.estado!=='rechazado'&&d.nif.replace(/\s/g,'').toUpperCase()===doc.nif.replace(/\s/g,'').toUpperCase()&&d.numero.trim().toUpperCase()===doc.numero.trim().toUpperCase());}
function badgeFoto(d){const e=estadoFotos[d.id];if(e){if(e.pend)return ' · <span class="foto pend" title="'+esc(e.error||'')+'">foto en el aparato, pendiente de subir</span>';return ' · <span class="foto ok">foto subida ✓</span>';}return d.archivo?' · <span class="foto ok">foto en servidor</span>':'';}
function renderLista(){const orden=[...state.docs].sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));$('lista').innerHTML=orden.map(d=>{const ent=state.entidades.find(e=>e.id===d.entidadId);return '<div class="item"><div><span class="st '+esc(d.estado)+'">'+esc(d.estado)+'</span><b> '+esc(d.nombre||d.nif||'Sin nombre')+'</b><br><small>'+esc(ent?ent.nombre:'')+' · '+esc(d.tipo)+' · '+esc(d.fecha||'')+' · '+money(d.total)+badgeFoto(d)+'</small></div><div><button class="btn ghost" data-edit="'+esc(d.id)+'">Abrir</button>'+(d.estado!=='validado'?'<button class="btn ok" data-val="'+esc(d.id)+'">Validar</button>':'')+'</div></div>';}).join('')||'<p class="muted">Aun no hay documentos.</p>';}
function resumen303(id){const pendientes=state.docs.filter(d=>d.entidadId===id&&['recibido','leyendo','revisar'].includes(d.estado));const vals=state.docs.filter(d=>d.entidadId===id&&d.estado==='validado'&&es3T(d.fecha));const rec=vals.filter(d=>d.tipo==='recibida'),emi=vals.filter(d=>d.tipo==='emitida');const sum=(a,k)=>a.reduce((x,d)=>x+(+d[k]||0),0);return{pendientes,cuotaS:sum(rec,'cuota'),cuotaR:sum(emi,'cuota')};}
function render303(){if(!$('entidad303'))return;const id=$('entidad303').value;const r=resumen303(id);const res=r.cuotaR-r.cuotaS;$('kpi').innerHTML='<div><b>'+money(r.cuotaR)+'</b><span>IVA repercutido</span></div><div><b>'+money(r.cuotaS)+'</b><span>IVA soportado</span></div><div><b>'+money(res)+'</b><span>'+(res>=0?'A ingresar':'A compensar')+'</span></div>';const box=$('bloque303');if(r.pendientes.length){box.className='warnbox';box.textContent='Hay '+r.pendientes.length+' documento(s) sin validar.';box.classList.remove('hidden');$('cerrarBtn').disabled=true;}else{box.className='okbox';box.textContent='Puedes autorizar si el importe es correcto.';box.classList.remove('hidden');$('cerrarBtn').disabled=false;}const pago=state.pagos[id+'-2026-3T'];$('pagoMsg').textContent=pago?'Autorizado. NRC: '+(pago.nrc||'no indicado'):'';}
function fillForm(d){editId=d?d.id:null;captura=null;archivoBlob=null;$('entidad').value=(d&&d.entidadId)||(state.entidades[0]&&state.entidades[0].id)||'';$('tipo').value=(d&&d.tipo)||'recibida';$('nif').value=(d&&d.nif)||'';$('nombre').value=(d&&d.nombre)||'';$('numero').value=(d&&d.numero)||'';$('fecha').value=(d&&d.fecha)||'';$('base').value=(d&&d.base)||'';$('ivaTipo').value=(d&&d.ivaTipo)||'21';$('cuota').value=(d&&d.cuota)||'';$('total').value=(d&&d.total)||'';previewDoc(d);revisarHuerfanas();}
// ---------- Vista previa: siempre desde un blob (local o descargado con el PIN) ----------
let previewUrls=[];
function pintarPreview(blob,orig){const box=$('preview');previewUrls.forEach(u=>URL.revokeObjectURL(u));previewUrls=[];if(!blob){box.innerHTML='';return;}const u=URL.createObjectURL(blob);previewUrls.push(u);const pdf=(blob.type||'').indexOf('pdf')>=0;let h=pdf?'<embed src="'+u+'" type="application/pdf" height="200">':'<img src="'+u+'" alt="doc">';if(orig&&orig!==blob){const uo=URL.createObjectURL(orig);previewUrls.push(uo);h+='<a class="btn ghost" href="'+uo+'" target="_blank" rel="noopener">Ver foto original</a>';}box.innerHTML=h;}
async function blobDeUrl(url){if(!url)return null;if(String(url).indexOf('data:')===0)return (await fetch(url)).blob();const cid='url:'+url;const c=await imgGet(cid);if(c&&c.blob)return c.blob;const r=await fetchConPin(url);if(!r.ok)throw new Error(r.status===401?'PIN incorrecto o falta (401)':'API '+r.status);const b=await r.blob();await imgPut({id:cid,rol:'cache',docId:null,blob:b,remoto:url,subido:true,creado:new Date().toISOString()});return b;}
async function previewDoc(d){if(!d){pintarPreview(null);return;}try{let p=d.imgId?await imgGet(d.imgId):null,o=d.imgOrigId&&d.imgOrigId!==d.imgId?await imgGet(d.imgOrigId):null;let pb=p&&p.blob,ob=o&&o.blob;if(!pb&&d.archivo)pb=await blobDeUrl(d.archivo);if(!ob&&d.archivoOriginal&&d.archivoOriginal!==d.archivo){try{ob=await blobDeUrl(d.archivoOriginal);}catch(e){}}if(editId!==d.id)return;archivoBlob=pb||null;archivoNombre=d.archivoNombre||'';pintarPreview(pb,ob);if(!pb&&!d.archivo)$('preview').innerHTML='<p class="muted">Sin foto.</p>';}catch(e){$('preview').innerHTML='<p class="muted">No pude mostrar la foto: '+esc(e.message)+'</p>';}}
function recalc(){const base=Number($('base').value),tipo=Number($('ivaTipo').value);if(!Number.isNaN(base)&&$('base').value!==''){const cuota=Math.round(base*tipo)/100;if(!$('cuota').matches(':focus'))$('cuota').value=cuota.toFixed(2);if(!$('total').matches(':focus'))$('total').value=(base+Number($('cuota').value||cuota)).toFixed(2);}}
function ymd(s){if(!s)return '';const d=String(s).slice(0,10);if(/^[0-9]{4}-/.test(d))return d;const m=d.match(/([0-9]{1,2})[\/\-.]([0-9]{1,2})[\/\-.]([0-9]{2,4})/);if(!m)return '';const y=m[3].length===2?'20'+m[3]:m[3];return y+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');}
function applyMindee(doc){const p=(doc.inference&&doc.inference.prediction)||{};function val(k){return p[k]&&p[k].value!=null?p[k].value:'';}if(val('supplier_company_registration'))$('nif').value=String(val('supplier_company_registration')).toUpperCase();if(val('supplier_name'))$('nombre').value=val('supplier_name');if(val('invoice_number'))$('numero').value=val('invoice_number');if(val('invoice_date'))$('fecha').value=ymd(val('invoice_date'));if(val('total_net'))$('base').value=Number(val('total_net')).toFixed(2);if(val('total_tax'))$('cuota').value=Number(val('total_tax')).toFixed(2);if(val('total_amount'))$('total').value=Number(val('total_amount')).toFixed(2);const taxes=p.taxes||[];if(taxes[0]&&taxes[0].rate!=null)$('ivaTipo').value=String(Math.round(taxes[0].rate));$('ocrRaw').value=JSON.stringify(p,null,2);}
function leerCamposDeTexto(text){$('ocrRaw').value=text||'';const t=(text||'').replace(/\s+/g,' ');const nif=t.match(/\b([0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z]|[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J])\b/i);const fecha=t.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);const tot=t.match(/(?:total|importe)[^0-9]{0,14}(\d+[.,]\d{2})/i);const base=t.match(/base[^0-9]{0,16}(\d+[.,]\d{2})/i);if(nif)$('nif').value=nif[1].toUpperCase();if(fecha)$('fecha').value=ymd(fecha[1]+'/'+fecha[2]+'/'+fecha[3]);if(base)$('base').value=base[1].replace(',','.');if(tot)$('total').value=tot[1].replace(',','.');recalc();}
async function mindeeRead(blob,token){const fd=new FormData();fd.append('document',blob,archivoNombre||'factura.pdf');const r=await fetch('https://api.mindee.net/v1/products/mindee/invoices/v4/predict',{method:'POST',headers:{Authorization:'Token '+token},body:fd});const j=await r.json();if(!r.ok)throw new Error((j.api_request&&j.api_request.error&&j.api_request.error.message)||('Mindee '+r.status));return j.document;}
async function spaceRead(blob,token){const fd=new FormData();fd.append('file',blob,archivoNombre||'doc.jpg');fd.append('apikey',token);fd.append('language','spa');fd.append('OCREngine','2');const r=await fetch('https://api.ocr.space/parse/image',{method:'POST',body:fd});const j=await r.json();if(j.IsErroredOnProcessing)throw new Error(j.ErrorMessage||'OCR.space');return ((j.ParsedResults||[])[0]||{}).ParsedText||'';}
async function ocr(){if(!archivoBlob){$('ocrMsg').textContent='Primero elige un archivo.';return;}const k=keys();$('ocrMsg').textContent='Leyendo...';try{if(k.mindee){try{const doc=await mindeeRead(archivoBlob,k.mindee);applyMindee(doc);$('ocrMsg').textContent='Leido con Mindee. Revisa y valida.';return;}catch(e){$('ocrMsg').textContent='Mindee: '+e.message+'. Pruebo reserva...';}}if(k.space){const text=await spaceRead(archivoBlob,k.space);leerCamposDeTexto(text);$('ocrMsg').textContent='Leido con OCR.space. Revisa campos.';return;}if(!k.mindee&&!k.space){$('ocrMsg').textContent='Pon una clave en la pestana Lector.';return;}$('ocrMsg').textContent='No pude llamar al lector.';}catch(e){$('ocrMsg').textContent='Fallo: '+e.message;}}
function guardarDoc(){guardar().catch(e=>aviso('Error al guardar: '+e.message));}
async function guardar(){const prev=state.docs.find(d=>d.id===editId);const doc={id:editId||nid(),entidadId:$('entidad').value,tipo:$('tipo').value,nif:$('nif').value.trim().toUpperCase(),nombre:$('nombre').value.trim(),numero:$('numero').value.trim(),fecha:$('fecha').value,base:$('base').value,ivaTipo:$('ivaTipo').value,cuota:$('cuota').value,total:$('total').value,estado:'revisar'};
  if(captura){const c=captura;doc.imgId=c.principalId||c.originalId;doc.imgOrigId=c.originalId;doc.archivoNombre=c.nombre;doc.recorte=c.recorte||null;doc.archivo=null;doc.archivoOriginal=null;
    // Si el documento ya tenía foto, la anterior se conserva en el historial (no se pierde).
    if(prev&&(prev.imgId||prev.archivo))doc.historial=(prev.historial||[]).concat([{imgId:prev.imgId||null,imgOrigId:prev.imgOrigId||null,archivo:prev.archivo||null,archivoOriginal:prev.archivoOriginal||null,hasta:new Date().toISOString()}]);
    for(const id of new Set([c.originalId,c.principalId].filter(Boolean))){const r=await imgGet(id);if(r){r.docId=doc.id;await imgPut(r);}}
    captura=null;}
  if(duplicado(doc,doc.id))doc.estado='duplicado';const i=state.docs.findIndex(d=>d.id===doc.id);if(i>=0)state.docs[i]=Object.assign({},state.docs[i],doc);else state.docs.push(doc);marcarPendiente(doc.id);save(state);editId=doc.id;renderLista();$('ocrMsg').textContent=doc.estado==='duplicado'?'Duplicado.':'Guardado.';sincronizarImagenes(true);}
function setEstado(id,estado){const d=state.docs.find(x=>x.id===id);if(!d)return;if(estado==='validado'){if(!cuadran(d)||!d.fecha||!d.total){alert('No se puede validar.');return;}d.estado='validado';}else d.estado=estado;marcarPendiente(d.id);save(state);renderLista();render303();}

// ---------- Captura: original a salvo al instante, luego escáner ----------
function esImagen(f){return /^image\//.test(f.type||'')||/\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(f.name||'');}
function nombreJpg(n,sufijo){return String(n||'foto').replace(/\.[^.]+$/,'')+'-'+sufijo+'.jpg';}
async function leerFile(file){if(!file)return;archivoNombre=file.name||'foto.jpg';const capId=nid();const img=esImagen(file);
  // 1) El original, tal cual, al almacén local antes de hacer nada más.
  const orig=nuevoRegistro({captura:capId,rol:img?'original':'principal',blob:file,nombre:archivoNombre,tipo:file.type||'',tam:file.size});
  await imgPut(orig);pedirPersistencia();
  captura={id:capId,originalId:orig.id,principalId:img?null:orig.id,nombre:archivoNombre,recorte:null};
  if(!img){archivoBlob=file;pintarPreview(file);ocr();return;}
  // 2) Escáner (si algo falla, se usa la foto original: nunca bloquea).
  let res=null;try{res=await abrirEscaner(file);}catch(e){aviso('No pude preparar la foto ('+e.message+'). Se usa la foto original tal cual.');}
  if(!captura||captura.id!==capId)return;
  if(!res){orig.rol='principal';orig.tambienOriginal=true;await imgPut(orig);captura.principalId=orig.id;archivoBlob=file;pintarPreview(file);ocr();return;}
  const rec=nuevoRegistro({captura:capId,rol:'principal',blob:res.blob,nombre:nombreJpg(archivoNombre,res.modo==='recorte'?'recorte':'reducida'),tipo:'image/jpeg',tam:res.blob.size,recorte:{modo:res.modo,puntos:res.puntos}});
  await imgPut(rec);captura.principalId=rec.id;captura.recorte=rec.recorte;archivoBlob=res.blob;archivoNombre=rec.nombre;pintarPreview(res.blob,file);
  aviso((res.modo==='recorte'?'Recortado':'Foto completa')+' · '+Math.round(res.blob.size/1024)+' KB (original guardado también, '+Math.round(file.size/1024)+' KB).');ocr();}

// ---------- Editor de esquinas ----------
function cargarImagen(blob){return new Promise((res,rej)=>{const u=URL.createObjectURL(blob);const im=new Image();im.onload=()=>res({im,u});im.onerror=()=>{URL.revokeObjectURL(u);rej(new Error('formato de imagen no soportado por este navegador'));};im.src=u;});}
function lienzo(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function aBlob(c,q){return new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('no se pudo generar JPEG')),'image/jpeg',q));}
async function abrirEscaner(file){const {im,u}=await cargarImagen(file);try{
  const iw=im.naturalWidth,ih=im.naturalHeight;if(!iw||!ih)throw new Error('imagen vacía');
  const f=Math.min(1,LADO_TRABAJO/Math.max(iw,ih));const src=lienzo(Math.round(iw*f),Math.round(ih*f));const sctx=src.getContext('2d');sctx.drawImage(im,0,0,src.width,src.height);
  let det={ok:false,puntos:[{x:0.05,y:0.05},{x:0.95,y:0.05},{x:0.95,y:0.95},{x:0.05,y:0.95}],motivo:'detector no disponible'};
  if(window.Escaner){try{const g=Math.min(1,LADO_DETECCION/Math.max(src.width,src.height));const sm=lienzo(Math.max(16,Math.round(src.width*g)),Math.max(16,Math.round(src.height*g)));const c2=sm.getContext('2d');c2.drawImage(src,0,0,sm.width,sm.height);det=Escaner.detectar(c2.getImageData(0,0,sm.width,sm.height).data,sm.width,sm.height);}catch(e){det.motivo=e.message;}}
  return await editorEsquinas(src,det);}finally{URL.revokeObjectURL(u);}}
function editorEsquinas(src,det){return new Promise((resolve)=>{const m=$('escaner'),wrap=$('escWrap'),cv=$('escCanvas'),poly=$('escPoly');
  let pts=det.puntos.map(p=>({x:p.x,y:p.y}));
  const maxW=Math.min(900,window.innerWidth-60),maxH=window.innerHeight*0.6,s=Math.min(maxW/src.width,maxH/src.height,1);
  cv.width=Math.round(src.width*s);cv.height=Math.round(src.height*s);cv.getContext('2d').drawImage(src,0,0,cv.width,cv.height);wrap.style.width=cv.width+'px';wrap.style.height=cv.height+'px';
  const hs=[...wrap.querySelectorAll('.esq')];
  function dibujar(){hs.forEach((h,i)=>{h.style.left=(pts[i].x*100)+'%';h.style.top=(pts[i].y*100)+'%';});poly.setAttribute('points',pts.map(p=>(p.x*1000).toFixed(1)+','+(p.y*1000).toFixed(1)).join(' '));}
  $('escMsg').textContent=det.ok?'Documento detectado. Ajusta las esquinas si hace falta.':'No he encontrado bien el borde ('+(det.motivo||'')+'). Arrastra las 4 esquinas o usa la foto completa.';
  $('escRecortar').disabled=!window.Escaner;
  hs.forEach((h,i)=>{h.onpointerdown=e=>{e.preventDefault();h.setPointerCapture(e.pointerId);h.classList.add('drag');};
    h.onpointermove=e=>{if(!h.hasPointerCapture(e.pointerId))return;const r=wrap.getBoundingClientRect();pts[i]={x:Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),y:Math.min(1,Math.max(0,(e.clientY-r.top)/r.height))};dibujar();};
    h.onpointerup=h.onpointercancel=e=>{h.classList.remove('drag');try{h.releasePointerCapture(e.pointerId);}catch(x){}};});
  dibujar();m.classList.remove('hidden');
  const cerrar=r=>{m.classList.add('hidden');resolve(r);};
  async function completa(){try{const g=Math.min(1,MAX_LADO/Math.max(src.width,src.height));const c=lienzo(Math.round(src.width*g),Math.round(src.height*g));c.getContext('2d').drawImage(src,0,0,c.width,c.height);cerrar({modo:'completa',blob:await aBlob(c,CALIDAD_JPEG),puntos:null});}catch(e){cerrar(null);}}
  $('escCompleta').onclick=completa;
  $('escAuto').onclick=()=>{pts=det.puntos.map(p=>({x:p.x,y:p.y}));dibujar();};
  $('escRecortar').onclick=async()=>{try{$('escMsg').textContent='Recortando...';await new Promise(r=>setTimeout(r,30));
      const q=Escaner.ordenar(pts.map(p=>({x:p.x*src.width,y:p.y*src.height})));const t=Escaner.tamanoSalida(q,MAX_LADO,src.width,src.height);if(t.w<40||t.h<40)throw new Error('recorte demasiado pequeño');
      const sd=src.getContext('2d').getImageData(0,0,src.width,src.height);const out=Escaner.enderezar(sd.data,src.width,src.height,q,t.w,t.h);
      const c=lienzo(t.w,t.h);c.getContext('2d').putImageData(new ImageData(out,t.w,t.h),0,0);
      cerrar({modo:'recorte',blob:await aBlob(c,CALIDAD_JPEG),puntos:q.map(p=>({x:+(p.x/src.width).toFixed(4),y:+(p.y/src.height).toFixed(4)}))});}
    catch(e){$('escMsg').textContent='No pude recortar ('+e.message+'). Ajusta las esquinas o usa la foto completa.';}};
});}
$('pickBtn').onclick=function(){$('file').click();};
$('file').onchange=function(e){const f=e.target.files[0];e.target.value='';leerFile(f).catch(x=>aviso('Error: '+x.message));};
$('drop').addEventListener('dragover',e=>e.preventDefault());
$('drop').addEventListener('drop',e=>{e.preventDefault();leerFile(e.dataTransfer.files[0]).catch(x=>aviso('Error: '+x.message));});
$('base').addEventListener('input',recalc);$('ivaTipo').addEventListener('change',recalc);
$('ocrBtn').onclick=ocr;$('saveBtn').onclick=guardarDoc;$('saveKeys').onclick=saveKeys;
$('syncBtn').onclick=function(){sincronizarImagenes(true);};$('recuperarBtn').onclick=function(){recuperarHuerfanas();};
$('addEnt').onclick=function(){const nombre=$('enNom').value.trim();if(!nombre)return;state.entidades.push({id:nid(),nif:$('enNif').value.trim().toUpperCase(),nombre:nombre});$('enNif').value='';$('enNom').value='';save(state);renderEnt();};
$('lista').addEventListener('click',function(e){if(e.target.dataset.edit)fillForm(state.docs.find(d=>d.id===e.target.dataset.edit));if(e.target.dataset.val)setEstado(e.target.dataset.val,'validado');});
$('entidad303').addEventListener('change',render303);
$('cerrarBtn').onclick=function(){const id=$('entidad303').value;const r=resumen303(id);if(r.pendientes.length)return;if(!$('autorizo').checked){alert('Marca la autorizacion.');return;}const nrc=$('nrc').value.trim().toUpperCase();if(nrc&&nrc.length!==22){alert('NRC: 22 caracteres.');return;}state.pagos[id+'-2026-3T']={cuando:new Date().toISOString(),nrc:nrc,importe:r.cuotaR-r.cuotaS,autorizado:true};save(state);render303();};
document.querySelectorAll('.tabs button').forEach(function(b){b.onclick=function(){document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('on'));b.classList.add('on');['docs','trimestre','entidades','config'].forEach(t=>$('tab-'+t).classList.toggle('hidden',b.dataset.tab!==t));if(b.dataset.tab==='trimestre')render303();if(b.dataset.tab==='config'){const k=keys();$('keyMindee').value=k.mindee||'';$('keySpace').value=k.space||'';$('apiUrl').value=k.apiUrl||'';$('apiPin').value=k.apiPin||'';}};});
window.addEventListener('online',()=>sincronizarImagenes(true));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')sincronizarImagenes();});
setInterval(()=>sincronizarImagenes(),30000);
clock();renderEnt();renderLista();render303();
migrarDataUrls().then(()=>{revisarHuerfanas();infoSync();pullState();sincronizarImagenes();});
