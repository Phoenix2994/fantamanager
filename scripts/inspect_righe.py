"""Ispezione celle ruolo mantra: portieri e giocatori multi-ruolo."""
import requests
from bs4 import BeautifulSoup

URL = "https://www.fantacalcio.it/quotazioni-fantacalcio"
resp = requests.get(URL, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
resp.encoding = "utf-8"
soup = BeautifulSoup(resp.text, "html.parser")

targets = {"vicario", "piotrowski"}
found = 0
for tr in soup.find_all("tr"):
    cells = tr.find_all(["td", "th"])
    texts = [c.get_text(strip=True) for c in cells]
    if len(cells) < 10 or not texts[3]:
        continue
    nome_norm = texts[3].lower()
    if any(t in nome_norm for t in targets):
        found += 1
        print("=== ", texts[3], " ===")
        print(str(cells[2])[:800])
        print()
        if found >= 2:
            break

# Conta anche quanti span .role ci sono per riga (distribuzione)
from collections import Counter
dist = Counter()
for tr in soup.find_all("tr"):
    cells = tr.find_all(["td", "th"])
    texts = [c.get_text(strip=True) for c in cells]
    if len(cells) < 10 or not texts[3]:
        continue
    spans = cells[2].find_all("span", class_="role")
    dist[len(spans)] += 1
print("Distribuzione numero span .role per riga:", dict(dist))