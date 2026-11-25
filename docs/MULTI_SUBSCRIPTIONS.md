# Variante Codex, Mistral Vibe et Freebuff

Cette branche ajoute les offres interchangeables demandées pour l'installation active. Aucun abonnement OpenCode Go n'est requis.

```bash
git switch multi-subscriptions
./scripts/bootstrap.sh --with-tools
node scripts/configure-agents.mjs
agentctl profile list
agentctl provider list
```

Le profil `codex-vibe-free` utilise Codex comme coordinateur et pour l'UI, et Mistral Vibe comme worker. Freebuff est disponible séparément via `freebuff-public`. `codex-month` utilise Codex pour tous les rôles et `mistral-month` utilise Vibe pour tous les rôles. Examiner les fichiers JSON et `agentctl status` pour confirmer la répartition actuelle ; désactiver un fournisseur bloque les rôles qui en dépendent.

```bash
agentctl profile use codex-vibe-free
agentctl doctor
```

Pour commencer avec un rôle prêt, prévisualiser sa commande :

```bash
agentctl run --project /chemin/absolu/vers/projet --task "Inspecte le projet et rapporte un contrôle simple" --role orchestrator --dry-run
```

Retirer `--dry-run` démarre le rôle. Cette commande reste un lancement autonome. Pour un coordinateur qui délègue aux autres agents dans Orca, suivre [le guide Orca](ORCA.md).

## Comptes et modèles

Codex utilise le compte ChatGPT connecté au CLI. Vérifier ce compte avec `codex login status`. Le modèle choisi doit être disponible sur ce compte et dans sa région ; la valeur configurée n'est pas une garantie de quota.

Mistral Vibe utilise son flux natif de connexion. Vérifier l'offre et le modèle actifs avant de travailler ; une clé API Mistral et un abonnement Vibe sont des accès distincts. Ne pas substituer une clé API facturée à une connexion d'abonnement sans décision explicite. Le test local a réussi avec `mistral-large-4-0` et l'export indiquait un coût de 0,0 USD ; cela ne prouve pas l'existence d'un abonnement Vibe payant ni un coût nul pour les travaux futurs.

Freebuff 0.2.38 est interactif : il ne fournit pas de paramètre documenté pour transmettre une tâche en mode headless. Le lancement ouvre donc l'assistant dans le projet et la tâche doit être saisie dans sa session. Il exige les options `--allow-freebuff --public-project` dans agent-stack. Lors du contrôle local, la session affichait `0/4 hours remaining` : la génération était indisponible faute de quota et aucune requête n'a été lancée.

## Vérifications à interpréter

Un contrôle de présence vérifie l'exécutable ; une connexion confirme un compte ; un test réel vérifie le parcours pour le modèle et la tâche concernés. Les tests simulés du dépôt couvrent le routage et les blocages, pas les quotas ni les réponses des fournisseurs.

Avant un premier travail utile, exécuter une petite tâche sur un dépôt de démonstration et vérifier les fichiers modifiés ainsi que le résultat du contrôle. Les éventuels blocages de connexion ou limites upstream doivent rester visibles dans le bilan de validation.

Le modèle Codex actif est `gpt-6-luna` (effort medium), validé dans une session Orca réelle et via `agentctl`. Le worker Vibe utilise `mistral-large-4-0` (medium). Le routeur vérifie en direct que Vibe résout un accès Chat/Mistral Code ; un accès API ou inconnu est bloqué. Le helper dépend des interfaces natives de Vibe 3.1.4 et refuse le lancement si elles deviennent incompatibles.
