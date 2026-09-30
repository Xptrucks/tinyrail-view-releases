// Le flasheur des pages d'installation : lit la MAC de la puce, flashe l'image
// d'usine, et inscrit le flash au registre de production.
//
// ⚠️ SOURCE UNIQUE ICI, copie dans TinyRail_View (`tools/flash/`), contrôlée en
// CI par empreinte : modifier ce fichier impose de recopier.
//
// Remplace ESP Web Tools, qui ne donne pas la MAC à la page. esptool-js est la
// bibliothèque qu'ESP Web Tools utilise lui-même.
//
//   <div id="flasheur" data-produit="HSD" data-adresse="https://flash.tinyrail.xptrucks.fr/"></div>
//   <script type="module">
//     import { monterFlasheur } from './flasheur.js';
//     monterFlasheur(document.getElementById('flasheur'));
//   </script>

import { ESPLoader, Transport } from 'https://unpkg.com/esptool-js@0.7.0/bundle.js';

export function monterFlasheur(racine) {
  const produit = racine.dataset.produit;
  racine.innerHTML = `
    <p class="flash-qui" hidden></p>
    <label class="flash-lot">Lot de production
      <select><option value="">— aucun (reflash, SAV) —</option></select>
    </label>
    <button type="button" class="flash-go" disabled>Chargement…</button>
    <progress max="100" value="0" hidden></progress>
    <p class="flash-etat" role="status"></p>
    <details class="flash-journal"><summary>Journal</summary><pre></pre></details>`;
  const $ = (s) => racine.querySelector(s);
  const bouton = $('.flash-go');
  const choixLot = $('select');
  const barre = $('progress');
  const etat = (t) => { $('.flash-etat').textContent = t; };
  const journal = $('pre');
  const terminal = {
    clean: () => { journal.textContent = ''; },
    writeLine: (l) => { journal.textContent += l + '\n'; },
    write: (l) => { journal.textContent += l; },
  };

  if (!('serial' in navigator)) {
    etat('Ce navigateur ne sait pas parler au port USB : utilisez Chrome ou Edge sur ordinateur.');
    bouton.textContent = 'Navigateur non compatible';
    return;
  }

  let manifest;
  let canal;
  (async () => {
    // ⚠️ Sans le programme Cloudflare (miroir GitHub Pages, copie locale), il
    // n'y a ni connexion ni registre : on envoie vers l'adresse officielle
    // plutôt que de laisser une erreur JSON incompréhensible.
    let moi;
    try {
      const r = await fetch('/api/moi');
      // Session expirée sur une page restée ouverte : on repart se connecter.
      if (r.status === 401) return reconnecter();
      moi = await r.json();
    } catch (_) {
      const adresse = racine.dataset.adresse;
      etat('');
      $('.flash-etat').innerHTML = `Cette copie de la page ne permet pas de flasher : chaque flash doit être `
        + `inscrit au registre de production. Rendez-vous sur <a href="${adresse}">${adresse}</a>.`;
      bouton.textContent = 'Flash indisponible ici';
      return;
    }
    if (moi.login) {
      $('.flash-qui').hidden = false;
      $('.flash-qui').innerHTML = `Connecté : <strong>${moi.login}</strong> · <a href="/auth/logout">se déconnecter</a>`;
    }
    const rl = await fetch(`/api/lots?produit=${encodeURIComponent(produit)}`);
    if (rl.status === 401) return reconnecter();
    const { batches = [] } = await rl.json();
    for (const b of batches) choixLot.add(new Option(b.batch_id, b.batch_id));
    if (batches.length === 1) choixLot.value = batches[0].batch_id;
    ({ manifest, canal } = await lireManifest());
    bouton.textContent = `Flasher la v${manifest.version}${canal === 'bêta' ? ' (bêta)' : ''}`;
    bouton.disabled = false;
  })().catch((e) => etat('Chargement impossible : ' + e.message));

  bouton.addEventListener('click', async () => {
    bouton.disabled = true;
    barre.hidden = false;
    barre.value = 0;
    let mac = null;
    let transport = null;
    // Rendu après l'écriture : une session expirée pendant le flash ne doit
    // pas perdre la MAC. On le dit, avec la MAC, au lieu de repartir.
    const rapport = (resultat, detail) => fetch('/api/flash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac, produit_id: produit, batch_id: choixLot.value, version: manifest.version,
        canal, resultat, detail }),
    }).then((r) => r.json());

    try {
      const port = await navigator.serial.requestPort();
      transport = new Transport(port, true);
      const loader = new ESPLoader({ transport, baudrate: 460800, terminal });
      etat('Connexion à la puce…');
      await loader.main();
      mac = (await loader.chip.readMac(loader)).toUpperCase();

      // ⚠️ La famille de puce est vérifiée AVANT d'écrire : l'image d'un View
      // sur une carte (ou l'inverse) la rendrait muette jusqu'au prochain flash.
      const attendue = manifest.builds[0].chipFamily;
      if (loader.chip.CHIP_NAME !== attendue) {
        throw new Error(`puce ${loader.chip.CHIP_NAME}, ce firmware est pour ${attendue}`);
      }

      etat(`Puce ${loader.chip.CHIP_NAME}, MAC ${mac}. Téléchargement de l'image…`);
      const part = manifest.builds[0].parts[0];
      // ⚠️ Le chemin seul, pris sur l'adresse de CETTE page : le manifest
      // donne une adresse absolue, alors que la page est servie sous plusieurs
      // noms (flash., ota., view.) et que la session ne vaut que pour le nom
      // où l'on s'est connecté. Ailleurs, l'image répondrait « connexion requise ».
      const reponse = await fetch(new URL(part.path).pathname);
      if (reponse.status === 401) throw new Error('session expirée : rechargez la page pour vous reconnecter');
      if (!reponse.ok) throw new Error(`image introuvable (${reponse.status})`);
      const image = new Uint8Array(await reponse.arrayBuffer());

      etat('Écriture…');
      await loader.writeFlash({
        fileArray: [{ data: image, address: part.offset }],
        flashMode: 'keep', flashFreq: 'keep', flashSize: 'keep',
        eraseAll: false, compress: true,
        reportProgress: (_, ecrit, total) => { barre.value = Math.round((ecrit / total) * 100); },
      });
      await loader.after('hard_reset');

      const r = await rapport('ok');
      etat(r.ok
        ? `Flash réussi. ${mac} est inscrit au registre${r.notes && r.notes.length ? ' (' + r.notes.join(' ; ') + ')' : ''}.`
        : `Flash réussi, mais le registre a refusé l'inscription : ${r.erreur}. Notez la MAC ${mac}.`);
    } catch (e) {
      // Un renoncement au choix du port n'est pas un échec : rien n'a été touché.
      if (e.name === 'NotFoundError') {
        etat('Aucun port choisi.');
      } else {
        etat('Échec : ' + e.message);
        // Sans MAC, il n'y a rien à rattacher à un appareil.
        if (mac) await rapport('échec', e.message).catch(() => {});
      }
    } finally {
      if (transport) await transport.disconnect().catch(() => {});
      bouton.disabled = false;
    }
  });
}

function reconnecter() {
  location.href = `/auth/login?retour=${encodeURIComponent(location.pathname)}`;
}

// La version stable si elle existe, la dernière bêta sinon. Un fichier absent
// répond 200 avec du HTML (lecture JSON en échec) ; une réponse JSON qui n'est
// pas un manifest (sans `builds`) est refusée aussi, plutôt que d'afficher
// « Flasher la vundefined ».
async function lireManifest() {
  const lire = async (f) => {
    const r = await fetch(f);
    if (!r.ok) throw new Error(`${f} : ${r.status}`);
    const m = await r.json();
    if (!m.version || !Array.isArray(m.builds)) throw new Error(`${f} : pas un manifest`);
    return m;
  };
  try {
    return { manifest: await lire('/install-manifest.json'), canal: 'stable' };
  } catch (_) {
    return { manifest: await lire('/install-manifest-beta.json'), canal: 'bêta' };
  }
}
