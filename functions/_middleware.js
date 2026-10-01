// Les pages de flash derrière une connexion GitHub, et chaque flash inscrit au
// registre de production (Google Sheet).
//
// ⚠️ SOURCE UNIQUE ICI, copie dans TinyRail_View (`tools/flash/`), contrôlée en
// CI par empreinte : modifier ce fichier impose de recopier.
//
// Publié à la racine du dépôt de releases, dans `functions/` : Cloudflare
// Pages l'embarque alors à CHAQUE déploiement du clone, quelle que soit la
// chaîne qui publie (firmware, app). Aucune ne peut l'effacer par oubli.
//
// ⚠️ `_routes.json` limite ce programme à la page, aux images d'usine et à ses
// propres adresses. Tout le reste reste statique et PUBLIC, et doit le rester :
// les cartes et l'app lisent les manifests et images d'OTA sans se connecter.
//
// Variables du projet Pages (`wrangler pages secret put`) :
//   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET  l'application GitHub de connexion
//   SESSION_SECRET                          signe le cookie de session
//   FLASH_SHEET_URL, FLASH_SHEET_SECRET     l'application web du registre
//   ADRESSE_FLASH                           l'adresse officielle de la page,
//                                           ex. https://flash.tinyrail.xptrucks.fr
//   GITHUB_ORG (facultatif)                 Xptrucks par défaut

const COOKIE = 'flash_session';
const DUREE_SESSION = 12 * 3600; // secondes

export async function onRequest(ctx) {
  const url = new URL(ctx.request.url);
  const chemin = url.pathname;
  try {
    // ⚠️ UNE SEULE ADRESSE POUR SE CONNECTER. Le même projet sert la page sous
    // d'autres noms (`ota.tinyrail.` pour la carte, `view.tinyrail.` pour le
    // View), que l'application GitHub ne connaît pas comme adresses de retour :
    // la connexion y échouerait. On y renvoie donc vers l'adresse officielle
    // AVANT toute connexion. Seules les pages sont concernées : les fichiers
    // publics de mise à jour ne passent pas par ce programme (_routes.json).
    const officielle = ctx.env.ADRESSE_FLASH && new URL(ctx.env.ADRESSE_FLASH).origin;
    if (officielle && url.origin !== officielle
        && (chemin === '/' || chemin.endsWith('.html') || chemin.startsWith('/auth/'))) {
      return Response.redirect(`${officielle}${chemin}${url.search}`, 302);
    }

    if (chemin === '/auth/login') return connexion(ctx, url);
    if (chemin === '/auth/callback') return retour(ctx, url);
    if (chemin === '/auth/logout') return deconnexion();

    const qui = await session(ctx);
    if (!qui) {
      // Une page : on emmène se connecter. Un fichier ou une API : on refuse.
      if (chemin === '/' || chemin.endsWith('.html')) {
        return Response.redirect(`${url.origin}/auth/login?retour=${encodeURIComponent(chemin)}`, 302);
      }
      return json({ ok: false, erreur: 'connexion requise' }, 401);
    }

    if (chemin === '/api/moi') return json({ ok: true, login: qui });
    if (chemin === '/api/lots') return lots(ctx, url);
    if (chemin === '/api/flash' && ctx.request.method === 'POST') return flash(ctx, qui);
    return ctx.next();
  } catch (err) {
    return json({ ok: false, erreur: String(err.message || err) }, 500);
  }
}

// ── Connexion GitHub ─────────────────────────────────────────────────────

function connexion(ctx, url) {
  const etat = crypto.randomUUID();
  const retourVers = url.searchParams.get('retour') || '/';
  const cible = new URL('https://github.com/login/oauth/authorize');
  cible.searchParams.set('client_id', ctx.env.GITHUB_CLIENT_ID);
  cible.searchParams.set('redirect_uri', `${url.origin}/auth/callback`);
  cible.searchParams.set('state', etat);
  // L'état protège contre une connexion forgée ; il voyage avec la page de
  // retour, et ne vit que 10 minutes. ⚠️ Encodée : un `|` couperait le
  // découpage, un `;` ajouterait des attributs au cookie.
  return new Response(null, {
    status: 302,
    headers: {
      Location: cible.toString(),
      'Set-Cookie': cookie('flash_etat', `${etat}|${encodeURIComponent(retourVers)}`, 600),
    },
  });
}

async function retour(ctx, url) {
  const [etatAttendu, retourEncode] = (lireCookie(ctx.request, 'flash_etat') || '').split('|');
  let retourVers = '/';
  try { retourVers = decodeURIComponent(retourEncode || '/'); } catch (_) { /* reste '/' */ }
  if (!etatAttendu || url.searchParams.get('state') !== etatAttendu) {
    return texte('Connexion refusée : état invalide. Recommencez depuis la page de flash.', 400);
  }
  const jeton = await jetonGitHub(ctx, url);
  const moi = await github('https://api.github.com/user', jeton);
  if (!moi.login) return texte('Connexion refusée : compte GitHub illisible.', 403);

  if (!(await autorise(ctx, moi.login, jeton))) {
    return texte(`Le compte GitHub « ${moi.login} » n'est pas autorisé à flasher. `
      + 'Demandez à Xptrucks de l\'ajouter.', 403);
  }
  const valeur = await signer(ctx.env, { login: moi.login, exp: maintenant() + DUREE_SESSION });
  const headers = new Headers({ Location: sur(retourVers, url.origin) });
  headers.append('Set-Cookie', cookie(COOKIE, valeur, DUREE_SESSION));
  headers.append('Set-Cookie', cookie('flash_etat', '', 0));
  return new Response(null, { status: 302, headers });
}

function deconnexion() {
  return new Response('Déconnecté.', {
    headers: { 'Set-Cookie': cookie(COOKIE, '', 0), 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

async function jetonGitHub(ctx, url) {
  const r = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: ctx.env.GITHUB_CLIENT_ID,
      client_secret: ctx.env.GITHUB_CLIENT_SECRET,
      code: url.searchParams.get('code'),
      redirect_uri: `${url.origin}/auth/callback`,
    }),
  });
  const donnees = await r.json();
  if (!donnees.access_token) throw new Error('GitHub a refusé la connexion');
  return donnees.access_token;
}

// Membre de l'organisation, OU distributeur actif du registre : c'est l'onglet
// `Distributeurs` qui donne les droits, sans toucher au code.
async function autorise(ctx, login, jeton) {
  const org = ctx.env.GITHUB_ORG || 'Xptrucks';
  const r = await fetch(`https://api.github.com/user/memberships/orgs/${org}`, {
    headers: enTetesGitHub(jeton),
  });
  if (r.ok && (await r.json()).state === 'active') return true;
  // ⚠️ En POST, secret dans le CORPS : dans l'adresse, il finissait dans les
  // journaux d'exécution de Google.
  const registre = await registrePost(ctx.env, { action: 'autorises' });
  // Une panne n'est pas un refus : sinon le distributeur lit qu'il n'a pas les
  // droits, et on cherche dans `Distributeurs` un défaut qui n'y est pas.
  if (registre.injoignable) throw new Error(`${registre.erreur} : réessayez dans un instant`);
  return (registre.autorises || []).map((l) => l.toLowerCase()).includes(login.toLowerCase());
}

function enTetesGitHub(jeton) {
  return { Authorization: `Bearer ${jeton}`, Accept: 'application/vnd.github+json', 'User-Agent': 'xptrucks-flash' };
}

async function github(adresse, jeton) {
  const r = await fetch(adresse, { headers: enTetesGitHub(jeton) });
  return r.ok ? r.json() : {};
}

// ── Registre de production ───────────────────────────────────────────────

async function lots(ctx, url) {
  const registre = await registreGet(ctx.env, {});
  if (registre.injoignable) return json(registre, 502);
  const produit = url.searchParams.get('produit');
  const liste = (registre.batches || []).filter((b) => !produit || b.produit_id === produit);
  return json({ ok: true, batches: liste });
}

// ⚠️ `qui` et `outil` sont posés ICI, jamais repris de la page : c'est la
// session qui dit qui a flashé, pas ce que le navigateur prétend.
async function flash(ctx, qui) {
  const recu = await ctx.request.json();
  const envoi = {
    mac: recu.mac,
    produit_id: recu.produit_id,
    batch_id: recu.batch_id,
    version: recu.version,
    canal: recu.canal,
    resultat: recu.resultat,
    detail: recu.detail,
    // Tiré par la page à chaque flash : un envoi répété ne s'inscrit qu'une fois.
    flash_id: recu.flash_id,
    qui,
    outil: 'page web',
  };
  const reponse = await registrePost(ctx.env, envoi);
  return json(reponse, reponse.injoignable ? 502 : 200);
}

// ⚠️ `text/plain` : Apps Script lit le corps tel quel. Il répond par une
// redirection, que fetch suit, et le script a déjà écrit à ce moment-là.
async function registrePost(env, corps) {
  const r = await fetch(env.FLASH_SHEET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...corps, secret: env.FLASH_SHEET_SECRET }),
    redirect: 'follow',
  });
  return lireRegistre(r);
}

async function registreGet(env, params) {
  const url = new URL(env.FLASH_SHEET_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return lireRegistre(await fetch(url, { redirect: 'follow' }));
}

// ⚠️ Un script qui lève une exception répond 200 avec une PAGE HTML : le
// statut ne suffit pas, seul un JSON lisible prouve que le registre a répondu.
async function lireRegistre(r) {
  const texte = await r.text();
  try {
    if (r.ok) return JSON.parse(texte);
  } catch {}
  return { ok: false, injoignable: true, erreur: `registre injoignable (${r.status}${r.ok ? ', réponse illisible' : ''})` };
}

// ── Session signée ───────────────────────────────────────────────────────

async function session(ctx) {
  const brut = lireCookie(ctx.request, COOKIE);
  if (!brut) return null;
  const [charge, signature] = brut.split('.');
  if (!charge || !signature || signature !== (await hmac(ctx.env, charge))) return null;
  const donnees = JSON.parse(atob(charge));
  return donnees.exp > maintenant() ? donnees.login : null;
}

async function signer(env, donnees) {
  const charge = btoa(JSON.stringify(donnees));
  return `${charge}.${await hmac(env, charge)}`;
}

async function hmac(env, texteClair) {
  const cle = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cle, new TextEncoder().encode(texteClair));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
}

// ── Outils ───────────────────────────────────────────────────────────────

const maintenant = () => Math.floor(Date.now() / 1000);

function cookie(nom, valeur, maxAge) {
  return `${nom}=${valeur}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function lireCookie(requete, nom) {
  const entete = requete.headers.get('Cookie') || '';
  const m = entete.match(new RegExp(`(?:^|;\\s*)${nom}=([^;]*)`));
  return m ? m[1] : null;
}

// Ne renvoie qu'un chemin du même site : un `retour` forgé ne doit pas
// emmener ailleurs après la connexion. ⚠️ Résolu comme le ferait un
// navigateur, puis comparé à notre origine : `//hôte` et `/\hôte` (le
// navigateur lit `\` comme `/`) passaient un simple test de préfixe.
function sur(chemin, origine) {
  try {
    const cible = new URL(chemin, origine);
    return cible.origin === origine ? cible.pathname + cible.search : '/';
  } catch (_) {
    return '/';
  }
}

function json(objet, statut = 200) {
  return new Response(JSON.stringify(objet), {
    status: statut, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function texte(message, statut) {
  return new Response(message, { status: statut, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
