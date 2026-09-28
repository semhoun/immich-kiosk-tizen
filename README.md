# Immich Kiosk pour Tizen

> Afficher les photos d'un serveur Immich Kiosk sur une télévision Samsung, avec une interface française adaptée à la télécommande.

## Présentation

Cette application Web embarquée cible **Tizen 5.5 / Chromium 69**. Elle communique avec Immich Kiosk, jamais directement avec Immich : le serveur Kiosk conserve la sélection des photos et la clé API Immich. Aucun backend supplémentaire n'est fourni.

La version actuelle est **0.9.3**. Les lecteurs locaux acceptent uniquement le contrat **Kiosk v0.44.1**, étudié au commit `d567ac041fc93c3d5421aecdcdf5941118022ccb`. Le mode Full affiche le site original sans passer par cet adaptateur.

**La compatibilité matérielle Tizen 5.5 et l'intégration complète avec un serveur réel restent à valider.** L'historique du projet rapporte une installation de la version 1.0.1 depuis Windows et une signature dans Docker. Il ne valide pas la version actuelle sur TV, ni l'installation directe depuis Docker. Une ancienne installation `1.0.x` peut empêcher la rétrogradation vers `0.9.3` ; sa désinstallation efface les réglages locaux.

## Fonctionnalités

| Mode | Présentation | Authentification Kiosk |
| --- | --- | --- |
| Simple | Photos plein écran, lecteur local | En-tête `X-Api-Key` |
| Enrichi | Lecteur local, horloge, date française et fondu conditionnel | En-tête `X-Api-Key` |
| Full | Site original dans une iframe isolée, rythme et disposition du serveur | Paramètre d'URL `password` |

- Durée locale de 15 secondes par défaut, ajustement contenir ou remplir.
- Précédent, suivant, pause/reprise, historique limité à 10 photos et une photo préchargée.
- Remplacement de l'image uniquement après décodage réussi ; dernière photo conservée lors d'une erreur transitoire.
- Requêtes annulables, délais bornés, trois relances réseau maximum et suspension en arrière-plan.
- URL HTTP(S), chemins de base et filtres répétés ; mot de passe facultatif, non mémorisé par défaut.
- Réglages persistants, démarrage automatique après configuration et affichage temporaire du mot de passe.

Les modes locaux ne lisent ni vidéos ni météo. Le fonctionnement hors ligne, le lancement à l'allumage, l'authentification Basic et les portails externes sont hors périmètre. Aucune publication Samsung Store n'est prévue.

## Technologies

| Couche | Technologie |
| --- | --- |
| Application | HTML, CSS et JavaScript natifs, sans framework ni dépendance npm d'exécution |
| État et stockage | Modules JavaScript, `localStorage`, historique en mémoire et URL Blob |
| Intégration TV | Manifeste Tizen 5.5, touches Tizen, API Samsung AppCommon |
| Construction | Node.js 22.14.0, esbuild 0.25.1, bundle classique ciblant Chromium 69 |
| Tests | Runner natif Node.js, Playwright 1.51.1, fixtures HTTP/HTTPS synthétiques |
| Outillage | Docker Compose et SDK Tizen CLI |

## Architecture

`main.js` coordonne les réglages, le focus, les touches et le cycle de vie. Pour Simple et Enrichi, les données suivent le parcours `KioskClient` → `Player` → affichage local. L'adaptateur analyse du HTML inerte, télécharge les images autorisées et fournit des URL Blob au lecteur. `Player` gère l'historique, le préchargement et les relances ; les réglages sont stockés séparément.

Il n'y a pas de routeur : l'interface alterne entre réglages et lecture. Full utilise un composant distinct et ne partage pas le pipeline photo local. La construction remplace les modules sources par un script classique et injecte la version de `app/config.xml` dans l'interface.

```text
app/                      Interface et fichiers embarqués du widget
  main.js                 Coordination, télécommande et cycle de vie
  settings.js             Validation et persistance des réglages
  kiosk.js                Adaptateur du contrat Kiosk v0.44.1
  network.js              Requêtes bornées et validation des destinations
  player.js               Lecture, historique, préchargement et reprise
  presentation.js         Horloge, date et présentation enrichie
  full.js                 Intégration isolée du site original
  config.xml              Identité, version et privilèges Tizen
tests/                    Tests unitaires, navigateur et profil de signature
  fixtures/               Réponses Kiosk synthétiques et anonymisées
tools/                    Construction, serveur local, icône et commandes SDK
Dockerfile                Environnement Node.js et Playwright
Dockerfile.tizen           SDK CLI avec installateur externe
compose.yaml              Services, profils et volumes
dist/                     Application construite, non versionnée
artifacts/                Widgets et captures générés, non versionnés
```

## Démarrage

### Prérequis

- Docker Engine et Docker Compose fonctionnels, avec accès au daemon et prise en charge des contextes de build supplémentaires.
- Un serveur Immich Kiosk accessible depuis le navigateur ou la TV ; v0.44.1 pour Simple et Enrichi.
- Pour installer sur TV : outils officiels, licences acceptées, profil Samsung compatible et mode développeur activé.

**Tout l'outillage s'exécute dans Docker.** Ne pas installer Node.js, Playwright, Java, le SDK ou SDB sur l'hôte. Aucun conteneur privilégié ni montage du socket Docker n'est nécessaire.

### Installation et aperçu

Depuis la racine de cette copie du dépôt :

```sh
docker compose build tooling
docker compose up dev
```

La construction de l'image installe les dépendances avec `npm ci`. Ouvrir <http://127.0.0.1:8080>. Depuis un autre appareil, utiliser l'adresse IP de la machine et le port 8080. Le port est publié sur toutes les interfaces IPv4 par défaut : réserver ce serveur sans authentification à un réseau de confiance.

L'aperçu construit puis sert `dist/`, comme le widget. Il n'effectue pas de reconstruction automatique. Après une modification, exécuter la commande suivante puis recharger la page :

```sh
docker compose run --rm tooling npm run build
```

Pour limiter l'accès à la machine locale ou changer le port :

```sh
PREVIEW_HOST=127.0.0.1 PREVIEW_PORT=8081 docker compose up dev
```

Les commandes utilisent les UID/GID `1000:1000`. Adapter `LOCAL_UID` et `LOCAL_GID` aux identifiants non-root de l'hôte si nécessaire. Les dépendances et caches persistent dans des volumes Docker ; reconstruire l'image `tooling` après modification des dépendances.

### Configuration du lecteur

1. Choisir Simple ou Enrichi, puis saisir l'URL du serveur Kiosk avec son éventuel chemin de base et ses filtres.
2. Saisir le mot de passe natif Kiosk si nécessaire ; choisir explicitement s'il doit être mémorisé.
3. Régler la durée et l'ajustement de l'image.
4. Utiliser **Tester la connexion** : le test récupère les métadonnées, télécharge une photo et la décode.
5. Utiliser **Lancer le diaporama**.

Un chemin local sans slash final est traité comme un répertoire. Les filtres répétés sont conservés. Le lecteur impose `layout=single`, désactive vidéos, live photos et GIF animés, demande les aperçus et retire `history`. Si `disable_url_queries` empêche ces options, les réponses incompatibles sont refusées.

Les paramètres `password` et `authsecret` d'une URL collée sont extraits vers le champ secret, puis retirés de l'adresse enregistrée. Les URL contenant des identifiants utilisateur sont refusées. Décocher **Mémoriser le mot de passe** supprime immédiatement le secret persisté. **Afficher le mot de passe** est indépendant, non mémorisé et réinitialisé à la sortie des réglages ou en arrière-plan.

Une configuration enregistrée déclenche une tentative de lecture au lancement. Un secret non mémorisé doit être ressaisi. **Effacer les réglages** supprime l'adresse et le mot de passe enregistrés.

### Télécommande

| Touche ou action | Comportement |
| --- | --- |
| Flèches dans les réglages | Déplacer le focus ; gauche/droite change de colonne sans modifier les valeurs |
| OK sur un choix | Changer la présentation, la durée ou l'ajustement |
| Focus sur un champ texte | Sélectionner sans ouvrir le clavier |
| OK ou clic sur un champ texte | Ouvrir la saisie native Samsung |
| Terminé, Annuler ou Retour pendant la saisie | Fermer la saisie et revenir au champ |
| Gauche / droite en lecture locale | Photo précédente / suivante |
| OK / Entrée ou touches média en lecture locale | Pause/reprise, lecture ou pause selon la touche |
| Haut ou Retour en lecture, y compris Full | Ouvrir les réglages |
| Retour dans les réglages | Demander confirmation de sortie |

AppCommon gère l'économiseur lorsque disponible, puis rétablit son comportement normal à la pause, à l'arrêt ou en arrière-plan. Les protections matérielles de la dalle restent actives. Le clavier et les touches physiques doivent être vérifiés sur le modèle cible.

### Particularités des présentations

Enrichi utilise l'heure et le fuseau de l'appareil, avec actualisation à la minute. Le fondu fonctionne uniquement si le navigateur reconnaît une préférence autorisant les animations ; il reste désactivé sur Chromium 69. Ce mode ne reproduit ni les dispositions multiples ni les informations photo détaillées de Kiosk.

Full conserve les paramètres du site sans imposer les options du lecteur local. Les contrôles de durée, d'ajustement et de lancement local sont masqués. **Ouvrir le site Full** demande confirmation. Une configuration enregistrée peut redémarrer automatiquement en HTTPS ; en HTTP avec mot de passe, la confirmation reste obligatoire.

Le cadre Full est non interactif : ni clics, ni focus clavier, ni contrôle local précédent/suivant/pause. Haut et Retour restent disponibles. Le cadre est supprimé en arrière-plan puis rechargé au retour, ce qui peut réinitialiser la lecture distante.

## Réseau et sécurité

- Simple et Enrichi n'exécutent jamais les fragments HTML distants. Les images JPEG, PNG et WebP sont validées puis décodées ; les réponses sont limitées à 24 Mio, les images à 16 Mio.
- Les téléchargements locaux refusent les redirections et les images hors de l'origine ou du chemin de base autorisés. Les URL Blob sont libérées à l'éviction ; aucun cache disque photo n'est implémenté.
- HTTP ne chiffre rien. Une confirmation précède l'envoi d'un secret en HTTP. HTTPS exige un certificat reconnu, sans contournement TLS.
- Le mot de passe mémorisé réside dans `localStorage`, sans chiffrement. Ne pas considérer ce stockage comme un coffre-fort ni exposer Kiosk sur la seule protection de son mot de passe natif.
- Full place le secret dans l'URL du cadre, car une iframe ne peut pas ajouter `X-Api-Key` à sa navigation. Même en HTTPS, cette URL peut apparaître dans les journaux serveur/proxy ou les données du navigateur. L'application ne la persiste pas.
- Full exige une origine différente de celle de l'application. Son sandbox autorise les scripts et l'origine distante, mais pas les formulaires, fenêtres supplémentaires ou navigation de la fenêtre principale.
- `X-Frame-Options`, CSP `frame-ancestors` ou le contenu mixte peuvent bloquer Full. Un chargement du cadre ne prouve ni l'authentification ni la lecture effective. Ses scripts ne sont pas adaptés à Chromium 69 par la construction locale.

### Limite CORS de Kiosk v0.44.1

Simple et Enrichi envoient `kiosk-device-id`, ainsi que `X-Api-Key` si un mot de passe existe. Ces en-têtes nécessitent une prérequête CORS. Dans le contrat étudié, l'authentification précède le middleware CORS : `OPTIONS` peut recevoir un `401` sans en-têtes CORS. **Configurer uniquement `allowed_origins` ne corrige pas cet ordre.**

Ce cas est couvert par un serveur simulé, pas validé sur le déploiement réel. Observer l'origine Tizen et les prérequêtes sur TV ; ses privilèges ne garantissent aucun contournement CORS. Le projet n'ajoute pas de proxy et ne modifie pas Kiosk. Ne pas désactiver l'authentification ou ouvrir globalement CORS. Full ne requiert pas CORS pour la navigation, mais reste soumis aux restrictions d'intégration.

## Tests et captures

```sh
docker compose config --quiet
docker compose run --rm tooling npm test
docker compose run --rm browser
```

La suite comprend **7 fichiers unitaires, avec 29 cas déclarés**, et un scénario navigateur autonome. Elle couvre réglages, secrets, protocole, historique, relances, réponses obsolètes, parsing malveillant, destinations tierces et parcours clavier. Les serveurs HTTP/HTTPS et les photos sont synthétiques. Une autorité temporaire est approuvée uniquement par le navigateur de test ; les certificats non fiables restent refusés.

Playwright utilise Chromium 134, avec `globalThis` masqué dans les modules applicatifs pour simuler son absence sur Chromium 69. Cela ne remplace pas le moteur réel, une intégration Kiosk ou un essai mémoire prolongé sur TV. L'ancien suivi rapportait 29 tests unitaires et 14 groupes navigateur réussis ; ce n'est pas une validation de chaque modification ultérieure.

Les tests navigateur génèrent `artifacts/settings-desktop.png`, `settings-mobile.png`, `enriched-desktop.png` et `full-desktop.png`. Ces captures ne sont pas versionnées ; les deux dernières montrent des fixtures.

## Construction

```sh
docker compose run --rm tooling npm run build
docker compose run --rm tooling npm run package:unsigned
```

`build` produit `dist/`. `package:unsigned` reconstruit l'application et crée `artifacts/immich-kiosk-UNSIGNED.wgt`. **Cette archive non signée n'est pas installable telle quelle sur TV.** La construction refuse liens symboliques, fichiers cachés et extensions privées dans `app/`.

## Signature et déploiement Tizen

### Environnement SDK

Conserver installateur, certificats et secrets hors du dépôt. Définir ces variables dans l'environnement Compose :

| Variable | Valeur attendue |
| --- | --- |
| `TIZEN_INSTALLER_DIR` | Dossier dédié contenant uniquement `web-cli_Tizen_Studio_6.1_ubuntu-64.bin` |
| `TIZEN_INSTALLER_SHA256` | Empreinte SHA-256 vérifiée de cet installateur |
| `TIZEN_ACCEPT_LICENSE` | `yes`, uniquement après acceptation des licences applicables |
| `TIZEN_PACKAGES` | Identifiants de paquets vérifiés ; défaut : `WebCLI` |
| `TIZEN_CERTIFICATES_DIR` | Dossier privé externe, monté en lecture seule dans `/certificates` |

L'installateur utilise un contexte de build séparé et un montage en lecture seule, sans copie dans une couche. `TIZEN_INSTALLER_DIR` remplace l'ancien `TIZEN_INSTALLER_FILE`. Sans dossier de certificats, un volume d'import vide permet les diagnostics. `WebCLI` seul ne garantit pas les extensions Samsung TV et Certificate ; vérifier leurs licences et versions. Le Dockerfile rappelle l'exigence Certificate Extension ≥ 2.0.73 depuis septembre 2025.

```sh
docker compose --profile tizen build tizen
docker compose run --rm tizen doctor
```

`doctor` vérifie uniquement la présence des CLI, pas les certificats ni la compatibilité TV.

### Préparer un profil

La gestion des profils se fait uniquement en CLI, à partir de certificats existants. Pour émettre de nouveaux certificats Samsung TV, utiliser les outils officiels hors de ce projet.

#### Importer depuis le répertoire courant

Dans un dossier privé hors du dépôt contenant `author.p12` et `distributor.p12`, exécuter les commandes suivantes. Adapter le chemin du dépôt si nécessaire ; l'image SDK doit déjà être construite :

```sh
export TIZEN_CERTIFICATES_DIR="$(pwd -P)"
docker compose -f /home/nathanael/dev/immich_kiosk_tizen/compose.yaml run --rm tizen profile-create ImmichKiosk
```

`$(pwd -P)` désigne le dossier courant de l'hôte. Il est monté en lecture seule dans `/certificates` ; l'option `-f` permet de lancer Compose sans revenir dans le dépôt. Les deux noms de fichiers sont imposés par le script. Ne pas placer les certificats dans le dépôt.

Depuis le dépôt, on peut aussi fournir le chemin absolu du dossier privé :

```sh
export TIZEN_CERTIFICATES_DIR="/chemin/absolu/vers/certificats"
docker compose run --rm tizen profile-create ImmichKiosk
```

Les mots de passe sont demandés sans affichage ; Entrée au second réutilise celui de l'auteur. La commande vérifie les PKCS12 et le trousseau, copie les certificats dans `/signing/certificates` et refuse d'écraser un profil existant. `device-profile.xml` n'est pas un `profiles.xml`. Pour réparer un profil dont le trousseau est incomplet, conserver le dossier externe et exécuter `docker compose run --rm tizen profile-repair ImmichKiosk` ; les anciens XML sont sauvegardés dans le volume privé.

#### Importer un registre existant

Avec un véritable `profiles.xml` dans le dossier privé courant, importer le registre. Ses chemins de certificats doivent référencer le montage `/certificates` :

```sh
export TIZEN_CERTIFICATES_DIR="$(pwd -P)"
docker compose -f /home/nathanael/dev/immich_kiosk_tizen/compose.yaml run --rm tizen profile-import
```

Cette commande remplace `/signing/profiles.xml` sans sauvegarde automatique. Elle copie uniquement le registre XML : elle ne copie pas les certificats et ne recrée pas les mots de passe du trousseau. Conserver le montage externe lors de la signature. Pour des certificats provenant d'une autre machine, préférer `profile-create` avec les deux `.p12` ; si le profil est déjà importé mais son trousseau incomplet, utiliser `profile-repair` avec ces mêmes certificats.

**Sauvegarder tout le volume `signing` et conserver le même certificat auteur pour les mises à jour. Ne pas exécuter `docker compose down -v` sans sauvegarde.** `/home/sdk` pointe vers `/signing`. Le trousseau chiffré et sa clé locale y persistent ; ils ne protègent pas contre un accès à l'intégralité du volume. La CLI officielle transmet les mots de passe comme arguments de processus : utiliser une machine de confiance, sans fournir ces secrets dans les commandes ou variables d'environnement.

### Signer et installer

Remplacer `NOM_PROFIL`, `IP_TV` et `NOM_CIBLE` par les valeurs du profil et de la TV autorisée :

```sh
docker compose run --rm tooling npm run build
docker compose run --rm tizen package NOM_PROFIL
docker compose run --rm tizen connect IP_TV
docker compose run --rm tizen install IP_TV NOM_CIBLE /workspace/artifacts/signed/ImmichKiosk.wgt
```

La signature produit `artifacts/signed/ImmichKiosk.wgt`, renommé sans espace sans modifier les octets signés. Activer le mode développeur, autoriser la machine et vérifier que le certificat distributeur couvre la TV. `install` reconnecte SDB dans son propre conteneur ; une connexion précédente ne persiste pas après `--rm`. Le script refuse `UNSIGNED` et exige les fichiers de signature, sans remplacer la validation cryptographique de Tizen.

Tester le réseau bridge en premier. Sur Linux uniquement, si nécessaire, remplacer `tizen` par `tizen-host` pour utiliser le réseau hôte. Sur TV, valider d'abord Simple ou Enrichi, puis Full, le clavier, les touches média, le retour, la sortie et la reprise. Consigner modèle, firmware, version/digest Kiosk et comportement mémoire/réseau lors d'un essai prolongé.

Le test SDK suivant utilise des certificats synthétiques et des volumes anonymes jetables ; il couvre création, réparation, restauration et signature dans une nouvelle session D-Bus :

```sh
docker compose run --rm --no-deps --volume /signing --volume /certificates --entrypoint python3 tizen /workspace/tests/tizen-profile.py
```

## Contribution

1. Créer un fork et une branche dédiée.
2. Modifier les sources dans `app/` ou `tools/`, pas les sorties `dist/` et `artifacts/`.
3. Ajouter les tests adaptés et exécuter les suites unitaires et navigateur dans Docker.
4. Vérifier la cible Chromium 69 ; distinguer résultats simulés et essais réels sur TV.
5. Soumettre une pull request sans certificats, secrets ni fichiers générés.

## Licence et références

Aucune licence globale du projet n'est spécifiée. Cette adaptation Tizen n'est pas une application officielle d'Immich Kiosk.

Le logo provient sans modification de [`assets/logo.svg` d'Immich Kiosk v0.44.1](https://github.com/damongolding/immich-kiosk/blob/v0.44.1/assets/logo.svg). Sa source est conservée dans [app/icon.svg](app/icon.svg), avec la [licence AGPL-3.0 amont](app/immich-kiosk-logo.LICENSE.txt). L'icône PNG 117 × 117 a été convertie le 28 septembre 2026 ; la régénérer avec `docker compose run --rm tooling npm run icon`.

- [Documentation Immich Kiosk](https://docs.immichkiosk.app/)
- [Sources Kiosk v0.44.1](https://github.com/damongolding/immich-kiosk/tree/v0.44.1)
- [Middleware et routes Kiosk](https://github.com/damongolding/immich-kiosk/blob/v0.44.1/main.go)
- [Moteurs Web Samsung TV](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html)
- [Installation du SDK Samsung TV](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html)
- [API Samsung AppCommon](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/appcommon-api.html)
