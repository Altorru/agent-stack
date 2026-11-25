# Plan d'implémentation agent-stack

Document de reprise des décisions du chat « Étude config et coûts API ». L'export Markdown initial n'étant pas disponible, ce plan formalise les décisions visibles et les critères à vérifier dans l'implémentation.

## Objectif

Réinstaller sur un Mac une stack native supervisée par Orca, choisir facilement les fournisseurs autorisés et retrouver ses profils, ses outils de mémoire et ses méthodes de travail. Le dépôt est public sous Altorru ; il ne contient aucun identifiant personnel.

## Branches et profils

`main` porte les références économiques et premium de l'auteur Reddit. La référence économique décrit DeepSeek API comme coordinateur et Go pour les workers. La référence premium décrit Claude Code avec Opus 5.5, DeepSeek direct pour les workers et Sonnet 5.5 pour l'UI. `reddit-go-only` adapte ces principes à Go seul, sans être présenté comme une copie exacte.

`multi-subscriptions` ajoute ChatGPT Codex, Mistral Vibe et Freebuff. C'est la variante demandée pour l'installation active. Aucun abonnement Go n'est nécessaire à ce parcours. Chaque fournisseur peut être activé ou désactivé localement.

## Composants

- CLI `agentctl` en TypeScript sur Node.js 22 ou plus.
- Profils JSON et registre de fournisseurs versionnés.
- Bootstrap Bash pour macOS/Linux et PowerShell pour Windows.
- Orca upstream, Codebase Memory natif et Superpowers fixé à un commit.
- État et reçus JSONL locaux, sans secrets ni contenu des tâches.
- Tests unitaires et d'intégration avec outils simulés, puis contrôles natifs et essai réel sur un dépôt de démonstration.
- GitHub Actions pour les contrôles du dépôt.

## Contraintes

Conserver les configurations existantes ; utiliser des arguments structurés au lancement des processus ; vérifier le modèle effectif ; empêcher les fallbacks payants implicites ; bloquer Freebuff par défaut sur les projets confidentiels ; garder une restauration d'état ; ne pas inventer les commandes manquantes d'une CLI.

L'activation d'un fournisseur n'achète pas d'offre. Le suivi local ne remplace pas la facturation du fournisseur. Les limites et authentifications doivent être rapportées explicitement.

## Critères d'acceptation

1. Le bootstrap compile et installe le lanceur sans écraser une commande étrangère ; une deuxième exécution conserve la configuration.
2. Les profils sont listables et sélectionnables ; un profil inconnu échoue proprement.
3. Un fournisseur désactivé bloque le lancement et la sélection ne peut pas provoquer de fallback.
4. Les paramètres effectifs sont vérifiés avant le lancement ; les modèles indisponibles sont signalés.
5. Les API facturées et Freebuff exigent leurs autorisations propres.
6. Les sauvegardes d'état permettent une restauration ; les fichiers applicatifs restent sous la responsabilité du dépôt de travail.
7. Les tests couvrent un succès, un échec et une frontière d'intégration pertinente.
8. Les résultats distinguent outils installés, comptes connectés et test réel de bout en bout.
9. Le dépôt GitHub public contient les deux branches et aucun secret.

## Validation à consigner

La validation finale doit préciser les versions installées, les contrôles exécutés, les connexions effectivement établies et les intégrations restant à tester. Une CLI présente ou un `--dry-run` réussi ne suffisent pas à déclarer validé un abonnement ou un workflow Orca complet.
