# Immich Kiosk pour Tizen

Application Web locale pour afficher les photos d'un serveur Immich Kiosk sur une télévision Samsung ciblant **Tizen 6.5 / Chromium 85**.

L'application ne contacte pas directement Immich : Kiosk conserve la sélection des photos et la clé API Immich. Les modes Simple et Enrichi utilisent un lecteur local, sans exécuter le HTML ou les scripts distants. Le mode Full affiche le site original dans une iframe isolée, après confirmation.

## État du projet

- Lecteur et interface de configuration implémentés en HTML, CSS et JavaScript, sans framework.
- Contrat Kiosk **v0.44.1** étudié au commit `d567ac041fc93c3d5421aecdcdf5941118022ccb`, avec fixtures synthétiques et anonymisées. Les autres versions sont refusées explicitement par les lecteurs locaux ; Full ne passe pas par cet adaptateur.
- Tests exécutés dans Docker avec Node **22.14.0**, Playwright **1.51.1** et Chromium **134**.
- Dernière validation : **27 tests unitaires et 11 groupes de tests navigateur réussis**.
- Paquet non signé généré ; SDK Tizen, extensions Samsung, signature et installation sur TV non validés.
- Des sondes HTTPS/CORS de diagnostic ont été réalisées, mais l'intégration complète avec le serveur réel et les essais sur TV restent à effectuer. La compatibilité matérielle Tizen 6.5 n'est pas validée.

**Le fichier `artifacts/immich-kiosk-UNSIGNED.wgt` est une archive de test non signée, pas un paquet prêt à installer sur TV.**

## Fonctionnalités

- Trois présentations mémorisées : Simple, Enrichi et Full.
- Photos plein écran, affichage contenir ou remplir, durée locale de 15 secondes par défaut.
- Précédent, suivant et pause/reprise ; historique borné à 10 photos et une photo préchargée.
- Remplacement de la photo seulement après décodage réussi.
- Réglages en français, focus visible et navigation directionnelle.
- URL HTTP(S) configurable, chemins de base et paramètres répétés conservés.
- Mot de passe Kiosk facultatif, envoyé dans l'en-tête `X-Api-Key` en Simple/Enrichi et dans le paramètre d'URL `password` en Full.
- Mémorisation du mot de passe désactivée par défaut ; suppression du secret enregistré dès que la case est décochée.
- Requêtes annulables, délais bornés, trois relances réseau maximum et suspension en arrière-plan.
- Dernière photo conservée en cas d'erreur transitoire ; aucune relance automatique après une erreur d'authentification observable.

Les lecteurs locaux ne gèrent pas les vidéos ni la météo. Le fonctionnement hors ligne, le démarrage à l'allumage de la TV, l'authentification Basic et les portails d'authentification externes sont hors périmètre. Full délègue la présentation au site distant, sans garantir ses fonctionnalités sur TV. Aucune publication Samsung Store n'est prévue dans cette livraison.

## Choix de présentation

Le sélecteur **Présentation** propose trois modes. Les réglages enregistrés avant son ajout utilisent automatiquement Simple.

| Mode | Présentation | Authentification |
| --- | --- | --- |
| Simple | Photos seules, lecteur local et commandes de télécommande | Mot de passe par `X-Api-Key` |
| Enrichi | Même lecteur, avec horloge, date française et apparition en fondu | Mot de passe par `X-Api-Key` |
| Full | Site Kiosk original dans un cadre isolé, disposition et rythme natifs | Mot de passe dans l'URL du cadre, après confirmation |

### Enrichi

L'heure et la date proviennent de l'appareil qui exécute l'application, dans son fuseau horaire. L'horloge est actualisée à chaque minute et suspendue en arrière-plan. Le fondu respecte la préférence système de réduction des animations. Le lecteur conserve les mêmes filtres, historique et commandes que Simple.

Il ne s'agit pas d'une reproduction complète de Kiosk : la météo, les informations détaillées sur les photos et les dispositions multiples ne sont pas ajoutées au lecteur local.

### Full

Full conserve les paramètres de l'URL, sans imposer `layout=single` ou les options photos uniquement. La durée et l'ajustement locaux sont désactivés : le site Kiosk les gère lui-même. Les lancements manuels via **Ouvrir le site Full** et **Lancer le diaporama** demandent une confirmation. Une fois les réglages enregistrés, Full démarre automatiquement au rechargement de l'application, sans nouvelle confirmation en HTTPS. Un mot de passe nécessaire au démarrage doit être mémorisé via la case dédiée. En HTTP avec mot de passe, la confirmation reste obligatoire avant l'envoi du secret.

Full utilise l'authentification native `?password=...` de Kiosk : une iframe ne peut pas joindre `X-Api-Key` à sa navigation. Le mot de passe peut être saisi dans son champ ou fourni dans l'URL collée. Il est extrait de l'adresse des réglages, puis ajouté avec un encodage adapté uniquement à l'URL du cadre au lancement. Les paramètres répétés et la disposition Kiosk sont conservés.

**Cette exception est limitée à Full.** La confirmation de lancement manuel rappelle que le secret peut apparaître dans les journaux du serveur ou du proxy et les données du navigateur, même en HTTPS. En HTTP, elle avertit également de l'absence de chiffrement. Aucun chargement du cadre ne démarre en cas d'annulation. L'application n'enregistre pas l'URL contenant le secret ; le champ mot de passe reste soumis à la case de mémorisation. Le démarrage automatique HTTPS utilise les réglages précédemment confirmés ; recharger le cadre ou reprendre après arrière-plan réutilise l'autorisation de la session en cours. Simple et Enrichi continuent d'utiliser l'en-tête, sans secret dans les URL.

Le cadre Full occupe tout l'écran, sans bandeau ni boutons locaux. Il est réservé à la lecture autonome : il ne reçoit ni les clics ni le focus clavier. Les commandes locales précédent/suivant/pause ne contrôlent pas Kiosk. **Haut** ou **Retour** ouvrent les réglages ; relancer le mode recharge le site. Le cadre est supprimé en arrière-plan ou à la sortie ; au retour, le site est rechargé et son état de lecture peut être réinitialisé.

Le site doit avoir une origine différente de l'application locale. Le sandbox autorise ses scripts et son origine, mais pas la navigation de la fenêtre principale, les fenêtres supplémentaires ou les formulaires. Le parent ne peut pas inspecter le résultat HTTP du cadre : un événement de chargement ne prouve ni l'authentification ni la lecture effective. Même si le cadre reste vide ou si le serveur refuse son affichage, Haut et Retour permettent de retrouver les réglages.

Les en-têtes `X-Frame-Options` ou CSP `frame-ancestors` du serveur peuvent interdire l'intégration. Une page HTTPS ne peut pas nécessairement intégrer un site HTTP. Ses scripts, ressources, éventuels cookies et caches suivent le fonctionnement du site distant, contrairement aux modes locaux. Les essais sur le moteur réel de la TV restent à effectuer, comme indiqué dans l'état du projet.

## Prérequis

- Docker Engine et Docker Compose fonctionnels, avec accès au daemon.
- Un serveur Immich Kiosk existant, accessible depuis le navigateur ou la TV.
- Pour le déploiement uniquement : outillage officiel Tizen/Samsung, licences acceptées, profil de signature compatible avec la TV et mode développeur activé sur celle-ci.

**Tout l'outillage s'exécute dans Docker.** Ne pas installer Node, Playwright, Java, le SDK Tizen ou SDB sur l'hôte. Aucun conteneur privilégié ni montage du socket Docker n'est requis.

Les commandes suivantes sont à exécuter depuis la racine du projet.

## Démarrage rapide

```sh
docker compose build tooling
docker compose up dev
```

Ouvrir <http://127.0.0.1:8080> depuis la machine de développement, ou `http://ADRESSE_IP_DE_LA_MACHINE:8080` depuis un autre appareil du réseau. Le port est publié sur toutes les interfaces IPv4 par défaut (`0.0.0.0`), sous réserve du pare-feu et du routage. Ce serveur de développement n'a pas d'authentification : le réserver à un réseau de confiance, sans exposition publique.

L'aperçu réseau ne remplace pas l'installation du widget Tizen : l'application installée sur la TV exécutera ses fichiers embarqués. Pour restreindre à nouveau l'aperçu à la machine locale :

```sh
PREVIEW_HOST=127.0.0.1 docker compose up -d dev
```

Pour utiliser un autre port :

```sh
PREVIEW_PORT=8081 docker compose up dev
```

Les outils s'exécutent avec les UID/GID `1000:1000` par défaut. Si nécessaire, définir `LOCAL_UID` et `LOCAL_GID` avec les identifiants de l'utilisateur hôte avant de lancer Compose. Les dépendances et caches sont conservés dans des volumes Docker.

## Configuration du lecteur

1. Choisir Simple ou Enrichi pour le lecteur local, puis saisir l'adresse du serveur Kiosk avec son éventuel préfixe et ses filtres, par exemple `https://kiosk.exemple.fr/cadre/?album=album-a&album=album-b`.
2. Saisir le mot de passe natif Kiosk, si nécessaire.
3. Choisir la durée et l'ajustement de l'image.
4. Utiliser **Tester la connexion** pour vérifier les métadonnées, charger une photo et la décoder.
5. Utiliser **Lancer le diaporama**.

Dans les modes locaux, un chemin sans slash final est traité comme un répertoire : `/cadre` devient `/cadre/`. Les ressources distantes doivent rester dans l'origine et le chemin de base autorisés ; les images pointant hors de ce périmètre sont refusées, sans réécriture implicite. Full charge directement l'adresse normalisée : le site original doit déjà fonctionner sous ce chemin.

Les paramètres `password` et `authsecret` présents dans une URL sont extraits vers le champ secret et retirés de l'adresse affichée et enregistrée. Simple et Enrichi transmettent ensuite le secret par en-tête ; Full le remet dans le seul paramètre `password` de l'URL du cadre après confirmation. La mémorisation reste soumise à la case dédiée. Les identifiants intégrés sous la forme `https://utilisateur:motdepasse@serveur/` sont refusés.

Le lecteur demande `layout=single`, `show_videos=false`, `live_photos=false`, `show_animated_gifs=false` et des aperçus plutôt que les originaux. Le paramètre serveur `history` est retiré, car l'historique est géré localement. Si Kiosk désactive les paramètres d'URL avec `disable_url_queries`, ces demandes peuvent être ignorées : le lecteur refuse alors les réponses incompatibles plutôt que de contourner cette restriction.

Si une configuration est enregistrée, l'application tente de démarrer le diaporama à son lancement. Un secret non mémorisé doit être saisi à nouveau après fermeture de l'application. **Effacer les réglages** supprime l'adresse et le mot de passe enregistrés.

### Télécommande

| Touche | Action |
| --- | --- |
| Flèches dans les réglages | Déplacer le focus |
| OK / Entrée sur un champ | Entrer ou terminer la saisie |
| Gauche / droite dans le diaporama | Photo précédente / suivante |
| OK / Entrée dans le diaporama | Pause / reprise |
| Touches média prises en charge | Lecture, pause ou bascule |
| Haut dans le diaporama (Simple, Enrichi ou Full) | Ouvrir les réglages |
| Retour pendant la saisie | Terminer la saisie |
| Retour dans le diaporama | Ouvrir les réglages |
| Retour dans les réglages | Demander confirmation de sortie |

L'API Samsung de gestion de l'économiseur est utilisée si elle est disponible. Le comportement normal est rétabli à la pause, à l'arrêt ou en arrière-plan. Cela ne neutralise pas les protections matérielles de la dalle. Le clavier TV et les touches physiques restent à tester sur le modèle cible.

## Réseau et sécurité

Dans les modes Simple et Enrichi, les fragments Kiosk sont analysés dans un contenu HTML inerte, jamais injectés dans le document actif. Seules des images raster autorisées sont extraites. Les réponses HTML sont bornées à 24 Mio et les images à 16 Mio. Les formats acceptés sont JPEG, PNG et WebP, sous réserve de décodage par le moteur réel. Ces contrôles d'adaptateur ne s'appliquent pas au site distant autonome en Full.

Dans les lecteurs locaux, les images distantes sont récupérées avec authentification puis affichées à partir d'URL Blob. Les redirections sont refusées et le secret n'est pas transmis à une origine tierce. Les URL Blob sont libérées à l'éviction ; aucun cache disque de photos n'est implémenté.

HTTP n'offre aucune confidentialité. Une confirmation est demandée avant la première connexion HTTP avec secret pour l'adresse concernée durant la session. HTTPS requiert un certificat reconnu par le client ; aucun contournement des erreurs TLS n'est prévu. Le stockage local du mot de passe n'est pas un coffre-fort. Ne pas exposer Kiosk publiquement en se reposant uniquement sur son mot de passe natif.

### Limite CORS de Kiosk v0.44.1

Cette limite concerne les appels de l'adaptateur local en Simple et Enrichi. La navigation du cadre Full ne nécessite pas CORS, mais reste soumise à l'authentification et aux restrictions d'intégration du site.

Le code source de cette version enregistre l'authentification avant le middleware CORS. Avec un mot de passe, la requête préliminaire `OPTIONS` nécessaire à `X-Api-Key` peut donc recevoir un `401` avant l'ajout des en-têtes CORS. **Configurer uniquement `allowed_origins` ne suffit pas à corriger cet ordre des middlewares.**

Le lecteur transmet également un identifiant aléatoire `kiosk-device-id` pour isoler le cache de préchargement entre configurations. Cet en-tête nécessite lui aussi une autorisation CORS, même sans mot de passe.

Cette limite a été identifiée dans les sources et reproduite avec un serveur simulé, pas vérifiée sur le serveur de l'utilisateur. Un reverse proxy existant peut modifier le comportement. L'origine réelle de l'application Tizen et les requêtes préliminaires doivent être observées sur TV. Les privilèges Tizen ne doivent pas être considérés comme un contournement de CORS.

Aucun proxy n'est ajouté et aucune configuration serveur n'est modifiée par ce projet. Ne pas désactiver l'authentification ou élargir globalement CORS pour contourner le problème. Une erreur réseau du navigateur ne permet pas toujours de distinguer CORS, TLS, redirection ou serveur inaccessible.

## Tests et construction

```sh
docker compose config --quiet
docker compose run --rm tooling npm test
docker compose run --rm browser
docker compose run --rm tooling npm run build
docker compose run --rm tooling npm run package:unsigned
```

`package:unsigned` reconstruit également les fichiers de l'application avant de créer l'archive.

| Sortie | Description |
| --- | --- |
| `dist/` | Fichiers Web et manifeste Tizen |
| `artifacts/immich-kiosk-UNSIGNED.wgt` | Archive non signée |
| `artifacts/settings-desktop.png` | Capture de l'interface grand écran, générée par les tests navigateur |
| `artifacts/settings-mobile.png` | Capture de l'interface mobile, générée par les tests navigateur |
| `artifacts/enriched-desktop.png` | Capture du lecteur Enrichi sur fixture de test |
| `artifacts/full-desktop.png` | Capture du cadre Full avec site original simulé |

Les tests couvrent les réglages et secrets, le protocole, les filtres répétés, l'historique, les réponses obsolètes, la pause, les relances, le parsing malveillant, les destinations tierces et les parcours clavier. La matrice HTTP/HTTPS utilise des serveurs locaux simulés. Une autorité de certification temporaire est approuvée uniquement par le navigateur de test ; les certificats non fiables restent refusés, sans option de contournement TLS.

Ces tests ne remplacent pas une validation Chromium 85/Tizen, un essai prolongé de mémoire sur TV ou une intégration avec un vrai serveur Kiosk.

## Signature et installation Tizen

Cette procédure est préparée mais **n'a pas été exécutée de bout en bout**. Elle exige un installateur officiel fourni par l'utilisateur, les extensions Samsung nécessaires et un profil existant. La création de certificats peut nécessiter une interaction avec le compte Samsung ; elle n'est pas automatisée ici.

### Configuration de l'environnement

Définir les variables suivantes dans l'environnement utilisé par Compose. Garder l'installateur, les certificats et les secrets hors du projet.

| Variable | Valeur attendue |
| --- | --- |
| `TIZEN_INSTALLER_FILE` | Chemin absolu de l'installateur Linux CLI officiel, par exemple celui de Tizen Studio 6.1 |
| `TIZEN_INSTALLER_SHA256` | Empreinte SHA-256 vérifiée de cet installateur |
| `TIZEN_ACCEPT_LICENSE` | `yes`, uniquement après acceptation des conditions applicables |
| `TIZEN_PACKAGES` | Identifiants vérifiés des paquets à installer ; valeur par défaut `WebCLI` |
| `TIZEN_CERTIFICATES_DIR` | Dossier externe contenant les certificats et `profiles.xml` |

L'installateur est transmis au build comme secret BuildKit. Les certificats sont montés en lecture seule dans `/certificates`. Le profil importé et l'état de signature sont conservés dans le volume privé `signing`. Les chemins du fichier `profiles.xml` doivent référencer les certificats sous `/certificates/...`.

`WebCLI` seul ne garantit pas la présence des extensions Samsung TV et Certificate. Vérifier les paquets et leurs licences officielles avant utilisation. La documentation Samsung exige une extension Certificate au moins **2.0.73** depuis septembre 2025.

### Construction et signature

```sh
docker compose --profile tizen build tizen
docker compose run --rm tizen doctor
docker compose run --rm tizen profile-import
docker compose run --rm tooling npm run build
docker compose run --rm tizen package NOM_PROFIL
```

Remplacer `NOM_PROFIL` par un profil du fichier importé. Les paquets produits par la commande de signature sont placés dans `artifacts/signed/`. La commande `doctor` vérifie la présence des CLI, pas la validité du certificat, des extensions ou de la compatibilité TV.

### Installation privée sur TV

Activer le mode développeur selon la procédure Samsung du modèle, autoriser la machine de développement et vérifier la connectivité réseau. Le certificat de distribution doit autoriser la TV cible lorsque ce mécanisme est requis. Installer uniquement après accord du propriétaire de la TV.

```sh
docker compose run --rm tizen connect IP_TV
docker compose run --rm tizen install IP_TV NOM_CIBLE /workspace/artifacts/signed/NOM_PAQUET.wgt
```

Remplacer les valeurs symboliques par l'adresse de la TV, le nom de cible attendu par la CLI et le nom réel du widget signé. La commande `install` reconnecte SDB dans le même conteneur : la connexion d'un précédent conteneur `--rm` ne persiste pas. Le script refuse les fichiers nommés `UNSIGNED` et exige la présence des fichiers de signature ; cela ne remplace pas la validation cryptographique par Tizen.

Tester d'abord le réseau bridge par défaut. Sur Linux uniquement, si celui-ci empêche la connexion, le service optionnel `tizen-host` permet de répéter ces commandes avec le réseau hôte :

```sh
docker compose run --rm tizen-host connect IP_TV
docker compose run --rm tizen-host install IP_TV NOM_CIBLE /workspace/artifacts/signed/NOM_PAQUET.wgt
```

## Structure

```text
app/                  Interface, lecteur, adaptateur, manifeste et icônes
tests/                Tests unitaires, navigateur et fixtures synthétiques
tools/                Serveur local, construction, paquetage et commandes Tizen
Dockerfile            Environnement Node et Playwright
Dockerfile.tizen      Environnement SDK conditionné à l'installateur et aux licences
compose.yaml          Services, profils et volumes Docker
dist/                 Application construite
artifacts/            Paquets et captures de test
```

## Validation restante

- Relever la version et le digest de l'image Kiosk réellement déployée.
- Vérifier l'origine Tizen, les prérequêtes CORS et les images authentifiées sur le réseau réel.
- Construire l'environnement SDK avec les extensions officielles et vérifier le profil Samsung.
- Signer et installer le widget sur la TV autorisée.
- Tester les photos, le clavier TV, les touches média, le retour, la sortie et la reprise après arrière-plan.
- Effectuer un test prolongé et consigner le modèle de TV, le firmware, la version Kiosk et les résultats mémoire/réseau.

## Références

- [Documentation Immich Kiosk](https://docs.immichkiosk.app/)
- [Sources Kiosk v0.44.1](https://github.com/damongolding/immich-kiosk/tree/v0.44.1)
- [Middleware et routes Kiosk](https://github.com/damongolding/immich-kiosk/blob/v0.44.1/main.go)
- [Moteurs Web Samsung TV](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html)
- [Installation du SDK Samsung TV](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html)
- [API Samsung AppCommon](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/appcommon-api.html)
