# agent-stack

Un environnement de développement agentique reproductible, principalement pour macOS : Orca pour superviser les agents, `agentctl` pour choisir un profil et lancer les CLI installées, Codebase Memory pour explorer le code et Superpowers pour guider le travail.

Le projet utilise [Orca](https://github.com/stablyai/orca) comme dépendance externe. `agentctl run` lance un agent autonome ; le workflow de délégation Orca est décrit dans [le guide Orca](docs/ORCA.md).

## Installer

Prérequis : Git, Node.js 22 ou plus et npm. Sur macOS, Homebrew est nécessaire pour installer Orca automatiquement.

```bash
git clone https://github.com/Altorru/agent-stack.git
cd agent-stack
./scripts/bootstrap.sh --with-tools
export PATH="$HOME/.local/bin:$PATH"
node scripts/configure-agents.mjs
agentctl doctor
agentctl profile list
```

Le bootstrap installe les dépendances npm verrouillées, compile la CLI et crée un lanceur dans `~/.local/bin`. `--with-tools` ajoute les outils upstream gérés. Le script `configure-agents.mjs`, exécuté ensuite avec Codex, Vibe et Orca installés, sauvegarde les configurations natives, enregistre Codebase Memory dans Codex et Vibe, puis installe les guides Orca et les liens de skills Superpowers. Les skills existants sont conservés. L'installation des outils et la connexion aux comptes sont deux étapes distinctes.

Windows : `./scripts/bootstrap.ps1` depuis PowerShell installe la gestion des profils, les diagnostics et les prévisualisations `--dry-run`. Le lanceur est `~/.local/bin/agentctl.cmd` ; ajouter ce dossier au `PATH`. Les lancements réels d'agents, `update --apply` et `configure-agents.mjs` se font depuis un checkout Linux dans WSL2. Orca requiert son installeur natif sur Windows et Linux ; ces plateformes n'ont pas été validées de bout en bout.

## Choisir une configuration

- `main` conserve les profils Reddit de référence et leur adaptation `reddit-go-only`.
- `multi-subscriptions` ajoute la variante Codex + Mistral Vibe + Freebuff.

```bash
agentctl status
agentctl profile list
agentctl profile use reddit-go-only
agentctl provider list
```

Les profils de référence payants restent inactifs par défaut. Le profil Go nécessite une connexion OpenCode Go ; sélectionner un profil ne souscrit aucun abonnement. Le projet ne bascule pas automatiquement vers une API payante.

## Tester un lancement

Dans le dossier du projet à faire travailler, fournir un chemin absolu :

```bash
agentctl run --project /chemin/absolu/vers/projet --task "Inspecte le projet et propose un petit changement vérifiable" --role worker --dry-run
```

Le mode `--dry-run` vérifie les règles locales et affiche la commande prévue, sans appeler de modèle. L'authentification et le modèle OpenCode effectif sont vérifiés au lancement réel. Retirer ce drapeau exécute la CLI correspondante. Un fournisseur désactivé, un modèle OpenCode différent ou une autorisation manquante bloque le lancement. Une API facturée à l'usage exige `--allow-paid`. Freebuff exige `--allow-freebuff --public-project` et reste interactif dans la version installée.

## Exploiter et maintenir

```bash
agentctl doctor
agentctl usage --period month
agentctl update --check
agentctl rollback --last
```

`usage` porte sur les reçus locaux de lancement ; il ne remplace pas les relevés de facturation des fournisseurs. `rollback --last` restaure l'état géré par agent-stack, pas les modifications d'un projet applicatif ni les abonnements.

[Installation et récupération](docs/OPERATIONS.md) · [Plan et critères](docs/PLAN.md) · [Choix d'architecture](docs/adr/001-stack-native.md) · [Sources et limites](docs/SOURCES.md)
