# tinyrail-view-releases

> ⚠️ **Miroir historique.** L'adresse du produit est **https://view.tinyrail.xptrucks.fr**.
> Ce dépôt sert les mêmes fichiers, à l'octet près, et continue d'être alimenté par la CI
> **sans date de fin** — mais c'est le second exemplaire, pas la référence. Ne pas le citer
> comme adresse officielle.

Binaires publics et page d'installation du **TinyRail_View**, l'afficheur e-paper
qui accompagne la carte TinyRail.

**Page d'installation : https://view.tinyrail.xptrucks.fr/**
(miroir : `https://chpeps.github.io/tinyrail-view-releases/`)

Ce dépôt est **écrit par la CI**, jamais à la main : le workflow `Release TinyRail View`
du dépôt source y pousse `firmware.bin`, `firmware.factory.bin`, `install-manifest.json`,
`ble-manifest.json` et `index.html` à chaque tag `vX.Y.Z`.

Une modification faite ici est écrasée à la release suivante. La source vit dans
`chpeps/TinyRail_View`, dépôt privé.

## Les deux manifests

- `install-manifest.json` — flash par USB depuis le navigateur (ESP Web Tools).
- `ble-manifest.json` — mise à jour par Bluetooth depuis l'application mobile.
  Le View n'a pas de Wi-Fi : il ne va jamais chercher sa mise à jour lui-même,
  c'est le téléphone qui la lui apporte.

⚠️ Le produit n'a pas encore été éprouvé sur du matériel.
