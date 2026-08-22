"""Ispezione read-only della pagina quotazioni di fantacalcio.it per capire
la struttura HTML prima di scrivere lo scraping. Non modifica nulla."""
import sys
import requests
from bs4 import BeautifulSoup

URL = "https://www.fantacalcio.it/quotazioni-fantacalcio"


def main() -> None:
    print(f"Fetch di: {URL}\n")
    response = requests.get(
        URL,
        timeout=30,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0 Safari/537.36"
            ),
            "Accept-Language": "it-IT,it;q=0.9",
        },
    )
    response.encoding = "utf-8"
    print(f"Status: {response.status_code}, bytes: {len(response.content)}")
    print(f"Final URL: {response.url}\n")

    soup = BeautifulSoup(response.text, "html.parser")

    # Conta elementi utili
    print(f"tables: {len(soup.find_all('table'))}")
    print(f"rows (tr): {len(soup.find_all('tr'))}")
    print(f"cells (td): {len(soup.find_all('td'))}")
    print(f"links: {len(soup.find_all('a'))}\n")

    # Prova a identificare l'area dei dati: cerca parola "quotazione"
    hits = []
    for el in soup.find_all(attrs={"data-testid": True}):
        hits.append(str(el.attrs.get("data-testid")))
    print(f"data-testid trovati (primi 15): {hits[:15]}")

    # Stampa un sample delle prime 10 righe di tabella con testo
    rows = soup.find_all("tr")[:12]
    print("\nPRIME RIGHE TABELLA (tr):")
    for r in rows:
        cells = [c.get_text(strip=True) for c in r.find_all(["td", "th"])]
        print(" | ".join(cells))

    # Guarda anche eventuali script JSON (id='__NEXT_DATA__' o simili)
    for tag_id in ["__NEXT_DATA__", "__NUXT__"]:
        tag = soup.find(id=tag_id)
        if tag and tag.string:
            print(f"\n{tag_id} trovato: {len(tag.string)} caratteri")
            print(tag.string[:400])


if __name__ == "__main__":
    main()