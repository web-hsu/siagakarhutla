/* ================================================================
 * gas-shim.js
 * Meniru google.script.run milik Google Apps Script supaya kode
 * dashboard yang ada TIDAK perlu diubah saat di-host di GitHub Pages.
 * Setiap pemanggilan .namaFungsi(args) dikirim via fetch (POST) ke
 * Web App Apps Script, yang membaca/menulis Google Spreadsheet.
 *
 * Content-Type "text/plain" dipakai sengaja agar browser tidak
 * melakukan preflight CORS (Apps Script tidak mendukung OPTIONS).
 * ================================================================ */
(function () {
  if (window.google && window.google.script && window.google.script.run) return;

  function buatRunner(onOk, onFail) {
    return new Proxy({}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (fn) { return buatRunner(fn, onFail); };
        if (prop === 'withFailureHandler') return function (fn) { return buatRunner(onOk, fn); };
        if (prop === 'withUserObject') return function () { return buatRunner(onOk, onFail); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          var url = window.GAS_API_URL || '';
          if (!url || url.indexOf('GANTI_DENGAN') === 0) {
            if (onFail) onFail(new Error('GAS_API_URL belum diisi di config.js'));
            return;
          }
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ fn: String(prop), args: args }),
            redirect: 'follow'
          })
            .then(function (r) { return r.text(); })
            .then(function (t) {
              try { return JSON.parse(t); }
              catch (_) {
                var pesan = /^\s*</.test(t)
                  ? 'Server Apps Script membalas HTML, bukan JSON (fungsi: ' + prop + '). Kemungkinan eksekusi kena batas waktu/memori, deployment belum "Anyone", atau URL /exec salah. Cek menu Executions di Apps Script.'
                  : 'Respons server bukan JSON: ' + t.slice(0, 120);
                throw new Error(pesan);
              }
            })
            .then(function (j) {
              if (j && j.__error) throw new Error(j.__error);
              if (onOk) onOk(j && Object.prototype.hasOwnProperty.call(j, 'result') ? j.result : j);
            })
            .catch(function (e) { if (onFail) onFail(e); else console.error(e); });
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = buatRunner(null, null);
})();
