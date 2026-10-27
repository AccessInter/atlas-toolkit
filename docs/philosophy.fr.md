**Langues :** **Français** · [English](philosophy.md)

# Philosophie d'ATLAS Toolkit

## Le problème

Des milliers d'entreprises (banques, assurances, secteur public, industrie, télécoms) portent des applications COBOL, Delphi, BizTalk en production depuis 20 à 40 ans. Elles tournent, elles font tourner le business, mais :

- Les développeurs qui les maintiennent partent en retraite
- La documentation est incomplète ou perdue
- Les règles métier sont enfouies dans le code
- Moderniser coûte cher et fait peur

**Résultat** : chaque programme de modernisation réinvente tout. Aucun pattern partagé, aucun outil commun, pas de catalogue des pièges déjà rencontrés.

## Notre conviction

**La modernisation legacy est un métier d'ingénieur, pas d'aventurier.** Les patterns existent, ils se répètent. Les erreurs sont souvent les mêmes. Les vérifications aussi.

Chez Access International, on modernise du COBOL et du Delphi depuis 1999. ATLAS, notre méthodologie, part de ce qui tourne réellement en production : quand le code source est incomplet ou douteux, elle lit directement le programme compilé, retrouve les règles de calcul et vérifie qu'elles correspondent au source remis.

On a décidé d'ouvrir **les briques réutilisables** — patterns, outils de parité, scaffolds d'exemple — sous licence MIT.

## Ce qu'on ouvre

- ✅ Patterns de traduction (source → cible) avec tests
- ✅ Outils de comparaison (parity-tester)
- ✅ Exemples publics (AWS samples, open datasets)
- ✅ Scaffolds d'exemples
- ✅ Vocabulaire et références

## Ce qu'on n'ouvre pas

- ❌ Les étapes et principes directeurs détaillés d'ATLAS (méthodologie complète)
- ❌ Notre registre de retours d'expérience issus des missions clients
- ❌ Le code de nos clients (confidentialité)
- ❌ Les templates de registre de discordances (format propriétaire)

**Pourquoi cette frontière** : la valeur d'ATLAS n'est pas dans les patterns techniques (qui existent ailleurs). Elle est dans l'agencement méthodologique et la discipline opérationnelle. On partage les briques, on monétise l'agencement.

## Ce qu'on attend de la communauté

### Ce qui aide

- Signaler des bugs dans les patterns
- Proposer de nouveaux patterns (surtout Delphi, BizTalk, PowerBuilder — stacks mal documentées)
- Porter un exemple sur une autre stack cible (Java, Python, Go, Rust)
- Traduire les patterns FR ↔ EN

### Ce qui n'est pas la bonne porte

- Aide gratuite sur votre programme de migration commercial — contactez-nous sur [access-international.dev/fr/contact](https://access-international.dev/fr/contact/)
- Documentation générale sur COBOL (voir la documentation IBM, Wikipédia)
- Cours de programmation (voir freeCodeCamp, Codecademy)

## Inspirations

- [Strangler Fig pattern](https://martinfowler.com/bliki/StranglerFigApplication.html) de Martin Fowler
- [Kubernetes community model](https://github.com/kubernetes/community) pour l'organisation OSS
- [OpenJDK](https://openjdk.org) pour le ton technique
- [Refactoring Guru](https://refactoring.guru) pour la pédagogie

## Gouvernance

ATLAS Toolkit est maintenu par Access International. Décisions éditoriales (quelles contributions acceptées, quels patterns inclus) par l'équipe Access. La licence MIT garantit la libre utilisation ; le dossier [`examples/card-demo-cobol`](../examples/card-demo-cobol), dérivé d'AWS CardDemo, reste sous Apache 2.0.

Si le projet grandit, création d'un comité steering avec contributeurs externes (après 10+ contributeurs actifs).

## Contact

- Site : [access-international.dev](https://access-international.dev)
- Formulaire de contact : [access-international.dev/fr/contact](https://access-international.dev/fr/contact/)
- Issues : [github.com/AccessInter/atlas-toolkit/issues](https://github.com/AccessInter/atlas-toolkit/issues)
