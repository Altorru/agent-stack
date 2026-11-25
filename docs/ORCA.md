# Travailler avec Orca

Orca gère les sessions et les workers ; `agentctl run` lance directement une CLI et ne crée pas de Run Orca. Les commandes ci-dessous suivent le guide embarqué de la version Orca 1.4.274. Relire le guide après une mise à jour.

```bash
orca open
orca status --json
orca agent installed --json
orca skills get orchestration
```

Ajouter le dépôt dans Orca et ouvrir son espace de travail avant d'utiliser `--worktree current`. La connexion du runtime et la disponibilité du graphe doivent être établies. Consulter `orca repo add --help` et `orca worktree create --help` pour les options de la version installée.

## Délégation supervisée

Donner au coordinateur [le prompt adapté](../prompts/orchestrator.md), puis la tâche. Le coordinateur doit employer les IDs d'agents réellement installés et les modèles autorisés par le profil.

La séquence native pour un graphe de tâches est :

```bash
orca orchestration run-create --environment local --objective "Réaliser une petite amélioration avec vérification"
orca orchestration task-create --environment local --spec-file /chemin/absolu/task.md
orca orchestration task-list --environment local --ready --brief
```

Récupérer l'identifiant réel de la tâche créée, puis lancer le worker depuis l'espace de travail concerné :

```text
orca orchestration worker-start --environment local --task <task_id> --worktree current --agent <agent_id>
```

Les valeurs entre chevrons sont des identifiants à remplacer par les reçus précédents. `--environment local` conserve le placement sur ce Mac même si le shell sélectionne un environnement distant. Le coordinateur suit les instructions `next` de chaque reçu et attend les notifications Orca. Il ne doit pas relancer un lancement incertain ni déduire d'un silence que le worker est arrêté.

Pour communiquer avec un worker :

```text
orca orchestration send --to dispatch:<dispatch_id> --subject "Vérification" --body "Rapporte les tests et les fichiers modifiés."
orca orchestration worker-read --dispatch <dispatch_id>
```

Le guide embarqué actuel utilise `worker-start` pour créer le Dispatch. Il n'est pas nécessaire de reproduire un ancien exemple `dispatch` manuellement. Les workers terminés se ferment normalement automatiquement ; suivre le reçu si une action supplémentaire est demandée.

Chaque tâche doit préciser l'objectif, les fichiers autorisés, les contraintes et les preuves attendues. Des workers qui modifient les mêmes fichiers exigent des espaces séparés. Le coordinateur vérifie les résultats et annonce les blocages explicitement.

## Limites

- Les modèles OpenCode sont vérifiés dans la configuration effective. Orca ne garantit pas à lui seul le niveau d'effort OpenCode ; ne pas inventer un drapeau d'effort.
- Les authentifications et quotas des CLI restent ceux de leurs fournisseurs.
- La collection privée « Dream Design Team » de l'auteur Reddit n'est pas fournie. Les consignes de revue UI sont une adaptation locale.
- Un runtime démarré n'est pas encore un test de bout en bout d'un worker. Le test doit montrer un reçu de lancement, un résultat et sa vérification.
