// Avisos al móvil: mira qué capítulos de tus series en «Viendo» han salido desde la última
// comprobación y manda un aviso a la app (web push). Lo ejecuta GitHub Actions cada media hora.
// Los registros de Actions son públicos: aquí no se imprime ningún título ni dato de la lista.
import fs from 'node:fs';

const GIST_ID = process.env.GIST_ID;
const PRUEBA = process.env.PRUEBA === 'true';
const APP = 'https://samuelmorenogoomez.github.io/mis-animes/';
const ESTADO = 'estado/ultimo.json';

const VAPID_PUBLIC = 'BGrRhMJK1bwbbk-BGlknQgYEjsYL2PCmVmocxXHnPMoAOlMEkslhVxHOEmkU2kPLFaHuoAU7Zyv_59iRhgvDYnA';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;

if (!GIST_ID) { console.log('Falta el secreto GIST_ID'); process.exit(1); }

// avisos directos a la app (web push), si está la clave
let webpush = null;
if (VAPID_PRIVATE) {
  webpush = (await import('web-push')).default;
  webpush.setVapidDetails(APP, VAPID_PUBLIC, VAPID_PRIVATE);
}
let aparatos = [];
const cuenta = { push: 0, pushFallos: 0 };

async function avisar(title, message, icon, tag) {
  for (const s of aparatos) {
    try {
      await webpush.sendNotification(s, JSON.stringify({ title, body: message, icon, tag, url: APP }), { TTL: 6 * 3600 });
      cuenta.push++;
    } catch (e) { cuenta.pushFallos++; }
  }
}

const ahora = Math.floor(Date.now() / 1000);
let desde = ahora - 3600;
try { desde = JSON.parse(fs.readFileSync(ESTADO, 'utf8')).ultimo || desde; } catch {}
if (ahora - desde > 2 * 86400) desde = ahora - 2 * 86400; // si estuvo parado mucho tiempo, no avisar de todo de golpe

// la lista, desde el gist secreto (enlace directo; si falla, por la API)
async function leerLista() {
  const raw = await fetch(`https://gist.githubusercontent.com/Samuelmorenogoomez/${GIST_ID}/raw/mis-animes.json?t=${Date.now()}`);
  if (raw.ok) return JSON.parse(await raw.text());
  const g = await fetch('https://api.github.com/gists/' + GIST_ID, { headers: { Accept: 'application/vnd.github+json' } });
  if (!g.ok) throw new Error('No se pudo leer la lista: ' + raw.status + '/' + g.status);
  const f = (await g.json()).files?.['mis-animes.json'];
  if (!f) throw new Error('La nota no tiene la lista');
  return JSON.parse(f.truncated ? await (await fetch(f.raw_url)).text() : f.content);
}
let db;
try { db = await leerLista(); } catch (e) { console.log(e.message); process.exit(1); }

if (webpush) aparatos = Object.values(db.push || {}).filter(x => x && x.sub && !x.off).map(x => x.sub);

if (PRUEBA) {
  await avisar('Mis animes y mangas', 'Los avisos funcionan. Te llegará uno así cada vez que salga un capítulo de lo que estás viendo.');
  console.log('Aviso de prueba enviado');
}

const isSeason = p => p.format === 'TV' || p.format === 'TV_SHORT' || (p.format === 'ONA' && (p.episodes ? p.episodes >= 3 : p.status !== 'FINISHED'));
const porParte = new Map();
for (const it of db.items || []) {
  if (it.type !== 'ANIME' || it.estado !== 'viendo') continue;
  const temporadas = it.parts.filter(isSeason);
  for (const p of it.parts) {
    if (p.status === 'FINISHED' || p.status === 'CANCELLED') continue;
    const t = temporadas.indexOf(p);
    porParte.set(p.id, { it, p, etiqueta: temporadas.length > 1 && t >= 0 ? `Temporada ${t + 1} · ` : '' });
  }
}

let enviados = 0;
if (porParte.size) {
  const r = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: `query($ids:[Int],$a:Int,$b:Int){Page(perPage:50){airingSchedules(mediaId_in:$ids,airingAt_greater:$a,airingAt_lesser:$b,sort:TIME){episode airingAt mediaId}}}`,
      variables: { ids: [...porParte.keys()], a: desde, b: ahora + 1 }
    })
  });
  if (!r.ok) { console.log('AniList respondió ' + r.status); process.exit(1); }
  const j = await r.json();
  for (const s of j.data?.Page?.airingSchedules || []) {
    const x = porParte.get(s.mediaId); if (!x) continue;
    if ((x.it.watched?.[x.p.id] || []).includes(s.episode)) continue;
    await avisar(x.it.title, `${x.etiqueta}Capítulo ${s.episode} ya disponible`, x.p.cover || x.it.cover, `${x.p.id}-${s.episode}`);
    enviados++;
  }
}

fs.mkdirSync('estado', { recursive: true });
fs.writeFileSync(ESTADO, JSON.stringify({ ultimo: ahora }));
console.log(`Series en emisión revisadas: ${porParte.size}. Capítulos nuevos: ${enviados}. Aparatos con avisos: ${aparatos.length}${webpush ? '' : ' (falta VAPID_PRIVATE)'}. Entregados: app ${cuenta.push}, fallos ${cuenta.pushFallos}.`);
