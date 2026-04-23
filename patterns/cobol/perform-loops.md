# COBOL PERFORM loops → TypeScript

**Difficulté** : 🟢 Facile
**Version** : 1.0
**Dernière mise à jour** : 2026-04-23

## Description

Les instructions `PERFORM VARYING` et `PERFORM UNTIL` de COBOL se traduisent en boucles `for` et `while` standard en TypeScript. Ce pattern couvre les 5 formes courantes.

## 1. PERFORM VARYING basique (compteur)

### Source COBOL
```cobol
PROCEDURE DIVISION.
    PERFORM VARYING I FROM 1 BY 1 UNTIL I > 10
        DISPLAY I
    END-PERFORM.
```

### Cible TypeScript
```typescript
for (let i = 1; i <= 10; i++) {
    console.log(i);
}
```

### Règles
- `VARYING X FROM A BY B UNTIL cond` → `for (let x = A; !cond; x += B)`
- `DISPLAY` → `console.log` (ou logger)
- `UNTIL` est évaluée AVANT chaque itération (comme `while` en TypeScript)

## 2. PERFORM UNTIL (while)

### Source COBOL
```cobol
PERFORM UNTIL EOF-FLAG = 'Y'
    READ INPUT-FILE
        AT END MOVE 'Y' TO EOF-FLAG
    END-READ
END-PERFORM.
```

### Cible TypeScript
```typescript
let eofFlag = 'N';
while (eofFlag !== 'Y') {
    const record = await inputFile.read();
    if (record === null) {
        eofFlag = 'Y';
    } else {
        // process record
    }
}
```

### Règles
- `PERFORM UNTIL` = boucle while avec condition inversée
- `AT END` = null-check en TypeScript
- Le flag EOF est remplacé par la vérification directe `null`/`undefined`

## 3. PERFORM VARYING avec deux variables (nested)

### Source COBOL
```cobol
PERFORM VARYING I FROM 1 BY 1 UNTIL I > 5
    AFTER J FROM 1 BY 1 UNTIL J > 3
        COMPUTE RESULT = I * J
        DISPLAY RESULT
END-PERFORM.
```

### Cible TypeScript
```typescript
for (let i = 1; i <= 5; i++) {
    for (let j = 1; j <= 3; j++) {
        const result = i * j;
        console.log(result);
    }
}
```

### Règles
- Chaque `AFTER` = une boucle imbriquée
- Ordre d'itération : outer counter varie lentement, inner counter varie vite (comme en TypeScript)

## 4. PERFORM THRU (section range — déprécié)

### Source COBOL
```cobol
PERFORM SECTION-A THRU SECTION-C.

SECTION-A.
    DISPLAY "A".
SECTION-B.
    DISPLAY "B".
SECTION-C.
    DISPLAY "C".
```

### Cible TypeScript
Pas de traduction directe. Le `PERFORM THRU` est déprécié et représente un goto déguisé.

**Recommandation** : refactorer vers 3 fonctions explicites, puis les appeler dans l'ordre.

```typescript
function sectionA() { console.log("A"); }
function sectionB() { console.log("B"); }
function sectionC() { console.log("C"); }

sectionA();
sectionB();
sectionC();
```

### Discordance à tracer
Si un `PERFORM THRU` sautait des sections intermédiaires via `GO TO`, la traduction TypeScript peut changer le comportement. **À flagger dans le registre de discordances**.

## 5. PERFORM TIMES (répétition fixe)

### Source COBOL
```cobol
PERFORM 5 TIMES
    DISPLAY "Hello"
END-PERFORM.
```

### Cible TypeScript
```typescript
for (let _i = 0; _i < 5; _i++) {
    console.log("Hello");
}
```

## Edge cases connus

### E1 — VARYING avec BY négatif
```cobol
PERFORM VARYING I FROM 10 BY -1 UNTIL I < 1
```
→ `for (let i = 10; i >= 1; i--)`

### E2 — Condition composite
```cobol
PERFORM UNTIL (A > 100) AND (B = 'Y')
```
→ `while (!(a > 100 && b === 'Y'))`

### E3 — Modification de la variable de contrôle dans la boucle
Pratique courante en COBOL, mais ANTI-PATTERN en TypeScript. Refactorer en `while` explicite :
```typescript
let i = 1;
while (i <= 10) {
    if (someCondition) i = 100; // sort de la boucle
    else {
        // work
        i++;
    }
}
```

## Tests de parité

Cf. `tools/parity-tester/tests/perform-loops.test.ts` pour 15 cas de test automatiques couvrant les 5 formes + 3 edge cases.

## Contributeurs

- Access International team (init)
