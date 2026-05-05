# Guide — Obtenir le Facebook Page Access Token (15 min)

Pour activer la publication automatique FB + IG des posts ZenithMoto. Sans ça, le publisher skip silencieusement (logs montrent "SKIPPED_NO_KEY").

## Étape 1 — Créer une App Meta (si pas déjà fait)

1. Aller sur https://developers.facebook.com/apps
2. Cliquer **"Créer une application"**
3. Choisir type **"Business"**
4. Nom de l'app : `ZenithMoto Publisher`
5. Email de contact : `zenithmoto@gmail.com`
6. Compte business : ton compte perso (par défaut)

## Étape 2 — Ajouter les produits nécessaires

Dans le dashboard de l'app :
1. **Facebook Login for Business** → Configurer
2. **Instagram Graph API** → Configurer (pour publier sur IG depuis FB)
3. **Pages API** → activé par défaut

## Étape 3 — Connecter la page Facebook ZenithMoto

1. Aller dans **Paramètres → Tokens d'accès**
2. Sélectionner la page **ZenithMoto** (ou Moto Zénith) dans le dropdown
3. Cliquer **"Générer un token"** avec les permissions :
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `pages_manage_metadata`
   - `instagram_basic`
   - `instagram_content_publish`

## Étape 4 — Récupérer le Page ID

1. Aller sur ta page Facebook ZenithMoto
2. Cliquer **"À propos"** → tout en bas, le **Page ID** (ex: `123456789012345`)
3. Copier ce nombre

## Étape 5 — Convertir le token court → long terme (60 jours → infini)

Le token de l'étape 3 expire en ~1h. Il faut un **long-lived token** :

1. Ouvrir https://developers.facebook.com/tools/debug/accesstoken/
2. Coller le token court
3. Cliquer **"Étendre le token"** → tu obtiens un token valide 60 jours
4. **IMPORTANT** : pour un token qui n'expire JAMAIS (recommandé), aller sur https://developers.facebook.com/tools/explorer/
   - Coller le long-lived user token
   - Sélectionner la page ZenithMoto dans le dropdown "Page Access Token"
   - Le token affiché est **page-level + never expires** ✓

## Étape 6 — Coller dans Railway

1. Aller sur https://railway.app/project/[ZenithMoto] → **Variables**
2. Ajouter :
   ```
   FACEBOOK_PAGE_ID=123456789012345          (de l'étape 4)
   FACEBOOK_PAGE_ACCESS_TOKEN=EAA...long...  (de l'étape 5)
   ```
3. Redeploy automatique

## Étape 7 — Récupérer aussi l'Instagram Business ID (bonus)

Si la page FB est liée à un compte Instagram Business :

1. Sur https://developers.facebook.com/tools/explorer/
2. Query : `GET /{PAGE_ID}?fields=instagram_business_account`
3. Récupère le `id` retourné → c'est ton `INSTAGRAM_USER_ID`
4. Le **même** `FACEBOOK_PAGE_ACCESS_TOKEN` fonctionne pour IG :
   ```
   INSTAGRAM_USER_ID=789012345678901
   INSTAGRAM_ACCESS_TOKEN=EAA...long...      (= même token)
   ```

## Vérification

Après redeploy Railway, lance manuellement un publish pour tester :

```bash
railway run node -e "require('./src/publisher.js').publishMoto({ name: 'TMAX 530', img: 'https://edcvmgpcllhszxvthdzx.supabase.co/storage/v1/object/public/zenithmoto-content/motos/tmax.jpg' })"
```

Logs attendus :
```
✓ Facebook: posté (ID: 12345_67890)
✓ Instagram: posté (ID: 17891234)
```

## Si ça plante

| Erreur | Cause | Fix |
|--------|-------|-----|
| `Invalid OAuth access token` | Token expiré | Refaire étapes 3-5 |
| `(#10) Application does not have permission` | Permissions manquantes | Ajouter `pages_manage_posts` |
| `Unsupported post request` | Page ID invalide | Vérifier que le PAGE_ID est numérique pur |
| `Instagram User Id missing` | Compte IG pas business | Convertir en Business via app Instagram |

## Coût

**Gratuit**. Meta facture 0 pour les publications via Graph API tant que tu restes < 200 calls/h (largement OK pour ZenithMoto qui post 1-3×/jour).

## Vérifier le token n'expire pas

```bash
curl "https://graph.facebook.com/v19.0/debug_token?input_token=$FACEBOOK_PAGE_ACCESS_TOKEN&access_token=$FACEBOOK_PAGE_ACCESS_TOKEN"
```

Si `expires_at: 0` → token éternel ✓
Si `expires_at: 1234567890` → date d'expiration en timestamp Unix
