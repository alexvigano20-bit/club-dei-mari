// Club dei Mari · paracadute di avvio (script classico, non modulo).
// Se l'app non parte entro 10 secondi (errore nel codice, file vecchi in memoria,
// rete bloccata) invece di restare ferma sul logo mostra un messaggio e un pulsante
// che svuota la memoria dell'app sul telefono e la ricarica. I dati del club non
// stanno in questa memoria: non si perde nulla.
(function () {
  function repair() {
    var done = function () { location.reload(); };
    var jobs = [];
    try { if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })); } catch (e) {}
    try { if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })); } catch (e) {}
    Promise.all(jobs).then(done, done);
  }
  setTimeout(function () {
    if (window.__cdmStarted) return;
    var s = document.getElementById('splash'); if (s) s.remove();
    var m = document.getElementById('main');
    if (!m) return;
    m.innerHTML = '<div class="card"><h2>L\'app non si è avviata</h2><p>Può succedere dopo un aggiornamento. Tocca il pulsante: l\'app si ricarica pulita. I dati del club sono al sicuro sul server.</p><button id="bootRepair" type="button" style="width:100%">Ricarica l\'app</button></div>';
    document.getElementById('bootRepair').addEventListener('click', repair);
  }, 10000);
})();
