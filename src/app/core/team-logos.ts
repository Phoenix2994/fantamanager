/**
 * Mappa NOME squadra (esatto, come salvato in Firestore) -> slug del file
 * logo in public/loghi/{slug}.png. I loghi sono ritagliati con sfondo
 * trasparente (vedi lo script one-off usato per generarli).
 *
 * Manutenzione manuale: se una squadra cambia nome o se ne aggiunge una
 * nuova senza logo qui mappato, i punti che lo mostrano ricadono su
 * un'icona generica (vedi TeamLogo) — non è un errore bloccante.
 */
const LOGO_SLUG_PER_NOME: Readonly<Record<string, string>> = {
  Phoenix: 'phoenix',
  'Ac. Ciaccati': 'ac-ciaccati',
  'S.S. Jonica 106': 'jonica',
  "Cispo's Vision": 'cispos-vision',
  'Granchi Avatori': 'granchi-avatori',
  'Nicaragua Pacamara Gigante': 'nicaragua',
  Akatsuki: 'akatsuki',
  'Loco Barurumon': 'barurumon',
  'DYNAMO COCITO': 'dynamo-cocito',
  'DAS HAUS': 'das-haus',
};

/**
 * URL del logo di una squadra (per nome esatto), o null se non mappato.
 * Path RELATIVO (senza "/" iniziale) apposta: si risolve rispetto al
 * <base href> della pagina, quindi funziona sia in locale (base "/") sia
 * su GitHub Pages, dove l'app vive sotto "/fantamanager/" — un path
 * assoluto avrebbe saltato quel prefisso e dato 404 solo in produzione.
 */
export function logoUrlPerNome(teamName: string | null | undefined): string | null {
  if (!teamName) {
    return null;
  }
  const slug = LOGO_SLUG_PER_NOME[teamName];
  return slug ? `loghi/${slug}.png` : null;
}
