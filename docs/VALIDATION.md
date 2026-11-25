# Validation locale du 25 novembre 2026

Ce bilan distingue les essais natifs des tests du routeur. Les résultats ci-dessous concernent le Mac de préparation et les versions installées ; les quotas futurs et les autres plateformes restent à vérifier.

| Parcours | Résultat observé | Limite |
| --- | --- | --- |
| Codex natif | Réponse attendue `AGENT_STACK_CODEX_OK` avec `gpt-6.1-sol`, effort medium, en lecture seule | Valide ce petit échange avec le compte ChatGPT connecté |
| Mistral Vibe natif | Réponse attendue `AGENT_STACK_VIBE_OK` avec `mistral-large-4-0`, effort medium ; export `cost_usd: 0.0` | L'offre locale observée ne démontre pas un abonnement Vibe payant |
| Orca | Version 1.4.274 installée, onboarding effectué ; worker Codex GPT-6-Luna medium lancé, lecture du package, MCP `list_projects` (1 projet), rapport `worker_done` accepté | Envoi du rapport autorisé ponctuellement hors sandbox ; les protections restent actives |
| Guides et skills | Guides Orca CLI/orchestration et liens Superpowers installés ; intégration reproductible via `scripts/configure-agents.mjs` | La présence des fichiers ne remplace pas leur découverte par une nouvelle session |
| Codebase Memory | Projet indexé par la CLI : 170 nœuds et 290 arêtes ; inscription MCP native dans Codex et Vibe après sauvegarde | L'auto-activation upstream a échoué ; inscription native utilisée |
| Freebuff | CLI 0.2.38 et session interactive connectée ; affichage `0/4 hours remaining` | Génération indisponible faute de quota ; aucune requête lancée |
| OpenCode Go | Aucun compte Go connecté | Profil de référence conservé ; aucun abonnement acheté |
| Windows natif | Gestion de configuration, diagnostics et prévisualisation prévus ; lancements et `update --apply` refusés avant mutation | Exécution réelle des agents dans WSL2 ; pas de recette complète Windows |

Le premier passage des tests du dépôt comptait 11 tests réussis, avec des exécutables Node simulés pour les frontières de lancement sur les différentes plateformes. Des contrôles supplémentaires, notamment le garde-fou Vibe, et le bilan CI final restent à consigner. Les réponses natives ci-dessus ne prouvent pas à elles seules le fonctionnement complet du routeur ou du workflow Orca Run/Task/Dispatch.

## Contrôles de la variante active

- `agentctl doctor --json` : `ok: true` pour `codex-vibe-free`. Vibe vérifie en direct le compte natif (`plan_type=chat`) et le modèle effectif, sans génération ; une offre API ou inconnue bloque le lancement. Le drapeau d’abonnement Vibe payant reste faux.
- Parcours `agentctl` : Codex GPT-6-Luna medium a répondu `AGENTCTL_LUNA_OK` ; Vibe Mistral Large 4 medium a répondu `AGENTCTL_VIBE_OK`.
- Douze tests du routeur passent ; tests bootstrap et protocole Orca passent. La CI de `main` a réussi les six combinaisons Linux/macOS/Windows × Node 22/24.
- Lancement Orca corrigé : le shell avait une fonction Codex utilisant un dossier de compte alternatif. Le chemin absolu du binaire et le dossier Codex principal sont désormais explicités dans les paramètres Orca. Les alias des autres outils restent disponibles.
- Le premier worker utilisant le compte alternatif a échoué ; le test suivant, avec le compte principal et son MCP, a réussi. La vérification est conservée dans les reçus locaux ignorés par Git.
