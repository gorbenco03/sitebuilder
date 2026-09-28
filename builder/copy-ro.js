'use strict';
/**
 * builder/copy-ro.js — single Romanian copy catalog for builder/app.js
 * (PLAN-UX-2026-09-27.md §5.8 "Un singur strat de mesaje pentru client").
 *
 * Loaded BEFORE builder/app.js (see builder/index.html <script> order) so
 * every toast, error fallback and inline status message app.js shows a
 * customer reads its text from RO here instead of repeating a Romanian
 * literal at each call site. Frozen (Object.freeze, one level deep — every
 * value is a plain string) so a call site can never mutate shared copy out
 * from under another screen.
 *
 * t(key, vars) fills `{token}` placeholders in RO[key] from `vars` — the
 * only templating this file does. Call sites that need it pass a plain
 * object, e.g. t('UNSAVED_CHANGES_NAMED', { name: siteName }).
 *
 * Migration is intentionally incremental (see PLAN-UX-2026-09-27.md §5.8
 * "riscuri"): a handful of call sites inside builder/app.js functions that
 * existing bot/test/*.test.js oracles extract and eval in an isolated vm
 * sandbox (no RO global present there) keep their literal Romanian text for
 * now rather than reference RO — moving them needs those oracles updated in
 * the same breath, left for a follow-up pass so this one stays reviewable.
 */
var RO = Object.freeze({
  GENERIC_FALLBACK: 'Ceva nu a mers. Încearcă din nou.',
  TRY_AGAIN: 'Încearcă din nou.',
  TEMPLATES_LOAD_FAILED: 'Designurile nu s-au încărcat. Reîncearcă.',

  // Draft save state (autosave pill, storage-full guard)
  SAVE_DRAFT_TOO_LARGE: 'Site-ul are imagini mari — nu s-a putut salva ca ciornă. Publică înainte să închizi pagina.',
  SAVE_STATE_SAVING: 'Se salvează…',
  SAVE_STATE_SAVED: 'Salvat',
  SAVE_STATE_ERROR: 'Nu s-a salvat',
  SESSION_EXPIRED_AUTOSAVE: 'Sesiunea a expirat — reconectează-te ca să salvezi în cont. Site-ul rămâne aici, pe acest calculator.',
  SAVE_ACCOUNT_FAILED: 'Nu s-a putut salva în cont.',

  // Onboarding / tab-conflict / recovery banners
  QUICKSTART_APPLIED: 'Site-ul tău are acum datele tale — verifică pe canvas.',
  TAB_CONFLICT_WITH_SECTIONS: 'Acest site e deschis și în altă filă a browserului — acolo tocmai s-a modificat: {sections}. Am păstrat modificările din ambele file unde a fost posibil (dacă amândouă au atins exact același câmp, câștigă ultima salvare).',
  TAB_CONFLICT_GENERIC: 'Acest site e deschis și în altă filă a browserului. Îmbinăm modificările câmp cu câmp — dacă amândouă tab-urile ating exact același câmp, câștigă ultima salvare.',
  UNSAVED_CHANGES_NAMED: 'Ai modificări nesalvate la {name}. Continui de unde ai rămas?',
  UNFINISHED_SITE: 'Ai un site neterminat{template}. Continui de unde ai rămas?',

  // Photos
  PHOTO_LIST_USE_PANEL: 'Pentru a adăuga o poză aici, folosește panoul „Poze".',
  IMAGE_PROCESS_FAILED_PREFIX: 'Nu am putut procesa fotografia: {msg}',
  IMAGE_LOSES_QUALITY: 'Poza va fi salvată ca imagine statică — se pierde {lost}.',
  BG_AUTO_WHITE_INK: 'Fundal închis — textul site-ului devine automat alb, pentru lizibilitate.',
  IMAGE_PROCESS_FAILED_GENERIC: 'Nu am putut procesa fotografia.',
  IMAGE_READ_FAILED: 'Nu am putut citi imaginea.',
  PHOTO_DELETED_UNDO: 'Poză ștearsă — apasă Anulează din bara de sus dacă a fost o greșeală.',
  PHOTO_UPLOAD_FAILED_NAMED: 'Nu am putut procesa "{name}": {msg}',
  PHOTO_ADDED_ONE: 'Poza a fost adăugată.',
  PHOTO_ADDED_MANY: '{count} poze au fost adăugate.',

  // Sign-in / logout / session
  AUTH_EMAIL_REQUIRED: 'Introdu adresa de email.',
  LOGGED_OUT: 'Te-ai deconectat.',
  LOGGED_OUT_EVERYWHERE: 'Te-ai deconectat de pe toate dispozitivele.',
  SESSION_EXPIRED_FULL: 'Sesiunea a expirat — conectează-te din nou ca să salvezi și să publici. Modificările tale sunt păstrate pe acest dispozitiv.',
  SESSION_EXPIRED_SHORT: 'Sesiunea a expirat — conectează-te din nou',
  AUTH_TITLE_PUBLISH: 'Autentifică-te ca să publici',
  AUTH_TITLE_VIEW_SITES: 'Autentifică-te ca să-ți vezi site-urile',

  // Publish flow
  CHECK_LINK_INVALID: 'Verifică linkul introdus.',
  FIELDS_MISSING: 'Completează mai întâi: {fields}',
  SESSION_EXPIRED_PUBLISH: 'Sesiunea a expirat — conectează-te din nou ca să publici.',
  PUBLISH_FAILED: 'Publicarea a eșuat. Încearcă din nou.',
  UNEXPECTED_SERVER_RESPONSE: 'Răspuns neașteptat de la server.',
  INVALID_PAYMENT_SESSION: 'Sesiune de plată invalidă.',
  TRIAL_STARTED: 'Trial început. Publicarea se finalizează în câteva momente.',
  PAYMENT_PROCESSED: 'Plata a fost procesată.',
  PAYMENT_CONFIRM_FAILED: 'Nu am putut confirma plata. Încearcă din nou.',

  // Slug field
  SLUG_MIN_LENGTH: 'Adresa trebuie să aibă cel puțin 3 caractere (litere mici, cifre, cratime).',
  SLUG_CHECK_UNAVAILABLE: 'Nu am putut verifica disponibilitatea acum — se confirmă la publicare.',
  SLUG_NORMALIZED_NOTE: 'Adresele web nu au spații sau diacritice — am simplificat-o în „{slug}”.',

  // Templates / design switch
  DESIGN_LOAD_FAILED: 'Nu am putut încărca designul. Încearcă din nou.',
  SITE_SWITCHED_NAMED: 'Site-ul pe designul „{name}” a fost înlocuit aici{suffix}',
  SITE_SWITCHED_SUFFIX_SIGNED_IN: ' — îl găsești în Site-urile mele.',
  SITE_SWITCHED_SUFFIX_ANON: '.',

  // Dashboard
  DASHBOARD_EMPTY_TITLE: 'Nu ai creat încă niciun site',
  DASHBOARD_EMPTY_DESC: 'Alege un design și pornești în câteva minute.',
  DASHBOARD_AUTH_REQUIRED_TITLE: 'Autentifică-te ca să vezi site-urile',
  DASHBOARD_AUTH_REQUIRED_DESC: 'Sesiunea ta a expirat sau nu ești încă autentificat.',
  DASHBOARD_LOAD_FAILED_TITLE: 'Nu am putut încărca site-urile',

  // Site card actions / billing
  ACTION_GENERIC_FAILED: 'Nu am putut finaliza acțiunea. Încearcă din nou.',
  BILLING_PORTAL_UNAVAILABLE: 'Portalul de facturare nu este disponibil acum.',
  CANCEL_MODAL_UNAVAILABLE: 'Nu am putut deschide anularea acum.',

  // Site delete / versions
  SITE_DELETED_NAMED: 'Site-ul „{name}” a fost șters definitiv.',
  DELETE_FAILED: 'Ștergerea a eșuat. Încearcă din nou.',
  SITE_LOAD_FAILED: 'Nu am putut încărca site-ul.',
  VERSION_RESTORED: 'Versiunea a fost restabilită.',
  VERSION_RESTORE_FAILED: 'Nu am putut restabili versiunea. Încearcă din nou.',
  VERSIONS_LOAD_FAILED: 'Nu am putut încărca versiunile. Încearcă din nou.',

  // R-27 GDPR self-service (download data / delete account)
  ACCOUNT_SIGNIN_DOWNLOAD_DATA: 'Intră în cont ca să-ți descarci datele.',
  DATA_DOWNLOADED: 'Datele au fost descărcate.',
  DATA_DOWNLOAD_FAILED: 'Nu am putut descărca datele.',
  DATA_DOWNLOAD_RATE_LIMITED: 'Prea multe cereri. Încearcă din nou peste o oră.',
  ACCOUNT_SIGNIN_DELETE: 'Intră în cont ca să-ți ștergi contul.',
  ACCOUNT_DELETE_NEEDS_EMAIL: 'Ștergerea contului din browser cere un cont cu email.',
  ACCOUNT_DELETED: 'Contul tău a fost șters definitiv.',

  // Custom domain
  COPY_FAILED: 'Nu am putut copia. Selectează textul manual.',
  COPY_ADDRESS_FAILED: 'Nu am putut copia adresa. Selectează textul manual.',
  DOMAIN_DISCONNECTED: 'Domeniul a fost deconectat.',
  DOMAIN_DISCONNECT_FAILED: 'Nu am putut deconecta domeniul.',
  DOMAIN_CONNECT_FAILED: 'Nu am putut conecta domeniul.',
  DOMAIN_LOAD_FAILED: 'Nu am putut încărca domeniul. Încearcă din nou.',
  DOMAIN_VERIFY_FAILED: 'Eroare la verificare.',
  DOMAIN_INPUT_REQUIRED: 'Introdu domeniul tău (ex: myshop.com).',

  // Invoices / site messages (contact form)
  INVOICES_LOAD_FAILED: 'Nu am putut încărca facturile. Încearcă din nou.',
  MESSAGE_MARK_READ_FAILED: 'Nu am putut marca mesajul citit.',
  MESSAGE_DELETE_FAILED: 'Nu am putut șterge mesajul.',
  MESSAGES_RELOAD_FAILED: 'Nu am putut reîncărca mesajele.',
  MESSAGES_LOAD_FAILED: 'Nu am putut încărca mesajele. Încearcă din nou.',

  // Instagram / Instafidget
  IG_EDITOR_PREPARING: 'Pregătim editorul Instafidget…',
  IG_EDITOR_READY: 'Editorul este pregătit și se va deschide într-un tab nou.',
  IG_EDITOR_PREPARE_FAILED_RETRY: 'Nu am putut pregăti editorul Instafidget. Încearcă din nou.',
  IG_EDITOR_PREPARE_FAILED: 'Nu am putut pregăti editorul Instafidget.',
  IG_DRAFT_SAVING: 'Salvăm ciorna pentru conectarea Instagram…',
  IG_ACCOUNT_ACTIVE: 'Cont activ. Pregătim conectarea…',
  IG_READY_TO_CONNECT: 'Poți conecta Instagram. Bifează acordul, apoi apasă Conectează Instagram.',
  IG_DRAFT_SAVE_FAILED: 'Nu am putut salva ciorna.',
  IG_LINK_SEND_FAILED: 'Nu am putut trimite linkul. Încearcă din nou.',
  IG_PREPARE_FAILED_RETRY: 'Nu am putut pregăti Instagram. Încearcă din nou.',
  SITE_SIGNIN_REQUIRED: 'Autentifică-te ca să salvezi ciorna.',
  DESIGN_REQUIRED: 'Alege mai întâi un design.',
  DRAFT_SAVE_FAILED_RETRY: 'Nu am putut salva ciorna. Încearcă din nou.',

  // Instagram connect/disconnect flow (connectInstagram/disconnectInstagram)
  IG_CONNECTED: 'Instagram a fost conectat.',
  IG_CONNECTED_ALT: 'Instagram e conectat.',
  IG_AUTH_REQUIRED: 'Autentifică-te ca să conectezi Instagram.',
  IG_TERMS_REQUIRED: 'Bifează acordul pentru Termeni și Politica de confidențialitate.',
  IG_CONNECTING: 'Conectăm Instagram…',
  IG_SAVE_DRAFT_FIRST: 'Salvează mai întâi ciorna.',
  IG_ON_SITE: 'Instagram este afișat pe site.',
  IG_AFTER_CONNECT_RETURN: 'După ce termini conectarea, revenim aici și actualizăm feed-ul de pe site.',
  IG_ON_SITE_ALT: 'Instagram e pe site.',
  IG_FEED_NOT_READY: 'Feed-ul nu este gata încă. Redeschide Instagram după ce salvezi conectarea.',
  IG_FEED_RELOAD_FAILED: 'Nu am putut reîncărca feed-ul Instagram.',
  IG_CONNECT_FAILED: 'Nu am putut conecta Instagram.',
  IG_DISCONNECTED: 'Instagram a fost deconectat. Feed-ul nu mai este afișat pe site.',
  IG_DISCONNECT_LOCAL_ONLY: 'Instagram a fost deconectat local, dar serverul nu a confirmat. Reîncearcă publicarea.',

  // HTML/ZIP export (downloadDraftHtml/downloadDraftZip)
  DRAFT_NOT_SAVED: 'Ciorna nu a fost salvată.',
  DOWNLOAD_HTML_SIGNIN: 'Intră în cont ca să descarci HTML-ul.',
  DOWNLOAD_HTML_SIGNIN_ALT: 'Autentifică-te ca să descarci HTML-ul.',
  DOWNLOAD_HTML_TRIAL_REQUIRED: 'Activează trialul de 14 zile sau abonamentul ca să descarci HTML-ul.',
  DOWNLOAD_HTML_FAILED: 'Nu am putut descărca HTML-ul.',
  DOWNLOAD_HTML_DONE: 'HTML descărcat.',
  DOWNLOAD_ZIP_SIGNIN: 'Autentifică-te ca să descarci ZIP-ul.',
  DOWNLOAD_ZIP_TRIAL_REQUIRED: 'Activează trialul de 14 zile sau abonamentul ca să descarci ZIP-ul.',
  DOWNLOAD_ZIP_FAILED: 'Nu am putut descărca ZIP-ul.',
  DOWNLOAD_ZIP_DONE: 'ZIP descărcat.',

  // Stripe return routes (handleRoute)
  SUBSCRIPTION_CANCELLED: 'Abonamentul a fost anulat. Site-ul e ciornă.',
  PAYMENT_PROCESSED_SITE_SOON: 'Plata a fost procesată. Site-ul tău va fi publicat în câteva momente.',
  PAYMENT_CANCELLED: 'Plata a fost anulată.',
  LOGIN_LINK_EXPIRED: 'Linkul de autentificare a expirat. Încearcă din nou.',

  // Boot
  BOOT_FAILED: 'Inițializarea a eșuat. Reîncarcă pagina.',
});

/** Fill `{token}` placeholders in RO[key] from `vars` (plain object, string/number values).
 * Missing tokens are left as-is rather than throwing — a caller typo shows up as a visible
 * `{token}` in the UI instead of crashing the page. */
function t(key, vars) {
  var template = RO[key];
  if (typeof template !== 'string') return key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, function (match, token) {
    return Object.prototype.hasOwnProperty.call(vars, token) ? String(vars[token]) : match;
  });
}
