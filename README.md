# tinyrail-view-releases

> ⚠️ **Miroir.** L'adresse du produit est **https://flash.tinyview.xptrucks.fr**
> (`view.tinyrail.xptrucks.fr` sert le même site, pour les apps qui la lisent en dur).
> Ce dépôt sert les mêmes fichiers, à l'octet près, et continue d'être alimenté par la CI
> **sans date de fin** — mais c'est le second exemplaire, pas la référence. Ne pas le citer
> comme adresse officielle.

Binaires publics et page d'installation du **TinyView**, l'écran tactile 4 pouces
qui accompagne la carte TinyRail.

**Page d'installation : https://flash.tinyview.xptrucks.fr/**
(miroir : `https://xptrucks.github.io/tinyrail-view-releases/`)

Ce dépôt est **écrit par la CI**, jamais à la main : le workflow `Release TinyRail View`
du dépôt source y pousse les binaires, les manifests et `index.html` à chaque tag.
Une modification faite ici est écrasée à la release suivante. La source vit dans
`Xptrucks/TinyRail_View`, dépôt privé.

## Les fichiers

| Fichier | Sert à |
|---|---|
| `install-manifest.json`, `firmware.factory.bin` | flash USB depuis le navigateur, version stable |
| `install-manifest-beta.json`, `firmware-beta.factory.bin` | la même chose pour la dernière bêta |
| `manifest.json`, `firmware.bin` | mise à jour par Bluetooth depuis l'app, canal stable |
| `manifest-beta.json`, `firmware-beta.bin` | la même chose, canal bêta |

La page installe la version stable si elle existe, la dernière bêta sinon.
Le View n'a pas de Wi-Fi : il ne va jamais chercher sa mise à jour lui-même,
c'est le téléphone qui la lui apporte.

⚠️ Le TinyView tourne sur son écran, mais n'a pas encore été éprouvé avec une carte dans un van.
