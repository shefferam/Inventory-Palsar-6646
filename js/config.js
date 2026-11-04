// "local"     = stored in this browser only (single device)
// "sheets"    = Google Sheet in your personal Google Drive, shared by all users (see apps-script/Code.gs)
// "firestore" = Firebase Firestore (requires firebase-config.js)
// Switching does not require any UI change – all screens go through js/data/repository.js.
export const DATA_BACKEND = "sheets";

// Apps Script web-app URL (Deploy > Web app), ends with /exec. Required for "sheets".
export const SHEETS_API_URL = "https://script.google.com/macros/s/AKfycbzkwe9mR-aA1mVGcvYEv2eMUfsWgpS5uq2p8OQwhTVv4EGFesFEcVqVqIx1mxUwsXKPGw/exec";

// OAuth client ID from Google Cloud (ends with .apps.googleusercontent.com). Enables "Sign in with Google".
export const GOOGLE_CLIENT_ID = "223877024861-1dm6a0qh0gcdla1k2g40n99bdvbqnu4p.apps.googleusercontent.com";
