# Installation, comptes et récupération

## Vérifier avant d'installer

```bash
./scripts/bootstrap.sh --check
```

Ce contrôle vérifie les prérequis et les composants upstream. Le bootstrap refuse une installation npm sans `package-lock.json`. Pour compiler sans ajouter de commande au `PATH`, utiliser `./scripts/bootstrap.sh --no-link`.

Les versions de référence et les empreintes des archives Codebase Memory sont dans `dependencies.lock.json`. Superpowers est fixé à un commit. Orca est installé par un cask Homebrew évolutif : sa version réelle doit être contrôlée après installation ; le numéro du lock est une référence, pas une garantie de gel du cask.

## Connecter un fournisseur

```bash
agentctl provider list
agentctl provider login <identifiant>
agentctl provider enable <identifiant>
```

Remplacer `<identifiant>` par une valeur de `provider list`. Les fournisseurs disponibles dépendent de la branche et de `configs/providers.json`. L'authentification utilise les outils natifs ; conserver les clés dans leur stockage local et les saisir uniquement dans le flux de connexion prévu. Ne pas mettre de clé dans un profil ou un fichier versionné.

`provider enable` autorise le routage local ; il ne prouve pas que la connexion est encore valide, ni qu'un abonnement ou quota est disponible. `provider disable` empêche agent-stack de l'utiliser, sans résilier l'offre.

## Vérifier la mémoire et les skills

Après le bootstrap et avec Codex, Vibe et Orca installés, configurer les intégrations natives sur macOS ou Linux :

```bash
node scripts/configure-agents.mjs
```

Le script sauvegarde les configurations Codex/Vibe dans `~/.config/agent-stack/backups/native`, enregistre le MCP Codebase Memory, installe les guides Orca CLI/orchestration et ajoute les liens vers les skills Superpowers. Il conserve les skills déjà présents. Sur Windows natif, il s'arrête avant modification : utiliser WSL2.

```bash
codebase-memory-mcp --version
node scripts/install-upstream.mjs --check all
```

Le binaire Codebase Memory et le checkout Superpowers doivent ensuite être découverts par le harness utilisé. Un checkout installé n'est pas une preuve de chargement du skill. Vérifier dans la session réelle que Codebase Memory est disponible, indexer le projet et demander la liste des skills.

Les connexions MCP et les plugins utilisent les configurations propres aux agents. Le lancement OpenCode prépare sa configuration gérée séparément de la configuration globale. Sur Orca, utiliser les guides correspondant à la version installée : `orca skills list` et `orca skills get orchestration`.

Sur ce Mac, l'enregistrement natif de la mémoire a été effectué dans Codex et Vibe après sauvegarde des configurations. Pour une nouvelle installation, vérifier d'abord les entrées existantes et sauvegarder les configurations avant ces commandes :

```bash
codex mcp add codebase-memory -- "$HOME/.local/bin/codebase-memory-mcp"
vibe mcp add codebase-memory --transport stdio --command "$HOME/.local/bin/codebase-memory-mcp"
```

L'auto-activation de l'installeur upstream Codebase Memory a échoué lors de la préparation locale ; l'enregistrement natif évite de déclarer cette activation automatique réussie. Les sauvegardes de préparation sont sous `~/.config/agent-stack/backups/native`.

Les guides d'orchestration et de CLI Orca peuvent être installés pour les trois agents avec :

```bash
orca skills install --agent codex,mistral-vibe,freebuff
```

Cette commande installe les guides Orca, distincts des skills Superpowers. Redémarrer une session pour vérifier leur découverte.

## État local et désinstallation

L'état est stocké par défaut dans `~/.config/agent-stack`. `AGENT_STACK_HOME` permet de choisir un autre dossier. Le lanceur utilise `~/.local/bin` ; `AGENT_STACK_BIN_DIR` change cette destination pour les scripts d'installation.

```bash
agentctl rollback --last
node scripts/link-cli.mjs uninstall
```

La première commande restaure une sauvegarde d'état gérée. La seconde retire uniquement le lanceur marqué comme appartenant au projet. Les comptes natifs, le dépôt et les fichiers du projet de travail sont conservés. Les outils upstream installés restent présents ; les supprimer séparément si souhaité.

`agentctl update --check` fournit les informations de mise à jour disponibles. `--apply` ne doit être utilisé qu'après lecture de ce contrôle et avec un dépôt propre ; il ne constitue pas une mise à jour générale de tous les abonnements et CLI. Sous Windows natif, `--apply` et les lancements réels d'agents sont refusés avant mutation ; effectuer ces opérations dans le checkout Linux de WSL2. La configuration, les diagnostics et `--dry-run` restent disponibles nativement.
