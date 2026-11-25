# ADR 001 — Stack native et dépendances externes

Décision : conserver Orca upstream, utiliser les CLI natives et ajouter une couche TypeScript légère pour les profils, les contrôles et les reçus.

Cette approche conserve les authentifications natives et permet de changer de fournisseur sans réécrire les projets applicatifs. Elle demande de vérifier les différences entre versions et plateformes. Le projet ne fork pas Orca et ne modifie pas automatiquement les règles `AGENTS.md` des dépôts applicatifs.

Les profils décrivent une intention, les contrôles effectifs décident si le lancement est possible. Aucun fallback payant silencieux. Les secrets restent hors Git et hors télémétrie. Les journaux de lancement ne sont pas des factures et ne constituent pas une preuve de réussite du travail demandé.

`main` contient les références Reddit et les améliorations communes. `multi-subscriptions` ajoute les fournisseurs et profils personnels. Les améliorations communes se propagent depuis `main` ; l'offre du mois se choisit par profil, sans créer une branche par fournisseur.

Le lock fixe les archives Codebase Memory et le commit Superpowers. Le cask Orca et les CLI déjà présentes sont conservés : enregistrer leur version réellement testée, sans prétendre qu'ils sont gelés par le lock npm.
