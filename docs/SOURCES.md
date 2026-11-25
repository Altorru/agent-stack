# Sources et limites

Sources consultées pour la préparation du 25 novembre 2026 :

- [Post Reddit d'origine](https://www.reddit.com/r/DeepSeek/comments/1xg0ymi/you_guys_asked_about_my_dsv41_flash_1017_orca/) : les deux configurations et les principes d'orchestration. Les tarifs cités par l'auteur ne sont pas une garantie de coût ou de quota pour ce projet.
- [Orca upstream](https://github.com/stablyai/orca) et les guides embarqués de l'installation 1.4.274 : commandes réellement disponibles. La documentation indexée précédemment pouvait porter sur 1.4.256 ; les guides locaux priment pour les exemples.
- [Codebase Memory](https://github.com/DeusData/codebase-memory-mcp) : version 0.12.1, archives et SHA256 des releases.
- [Superpowers](https://github.com/obra/superpowers), dont les instructions propres à chaque harness : commit fixé dans `dependencies.lock.json`.

Le fichier Markdown de 470 lignes mentionné dans le chat d'étude n'était pas accessible comme pièce jointe lors de la reprise. `docs/PLAN.md` reprend les décisions visibles du chat et les contraintes d'implémentation ; il ne prétend pas être cet export original.

Les profils Reddit conservent les modèles décrits par l'auteur. Leur disponibilité doit être vérifiée auprès des fournisseurs au lancement. Le profil Go seul est une adaptation : l'original économique utilise DeepSeek direct pour le coordinateur, contrairement à cette adaptation.
