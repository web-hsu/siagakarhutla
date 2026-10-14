/* ================================================================
 * gas-shim.js
 * Meniru google.script.run milik Google Apps Script supaya kode
 * dashboard yang ada TIDAK perlu diubah saat di-host di GitHub Pages.
 * Setiap pemanggilan .namaFungsi(args) dikirim via fetch (POST) ke
 * Web App Apps Script, yang membaca/menulis Google Spreadsheet.
 *
 * Content-Type "text/plain" dipakai sengaja agar browser tidak
 * melakukan preflight CORS (Apps Script tidak mendukung OPTIONS).
 *
 * PERBAIKAN KONEKSI (sering gagal terhubung ke Spreadsheet):
 *  1) Antrean: maksimal MAKS_BERSAMAAN panggilan berjalan serentak,
 *     supaya Apps Script tidak kewalahan saat halaman dibuka.
 *  2) Timeout: panggilan yang menggantung > TIMEOUT_MS dibatalkan
 *     (dan dicoba ulang bila fungsinya hanya membaca data).
 *  3) Retry otomatis: HANYA untuk fungsi baca (aman diulang) bila
 *     server membalas HTML/non-JSON, jaringan putus, atau timeout.
 *     Fungsi tulis/pembaruan TIDAK diulang agar data tidak ganda.
 * ================================================================ */
(function () {
  if (window.google && window.google.script && window.google.script.run) return;

  var MAKS_BERSAMAAN = 3;       // panggilan serentak ke server
  var TIMEOUT_MS = 60000;       // batas tunggu per percobaan
  var MAKS_ULANG = 2;           // percobaan ulang (selain percobaan pertama)
  var JEDA_ULANG_MS = 1500;     // jeda dasar: 1,5 dtk, lalu 3 dtk

  // Fungsi yang hanya MEMBACA data -> aman dicoba ulang.
  var FUNGSI_BACA = {
    getHotspotDataFromSheet: 1,
    getAQIDataFromSheet: 1,
    getISPADataFromSheet: 1,
    getISPADataHariIni: 1,
    getDaftarPuskesmasISPA: 1
  };

  // ---------- antrean sederhana ----------
  var antrean = [];
  var berjalan = 0;

  function jalankanAntrean() {
    while (berjalan < MAKS_BERSAMAAN && antrean.length) {
      var tugas = antrean.shift();
      berjalan++;
      tugas(function selesai() {
        berjalan--;
        jalankanAntrean();
      });
    }
  }

  function masukAntrean(tugas) {
    antrean.push(tugas);
    jalankanAntrean();
  }

  function tunggu(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  // ---------- satu kali permintaan ke Apps Script ----------
  function kirimSekali(url, fn, args) {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;

    function bersihkan() { if (timer) clearTimeout(timer); }

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args }),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        bersihkan();
        var j;
        try {
          j = JSON.parse(t);
        } catch (_) {
          var pesan = /^\s*</.test(t)
            ? 'Server Apps Script membalas HTML, bukan JSON (fungsi: ' + fn + '). Kemungkinan eksekusi kena batas waktu/memori, deployment belum "Anyone", atau URL /exec salah. Cek menu Executions di Apps Script.'
            : 'Respons server bukan JSON: ' + t.slice(0, 120);
          var eFormat = new Error(pesan);
          eFormat.bisaDiulang = true;      // HTML error biasanya sementara (server sibuk)
          throw eFormat;
        }
        if (j && j.__error) {
          var eServer = new Error(j.__error);   // error dari kode Apps Script sendiri
          eServer.bisaDiulang = false;
          throw eServer;
        }
        return j && Object.prototype.hasOwnProperty.call(j, 'result') ? j.result : j;
      })
      .catch(function (e) {
        bersihkan();
        if (e && e.name === 'AbortError') {
          var eTimeout = new Error('Server tidak merespons dalam ' + (TIMEOUT_MS / 1000) + ' detik (fungsi: ' + fn + ').');
          eTimeout.bisaDiulang = true;
          throw eTimeout;
        }
        if (e && e.bisaDiulang === undefined) e.bisaDiulang = true;   // gangguan jaringan
        throw e;
      });
  }

  // ---------- dengan retry (khusus fungsi baca) ----------
  function kirimDenganUlang(url, fn, args, percobaan) {
    return kirimSekali(url, fn, args).catch(function (e) {
      var boleh = FUNGSI_BACA[fn] && e && e.bisaDiulang && percobaan < MAKS_ULANG;
      if (!boleh) throw e;
      console.warn('[gas-shim] ' + fn + ' gagal (' + e.message + '), mencoba ulang ' + (percobaan + 1) + '/' + MAKS_ULANG);
      return tunggu(JEDA_ULANG_MS * (percobaan + 1)).then(function () {
        return kirimDenganUlang(url, fn, args, percobaan + 1);
      });
    });
  }

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
          var nama = String(prop);

          masukAntrean(function (selesai) {
            // Dua argumen pada then(): error di dalam onOk TIDAK ikut dianggap
            // kegagalan panggilan (tidak memicu onFail dan selesai() dobel).
            kirimDenganUlang(url, nama, args, 0)
              .then(function (hasil) {
                selesai();
                if (onOk) onOk(hasil);
              }, function (e) {
                selesai();
                if (onFail) onFail(e); else console.error(e);
              });
          });
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = buatRunner(null, null);
})();
