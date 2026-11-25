# Validation locale du 25 novembre 2026

Ce bilan distingue les essais natifs des tests du routeur. Les résultats ci-dessous concernent le Mac de préparation et les versions installées ; les quotas futurs et les autres plateformes restent à vérifier.

| Parcours | Résultat observé | Limite |
| --- | --- | --- |
| Codex natif | Réponse attendue `AGENT_STACK_CODEX_OK` avec `gpt-6.1-sol`, effort medium, en lecture seule | Valide ce petit échange avec le compte ChatGPT connecté |
| Mistral Vibe natif | Réponse attendue `AGENT_STACK_VIBE_OK` avec `mistral-large-4-0`, effort medium ; export `cost_usd: 0.0` | L'offre locale observée ne démontre pas un abonnement Vibe payant |
| Orca | Version 1.4.274 installée, onboarding effectué, Codex sélectionné par défaut, mode yolo désactivé | Un worker supervisé complet demande son propre reçu et sa vérification |
| Guides Orca | Guides CLI/orchestration installés pour Codex, Mistral Vibe et Freebuff | La présence des fichiers ne remplace pas leur découverte par une nouvelle session |
| Codebase Memory | Binaire upstream installé ; inscription MCP native dans Codex et Vibe après sauvegarde | L'auto-activation upstream a échoué ; vérifier l'indexation dans une session réelle |
| Freebuff | CLI 0.2.38 disponible, parcours interactif | Aucun test headless n'est annoncé ; tâche à saisir dans la session |
| OpenCode Go | Aucun compte Go connecté | Profil de référence conservé ; aucun abonnement acheté |

Les tests du dépôt et le parcours `agentctl` doivent être consignés après leur exécution finale. Les réponses natives ci-dessus ne prouvent pas à elles seules le fonctionnement complet du routeur ou du workflow Orca Run/Task/Dispatch.
