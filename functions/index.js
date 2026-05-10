const functions = require('firebase-functions');
const admin     = require('firebase-admin');
admin.initializeApp();

const BASE = 'https://bankaccountdata.gocardless.com/api/v2';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCreds() {
  let cfg = {};
  try { cfg = functions.config().nordigen || {}; } catch (_) {}
  const secret_id  = cfg.secret_id  || process.env.NORDIGEN_SECRET_ID;
  const secret_key = cfg.secret_key || process.env.NORDIGEN_SECRET_KEY;
  if (!secret_id || !secret_key) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Clés GoCardless non configurées. Lancez : firebase functions:config:set nordigen.secret_id="..." nordigen.secret_key="..."'
    );
  }
  return { secret_id, secret_key };
}

async function getToken() {
  const { secret_id, secret_key } = getCreds();
  const res = await fetch(`${BASE}/token/new/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret_id, secret_key })
  });
  if (!res.ok) {
    throw new functions.https.HttpsError('internal', 'Authentification GoCardless échouée : ' + await res.text());
  }
  return (await res.json()).access;
}

function requireAuth(ctx) {
  if (!ctx.auth) throw new functions.https.HttpsError('unauthenticated', 'Vous devez être connecté');
}

// ── Callable functions ────────────────────────────────────────────────────────

// Liste les banques disponibles pour un pays (défaut : France)
exports.nordigenListBanks = functions
  .region('europe-west1')
  .https.onCall(async (data, ctx) => {
    requireAuth(ctx);
    const t   = await getToken();
    const country = (data && data.country) || 'fr';
    const res = await fetch(`${BASE}/institutions/?country=${country}`, {
      headers: { Authorization: `Bearer ${t}` }
    });
    if (!res.ok) throw new functions.https.HttpsError('internal', 'Impossible de récupérer les banques');
    const banks = await res.json();
    // Ne retourner que les champs utiles pour limiter la taille de la réponse
    return banks.map(b => ({ id: b.id, name: b.name, logo: b.logo || null }));
  });

// Crée une réquisition (lien OAuth vers la banque)
exports.nordigenCreateRequisition = functions
  .region('europe-west1')
  .https.onCall(async (data, ctx) => {
    requireAuth(ctx);
    const t   = await getToken();
    const res = await fetch(`${BASE}/requisitions/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect:       data.redirectUrl,
        institution_id: data.institutionId,
        reference:      `sb_${ctx.auth.uid}_${Date.now()}`
      })
    });
    if (!res.ok) throw new functions.https.HttpsError('internal', await res.text());
    const req = await res.json();
    return { id: req.id, link: req.link, status: req.status };
  });

// Récupère les transactions d'une réquisition complétée
exports.nordigenFetchTransactions = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 60 })
  .https.onCall(async (data, ctx) => {
    requireAuth(ctx);
    const t = await getToken();

    // Vérifier le statut de la réquisition
    const reqRes = await fetch(`${BASE}/requisitions/${data.requisitionId}/`, {
      headers: { Authorization: `Bearer ${t}` }
    });
    if (!reqRes.ok) throw new functions.https.HttpsError('internal', 'Réquisition introuvable');
    const req = await reqRes.json();

    // LN = Linked (authentification réussie)
    if (req.status !== 'LN') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Authentification non finalisée (statut : ${req.status}). Reconnectez votre banque.`
      );
    }

    const txs = [];
    for (const accountId of (req.accounts || [])) {
      const res = await fetch(`${BASE}/accounts/${accountId}/transactions/`, {
        headers: { Authorization: `Bearer ${t}` }
      });
      if (!res.ok) continue;
      const d = await res.json();
      for (const tx of (d.transactions?.booked || [])) {
        const rawAmt = parseFloat(tx.transactionAmount?.amount || '0');
        if (rawAmt === 0) continue;
        txs.push({
          nordigenId:   tx.transactionId || tx.internalTransactionId || null,
          date:         tx.bookingDate   || tx.valueDate || new Date().toISOString().split('T')[0],
          amount:       rawAmt,                                   // négatif = dépense, positif = revenu
          label:        tx.remittanceInformationUnstructured
                        || tx.creditorName
                        || tx.debtorName
                        || 'Transaction',
          creditorName: tx.creditorName || null,
          debtorName:   tx.debtorName   || null,
          currency:     tx.transactionAmount?.currency || 'EUR',
        });
      }
    }

    // Trier du plus récent au plus ancien
    txs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return txs;
  });
