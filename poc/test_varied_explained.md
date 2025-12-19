#+ Test Varied — Calculs et explication

Ce fichier explique en détail le contenu de `test_varied.json`, le calcul des capacités par couche, et pourquoi certains objets (indices 44..55) peuvent échouer avec la stratégie de découpe guillotine actuelle.

Résumé des dimensions de la palette
- Surface: 80 cm (largeur) x 120 cm (profondeur)
- Hauteur max: 180 cm

Rappel du comportement de l'algorithme
- Chaque "layer" (couche) a un `baseY` (bas de couche) et une `height` = hauteur maximale des objets placés dans cette couche.
- Les objets sont placés dans des rectangles libres (freeRects) en utilisant un split guillotine (droite et bas), first-fit.
- Quand une couche est pleine (ou aucun freeRect ne convient), on crée une nouvelle couche dont `baseY` = ancien `baseY` + `height`.

Contenu (indices 0-based)

Indices et objets (copié depuis `test_varied.json`):

0-5  : 6 × 40×40×50 cm  (6 objets)
6-21 : 16 × 20×30×40 cm (16 objets)
22-23: 2 × 80×60×30 cm  (2 objets)
24-47: 24 × 20×20×35 cm (24 objets)
48-55: 8 × 40×30×20 cm  (8 objets)

Calcul des capacités par couche (théorique, sans fragmentation)
- 40×40 sur 80×120 -> 2 × 3 = 6 par couche -> hauteur couche = 50 cm
- 20×30 sur 80×120 -> 4 × 4 = 16 par couche -> hauteur couche = 40 cm
- 80×60 sur 80×120 -> 1 × 2 = 2 par couche -> hauteur couche = 30 cm
- 20×20 sur 80×120 -> 4 × 6 = 24 par couche -> hauteur couche = 35 cm
- 40×30 sur 80×120 -> 2 × 4 = 8 per couche -> hauteur couche = 20 cm

Somme des hauteurs (si chaque groupe remplit exactement sa couche):
- 50 + 40 + 30 + 35 + 20 = 175 cm (<= 180 cm) — donc théoriquement tout tient.

Pourquoi les indices 44..55 peuvent échouer
- L'algorithme guillotine, en mode "first-fit" et split (right/bottom), peut fragmenter l'espace libre lorsque des tailles non compatibles sont mélangées. Même si la somme des surfaces et des hauteurs rentre, la découpe peut laisser des rectangles trop petits pour certains objets.
- Dans `test_varied.json`, les objets sont groupés par type, mais le split de rectangles (surtout entre objets de profondeur 30 et 20) peut laisser des restes de 10 cm inutilisables pour des objets de profondeur 20, forçant la création de nouvelles couches prématurément. Cela peut augmenter la hauteur cumulée et provoquer l'échec pour les derniers objets (indices 44..55).

Recommandations pratiques
- Réordonner la liste pour placer d'abord les objets de plus grande surface (ou largeur/profondeur) afin de minimiser la fragmentation. Par exemple: 80×60, puis 40×40, puis 40×30, puis 20×30, puis 20×20.
- Autoriser la rotation des objets (si possible) pour mieux utiliser les freeRects.
- Améliorer la stratégie de fusion / coalescence des freeRects après suppression / placement pour récupérer l'espace inutilisé.

Fichier réordonné fourni
- Voir `test_varied_sorted.json` (recommandé) : la liste est triée par surface décroissante afin de réduire la fragmentation. Teste d'abord avec ce fichier.

Tableau détaillé par index (hauteur cumulée théorique en cm si chaque groupe occupe sa couche):
- Indices 0..5   : 40×40×50  -> couche 1 (hauteur couche = 50) -> top après couche 1 = 50
- Indices 6..21  : 20×30×40  -> couche 2 (hauteur couche = 40) -> top après couche 2 = 50 + 40 = 90
- Indices 22..23 : 80×60×30  -> couche 3 (hauteur couche = 30) -> top après couche 3 = 120
- Indices 24..47 : 20×20×35  -> couche 4 (hauteur couche = 35) -> top après couche 4 = 155
- Indices 48..55 : 40×30×20  -> couche 5 (hauteur couche = 20) -> top après couche 5 = 175

Notes finales
- Le calcul ci-dessus montre que, en théorie, tout tient. Le problème est donc dû à la stratégie de découpe/placement (fragmentation). Essayez `test_varied_sorted.json` (fourni) — il réduit la fragmentation et doit résoudre l'échec pour les indices 44..55.

-- fin --
