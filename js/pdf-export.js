/**
 * MODUL EKSPOR PDF RESMI FHISIP UNIVERSITAS TERBUKA
 * Menghasilkan dokumen PDF berkualitas tinggi, rapih, dan siap cetak
 * Menggunakan library pdfMake dengan Kop Surat Resmi & Blok Tanda Tangan Dekanat
 * Tersinkronisasi 100% dengan data live terbaru di Dashboard & Supabase Cloud.
 */

(function () {
  'use strict';

  const MONTH_NAMES = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  function initPdfMake() {
    if (window.pdfMake && window.pdfMake.vfs == null && window.vfsFonts) {
      window.pdfMake.vfs = window.vfsFonts.pdfMake ? window.vfsFonts.pdfMake.vfs : window.vfsFonts;
    }
  }

  function formatPeriodTitle(ym) {
    if (!ym || ym === 'all') return 'Semua Periode Terpadu';
    const parts = String(ym).split('-').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && parts[1] >= 1 && parts[1] <= 12) {
      return `${MONTH_NAMES[parts[1] - 1]} ${parts[0]}`;
    }
    return ym;
  }

  /**
   * Menghasilkan dan mengunduh berkas PDF Rekapitulasi Presensi Live
   * @param {string} mode 'harian' (Log Lengkap) | 'pegawai' (Akumulasi per Pegawai)
   * @param {boolean} useFiltered true jika ingin mencetak data yang sedang difilter saja
   */
  function exportPdf(mode = 'harian', useFiltered = false) {
    initPdfMake();

    if (!window.pdfMake) {
      alert('Library pdfMake belum termuat dengan sempurna. Harap segarkan halaman.');
      return;
    }

    const config = window.app.getConfig();
    const filterState = (window.app.getActiveFilterState && window.app.getActiveFilterState()) || {};
    const activePeriodLabel = formatPeriodTitle(filterState.bulan);

    let evaluatedRecords = [];
    if (useFiltered) {
      evaluatedRecords = window.app.getFilteredRecords ? window.app.getFilteredRecords() : [];
      if (evaluatedRecords.length === 0) {
        if (window.app.showToast) {
          window.app.showToast('Tidak ada data presensi yang sesuai filter saat ini untuk diekspor ke PDF.', 'warning');
        } else {
          alert('Tidak ada data presensi yang sesuai filter saat ini untuk diekspor.');
        }
        return;
      }
    } else {
      const baseList = (window.app.getEvaluatedForActivePeriod)
        ? window.app.getEvaluatedForActivePeriod()
        : window.app.getEvaluatedRecords();
      evaluatedRecords = baseList.slice().sort((a, b) =>
        (b.tanggal || '').localeCompare(a.tanggal || '') ||
        (a.nama_lengkap || '').localeCompare(b.nama_lengkap || '', 'id')
      );
    }

    const todayIndo = new Date().toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    // Ringkasan KPI Live (Konsisten dengan Kartu KPI di Dashboard)
    const totalLog = evaluatedRecords.length;
    let tepatCount = 0;
    let telatCount = 0;
    let totalMenitTelat = 0;
    let pulangCepatCount = 0;
    let lemburCount = 0;
    let izinCount = 0;

    evaluatedRecords.forEach(r => {
      if (r.isLembur) {
        lemburCount++;
      } else if (r.isIzinCutiSakitDinas) {
        izinCount++;
      } else if (r.status_kehadiran === 'Hadir') {
        if (r.isTerlambat) {
          telatCount++;
          totalMenitTelat += r.menitTerlambat;
        } else if (!r.isTanpaMasuk) {
          tepatCount++;
        }
        if (r.isPulangCepat) {
          pulangCepatCount++;
        }
      }
    });

    const persenTepat = totalLog > 0 ? ((tepatCount / totalLog) * 100).toFixed(1) : 0;
    const persenTelat = totalLog > 0 ? ((telatCount / totalLog) * 100).toFixed(1) : 0;
    const rataMenitTelat = telatCount > 0 ? Math.round(totalMenitTelat / telatCount) : 0;

    // Rentang tanggal aktual pada data yang diekspor
    const sortedDates = [...new Set(evaluatedRecords.map(r => (r.tanggal || '').slice(0, 10)).filter(Boolean))].sort();
    const dateSpanInfo = sortedDates.length > 0
      ? `${sortedDates[0]} s/d ${sortedDates[sortedDates.length - 1]}`
      : '-';

    // Judul & Tipe Laporan
    const judulLaporan = mode === 'pegawai'
      ? `LAPORAN AKUMULASI KEDISIPLINAN PER PEGAWAI (${activePeriodLabel.toUpperCase()})`
      : (useFiltered
        ? 'LAPORAN REKAPITULASI DETAIL PRESENSI (HASIL FILTER AKTIF)'
        : `LAPORAN REKAPITULASI DETAIL PRESENSI PEGAWAI (${activePeriodLabel.toUpperCase()})`);

    // Buat Isi Tabel berdasarkan mode
    let tableBody = [];
    let tableWidths = [];

    if (mode === 'pegawai') {
      tableWidths = [20, 92, 130, 138, 38, 38, 68, 40, 48, 52];
      tableBody.push([
        { text: 'No', style: 'tableHeader' },
        { text: 'NIP', style: 'tableHeader' },
        { text: 'Nama Lengkap', style: 'tableHeader' },
        { text: 'Program Studi / Unit', style: 'tableHeader' },
        { text: 'Hadir', style: 'tableHeader' },
        { text: 'Tepat', style: 'tableHeader' },
        { text: 'Terlambat', style: 'tableHeader' },
        { text: 'Lembur', style: 'tableHeader' },
        { text: 'Izin/Cuti', style: 'tableHeader' },
        { text: '% Disiplin', style: 'tableHeader' }
      ]);

      const pegawaiRows = window.app.getPegawaiAggregations(evaluatedRecords, {
        applyActiveFilters: Boolean(useFiltered || filterState.unit || filterState.search || filterState.kepegawaian)
      });

      pegawaiRows.forEach((p, idx) => {
        tableBody.push([
          { text: idx + 1, alignment: 'center' },
          { text: p.nip || '-', fontSize: 7 },
          { text: p.nama_lengkap || '-', bold: true },
          { text: p.unit_kerja || '-', fontSize: 7 },
          { text: p.totalHadir, alignment: 'center', bold: true },
          { text: p.tepatCount, alignment: 'center', color: '#065F46' },
          {
            text: p.telatCount > 0 ? `${p.telatCount}x (${p.totalMenitTelat}m)` : '0',
            alignment: 'center',
            color: p.telatCount > 0 ? '#991B1B' : '#065F46',
            bold: p.telatCount > 0
          },
          {
            text: p.lemburCount > 0 ? `${p.lemburCount}` : '-',
            alignment: 'center',
            color: p.lemburCount > 0 ? '#5B21B6' : '#64748B',
            bold: p.lemburCount > 0
          },
          {
            text: p.izinCount > 0 ? `${p.izinCount}` : '-',
            alignment: 'center',
            color: p.izinCount > 0 ? '#1E40AF' : '#64748B',
            bold: p.izinCount > 0
          },
          {
            text: `${p.pctDisiplin}%`,
            alignment: 'center',
            bold: true,
            color: p.pctDisiplin >= 95 ? '#065F46' : '#991B1B'
          }
        ]);
      });

    } else {
      // Mode Log Harian Lengkap (Seluruh data live tanpa pemotongan 500 baris)
      tableWidths = [20, 56, 94, 128, 132, 44, 44, 90, 74];
      tableBody.push([
        { text: 'No', style: 'tableHeader' },
        { text: 'Tanggal', style: 'tableHeader' },
        { text: 'NIP', style: 'tableHeader' },
        { text: 'Nama Pegawai', style: 'tableHeader' },
        { text: 'Program Studi / Unit', style: 'tableHeader' },
        { text: 'Masuk', style: 'tableHeader' },
        { text: 'Pulang', style: 'tableHeader' },
        { text: 'Status Disiplin', style: 'tableHeader' },
        { text: 'Keterangan', style: 'tableHeader' }
      ]);

      evaluatedRecords.forEach((r, idx) => {
        let statusColor = '#065F46'; // Tepat waktu hijau
        if (r.isTerlambat) statusColor = '#991B1B'; // Telat merah
        else if (r.isPulangCepat) statusColor = '#92400E'; // Pulang cepat amber
        else if (r.isLembur) statusColor = '#5B21B6'; // Lembur Sabtu/Minggu ungu
        else if (r.status_kehadiran !== 'Hadir') statusColor = '#1E40AF'; // Izin/Cuti/Sakit/Dinas biru

        let statusText = r.statusLabel;
        if (r.isTerlambat) {
          statusText = `Telat (+${r.menitTerlambat}m)`;
        } else if (r.isPulangCepat) {
          statusText = `Pulang (-${r.menitPulangCepat}m)`;
        }

        const masukText = r.isNonTimed ? '-' : (r.jam_masuk || '-');
        const pulangText = r.isNonTimed ? '-' : (r.jam_pulang || '-');

        tableBody.push([
          { text: idx + 1, alignment: 'center' },
          { text: r.tanggal, alignment: 'center', fontSize: 7 },
          { text: r.nip || '-', fontSize: 7 },
          { text: r.nama_lengkap || 'Pegawai', bold: true },
          { text: r.unit_kerja || '-', fontSize: 7 },
          { text: masukText, alignment: 'center', bold: r.isTerlambat, color: r.isTerlambat ? '#991B1B' : (r.isNonTimed ? '#64748B' : '#000') },
          { text: pulangText, alignment: 'center', bold: r.isPulangCepat, color: r.isPulangCepat ? '#92400E' : (r.isNonTimed ? '#64748B' : '#000') },
          { text: statusText, color: statusColor, bold: true, fontSize: 7.2 },
          { text: r.keterangan || '-', fontSize: 6.8 }
        ]);
      });
    }

    // Definisi Dokumen pdfMake
    const docDefinition = {
      pageOrientation: 'landscape',
      pageSize: 'A4',
      pageMargins: [30, 25, 30, 30],

      content: [
        // 1. KOP SURAT RESMI UNIVERSITAS TERBUKA
        {
          stack: [
            { text: 'KEMENTERIAN PENDIDIKAN TINGGI, SAINS, DAN TEKNOLOGI', alignment: 'center', fontSize: 10, bold: true, color: '#1E293B' },
            { text: 'UNIVERSITAS TERBUKA', alignment: 'center', fontSize: 14, bold: true, color: '#002B49', margin: [0, 1, 0, 1] },
            { text: 'FAKULTAS HUKUM, ILMU SOSIAL, DAN ILMU POLITIK (FHISIP)', alignment: 'center', fontSize: 11, bold: true, color: '#005691' },
            { text: 'Jl. Cabe Raya, Pondok Cabe, Pamulang, Tangerang Selatan 15418 | Laman: fhisip.ut.ac.id | Pos-el: fhisip@ecampus.ut.ac.id', alignment: 'center', fontSize: 7.5, color: '#64748B', margin: [0, 2, 0, 6] },
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 782, y2: 0, lineWidth: 1.5, lineColor: '#002B49' }] },
            { canvas: [{ type: 'line', x1: 0, y1: 2, x2: 782, y2: 2, lineWidth: 0.5, lineColor: '#CBD5E1' }] }
          ],
          margin: [0, 0, 0, 10]
        },

        // 2. JUDUL DOKUMEN & METADATA LIVE
        {
          text: judulLaporan,
          alignment: 'center',
          fontSize: 11.5,
          bold: true,
          color: '#002B49',
          margin: [0, 2, 0, 2]
        },
        {
          text: `Periode: ${activePeriodLabel} (${dateSpanInfo}) | Kebijakan Jam Kerja: Masuk Maks. ${config.jamMasuk} WIB${config.toleransi > 0 ? ` (+${config.toleransi}m toleransi)` : ''} • Pulang Min. ${config.jamPulang} WIB (Jumat: ${config.jamPulangJumat} WIB)`,
          alignment: 'center',
          fontSize: 7.8,
          color: '#475569',
          margin: [0, 0, 0, 10]
        },

        // 3. RINGKASAN METRIK KPI (Tabel Eksekutif 5 Kolom)
        {
          table: {
            widths: ['*', '*', '*', '*', '*'],
            body: [
              [
                { text: 'Total Data Live', style: 'kpiLabel' },
                { text: 'Hadir Tepat Waktu', style: 'kpiLabel' },
                { text: 'Keterlambatan Datang', style: 'kpiLabel' },
                { text: 'Pulang Lebih Awal', style: 'kpiLabel' },
                { text: 'Lembur & Izin/Cuti', style: 'kpiLabel' }
              ],
              [
                { text: `${totalLog.toLocaleString('id-ID')} Data`, style: 'kpiValue' },
                { text: `${tepatCount.toLocaleString('id-ID')} (${persenTepat}%)`, style: 'kpiValue', color: '#065F46' },
                { text: `${telatCount.toLocaleString('id-ID')} (${persenTelat}%) • Rata ${rataMenitTelat}m`, style: 'kpiValue', color: '#991B1B' },
                { text: `${pulangCepatCount.toLocaleString('id-ID')} Kejadian`, style: 'kpiValue', color: '#92400E' },
                { text: `${lemburCount} Lembur • ${izinCount} Izin/Dinas`, style: 'kpiValue', color: '#4C1D95' }
              ]
            ]
          },
          layout: {
            fillColor: function (rowIndex) { return rowIndex === 0 ? '#F1F5F9' : '#FFFFFF'; },
            hLineColor: function () { return '#CBD5E1'; },
            vLineColor: function () { return '#CBD5E1'; }
          },
          margin: [0, 0, 0, 12]
        },

        // 4. TABEL UTAMA PRESENSI
        {
          table: {
            headerRows: 1,
            widths: tableWidths,
            body: tableBody
          },
          layout: {
            fillColor: function (rowIndex) {
              if (rowIndex === 0) return '#002B49';
              return rowIndex % 2 === 0 ? '#F8FAFC' : null;
            },
            hLineColor: function () { return '#E2E8F0'; },
            vLineColor: function () { return '#E2E8F0'; },
            paddingLeft: function () { return 4; },
            paddingRight: function () { return 4; },
            paddingTop: function () { return 4; },
            paddingBottom: function () { return 4; }
          }
        },

        // 5. BLOK TANDA TANGAN PEJABAT RESMI DEKANAT FHISIP UT
        {
          columns: [
            {
              width: 250,
              stack: [
                { text: 'Mengetahui,', fontSize: 8 },
                { text: 'Kepala Bagian Tata Usaha FHISIP', bold: true, fontSize: 8.5 },
                { text: '', margin: [0, 35, 0, 0] },
                { text: '( .................................................... )', bold: true, fontSize: 8.5 },
                { text: 'NIP. .................................................', fontSize: 8, color: '#555' }
              ]
            },
            {
              width: '*',
              text: ''
            },
            {
              width: 260,
              stack: [
                { text: `Tangerang Selatan, ${todayIndo}`, fontSize: 8 },
                { text: 'Dekan FHISIP Universitas Terbuka,', bold: true, fontSize: 8.5 },
                { text: '', margin: [0, 35, 0, 0] },
                { text: 'Dr. Meita Istianda, S.IP., M.Si.', bold: true, fontSize: 8.5 },
                { text: 'NIP 196705191987012001', fontSize: 8, color: '#334155' }
              ]
            }
          ],
          margin: [10, 25, 10, 0],
          unbreakable: true
        }
      ],

      styles: {
        tableHeader: {
          bold: true,
          fontSize: 7.5,
          color: '#FFFFFF',
          alignment: 'center'
        },
        kpiLabel: {
          bold: true,
          fontSize: 7.5,
          color: '#475569',
          alignment: 'center'
        },
        kpiValue: {
          bold: true,
          fontSize: 9,
          color: '#002B49',
          alignment: 'center'
        }
      },

      defaultStyle: {
        fontSize: 7.3,
        lineHeight: 1.15
      }
    };

    const periodSlug = filterState.bulan ? `_${filterState.bulan}` : '_Semua_Periode';
    const prefixName = useFiltered
      ? 'Rekap_Presensi_Terfilter'
      : (mode === 'pegawai' ? `Rekap_Disiplin_Pegawai${periodSlug}` : `Rekap_Presensi_FHISIP_UT${periodSlug}`);
    const fileName = `${prefixName}_${config.jamMasuk.replace(':', '.')}_${new Date().toISOString().slice(0, 10)}.pdf`;

    window.pdfMake.createPdf(docDefinition).download(fileName);
    window.app.showToast(`Dokumen PDF ${useFiltered ? 'Hasil Filter' : activePeriodLabel} (${totalLog.toLocaleString('id-ID')} data live) berhasil diunduh!`, 'success');
  }

  window.pdfExport = {
    exportPdf
  };

})();
