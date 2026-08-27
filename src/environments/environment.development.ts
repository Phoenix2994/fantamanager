export const environment = {
  production: false,

  firebase: {
    apiKey: 'AIzaSyATKYO9GCuqKbwWW2JOIoDduBraqaBU8U8',
    authDomain: 'fantamanager-cf18d.firebaseapp.com',
    projectId: 'fantamanager-cf18d',
    storageBucket: 'fantamanager-cf18d.firebasestorage.app',
    messagingSenderId: '890489260390',
    appId: '1:890489260390:web:a9aa23a50eed58b0ab20a7',
  },

  /**
   * Account Firebase Authentication condiviso tra gli admin della lega.
   * L'utente deve essere creato in: Console Firebase → Authentication → Users.
   */
  adminEmail: 'admin@fantamanager.app',

  /**
   * uid Firebase Auth di account squadra con permessi admin ESTESI (oltre
   * ai propri, come per ogni squadra loggata): stesso trattamento di
   * adminEmail, solo verificato per uid invece che per email. Aggiornare
   * anche isAdmin() in firestore.rules se questa lista cambia — i due file
   * vanno tenuti in sync a mano.
   */
  legaAdminUids: ['XabixzI9FuhlmlI6ZVUNgZk3aSm2'] as readonly string[],

  /** ID del documento lega in Firestore: league/{leagueId} */
  leagueId: 'main',

  /** Stagione corrente (usata come ID documento in seasonFinance/{season}) */
  season: '2026-27',

  /** Nome visualizzato della lega nell'header e nel login */
  leagueName: 'Fantamanager',
};