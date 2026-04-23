# Contribuer à ATLAS Toolkit

Merci de votre intérêt. Les contributions sont accueillies même pour de petits changements (typo, traduction, clarification).

## Types de contributions utiles

| Type | Exemple | Difficulté |
|---|---|---|
| **Nouveau pattern** | Documenter une traduction `COBOL PERFORM VARYING` → Java `for` | 🟡 moyenne |
| **Exemple** | Porter un sample IBM CICS vers TypeScript | 🟠 avancée |
| **Outil** | CLI qui extrait les règles métier d'un COPY COBOL | 🔴 difficile |
| **Doc** | Traduire un pattern FR ↔ EN | 🟢 facile |
| **Tests** | Ajouter un test de parité sur un exemple existant | 🟡 moyenne |
| **Typo / clarification** | Corriger une erreur dans un .md | 🟢 facile |

## Workflow

1. **Fork** du repo
2. **Branche nommée** : `feat/new-pattern-cobol-evaluate` ou `fix/typo-readme` ou `docs/translate-en-fr`
3. **Commit sémantique** : `feat(patterns/cobol): add EVALUATE → switch mapping`
4. **Pull Request** avec description qui couvre :
   - Le problème résolu
   - La solution proposée
   - Exemples avant/après si applicable
5. Un mainteneur relit dans 2-5 jours ouvrés

## Règles de qualité

- **Tout pattern doit avoir un test de parité** (input legacy, output cible, assert identique)
- **Tout pattern doit avoir un exemple concret** (pas juste une théorie)
- **Sources vérifiables** pour les affirmations techniques
- **Anglais ou français** acceptés — les mainteneurs traduisent si besoin
- **Pas de code client** (confidentialité)

## Template de pattern

Créer un fichier Markdown dans `patterns/<langue-source>/<nom>.md` avec cette structure :

```markdown
# [Nom du pattern]

## Description
Court paragraphe expliquant le problème et la solution.

## Source (exemple legacy)
\`\`\`cobol
PROCEDURE DIVISION.
    PERFORM VARYING I FROM 1 BY 1 UNTIL I > 10
        DISPLAY I
    END-PERFORM.
\`\`\`

## Cible (exemple moderne)
\`\`\`typescript
for (let i = 1; i <= 10; i++) {
    console.log(i);
}
\`\`\`

## Règles de traduction
- Règle 1
- Règle 2
- Edge cases connus

## Test de parité
Référence vers le test dans `tools/parity-tester/tests/<pattern-id>.test.ts`.

## Contributeurs
- @votrePseudo (init)
```

## Code de conduite

Respect et bienveillance. Ce projet est un espace professionnel pour des ingénieurs qui veulent partager des savoirs techniques. Les contributions sont jugées uniquement sur leur qualité technique.

Pas de discussion hors-sujet (politique, religion, etc.). Pas de discrimination. Voir [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Mainteneurs

- Access International team — [access-international.dev](https://access-international.dev)

Pour questions privées : `hello@access-international.dev`
