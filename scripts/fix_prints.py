"""Ripara le print spezzate in update_quotazioni.py
(le f-string con chr(10) letterale sono state convertite in newline reali)."""

path = "scripts/update_quotazioni.py"
with open(path, encoding="utf-8") as f:
    c = f.read()

NL = chr(10)

fixes = [
    (
        'print(f"' + NL + '{len(updated)} giocatori con quota aggiornata.")',
        'print()' + NL + '    print(f"{len(updated)} giocatori con quota aggiornata.")',
    ),
    (
        'print("' + NL + '=== DRY-RUN (nessuna scrittura) ===")',
        'print()' + NL + '    print("=== DRY-RUN (nessuna scrittura) ===")',
    ),
    (
        'print("' + NL + 'Svincolati (primi 10, ordinati per quotazione):")',
        'print()' + NL + '    print("Svincolati (primi 10, ordinati per quotazione):")',
    ),
    (
        'print("' + NL + 'Esegui con --write per aggiornare Firestore.")',
        'print()' + NL + '    print("Esegui con --write per aggiornare Firestore.")',
    ),
    (
        'print(f"' + NL + 'Aggiornati {len(updated)} giocatori e sincronizzati {len(svincolati)} svincolati.")',
        'print()' + NL + '    print(f"Aggiornati {len(updated)} giocatori e sincronizzati {len(svincolati)} svincolati.")',
    ),
]

for old, new in fixes:
    if old in c:
        c = c.replace(old, new)
        print("fixed:", new.strip()[:60])
    else:
        print("NOT FOUND:", old.strip()[:60])

with open(path, "w", encoding="utf-8") as f:
    f.write(c)
print("done")