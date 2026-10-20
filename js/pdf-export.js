/**
 * MODUL EKSPOR PDF RESMI FHISIP UNIVERSITAS TERBUKA
 * Menghasilkan dokumen PDF berkualitas tinggi, rapih, dan siap cetak
 * Menggunakan library pdfMake dengan Kop Surat Resmi & Blok Tanda Tangan Dekanat
 */

(function () {
  'use strict';

  function initPdfMake() {
    if (window.pdfMake && window.pdfMake.vfs == null && window.vfsFonts) {
      window.pdfMake.vfs = window.vfsFonts.pdfMake ? window.vfsFonts.pdfMake.vfs : window.vfsFonts;
    }
  }

  /**
   * Menghasilkan dan mengunduh berkas PDF Rekapitulasi Presensi
   * @param {string} mode 'harian' (Log Lengkap) | 'pegawai' (Akumulasi per Pegawai)
   */
  function exportPdf(mode = 'harian') {
    initPdfMake();

    if (!window.pdfMake) {
      alert('Library pdfMake belum termuat dengan sempurna. Harap segarkan halaman.');
      return;
    }

    const config = window.app.getConfig();
    const evaluatedRecords = window.app.getEvaluatedRecords();
    const todayIndo = new Date().toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    // Ringkasan KPI
    const totalLog = evaluatedRecords.length;
    let tepatCount = 0;
    let telatCount = 0;
    let totalMenitTelat = 0;
    let pulangCepatCount = 0;

    evaluatedRecords.forEach(r => {
      if (r.status_kehadiran === 'Hadir') {
        if (r.isTerlambat) {
          telatCount++;
          totalMenitTelat += r.menitTerlambat;
        } else {
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

    // Judul & Tipe Laporan
    const judulLaporan = mode === 'pegawai'
      ? 'LAPORAN AKUMULASI KEDISIPLINAN PER PEGAWAI'
      : 'LAPORAN REKAPITULASI DETAIL PRESENSI PEGAWAI';

    // Buat Isi Tabel berdasarkan mode
    let tableBody = [];
    let tableWidths = [];

    if (mode === 'pegawai') {
      tableWidths = [25, 110, 150, 160, 60, 60, 90, 80];
      tableBody.push([
        { text: 'No', style: 'tableHeader' },
        { text: 'NIP', style: 'tableHeader' },
        { text: 'Nama Lengkap', style: 'tableHeader' },
        { text: 'Program Studi / Unit', style: 'tableHeader' },
        { text: 'Total Hadir', style: 'tableHeader' },
        { text: 'Tepat', style: 'tableHeader' },
        { text: 'Terlambat', style: 'tableHeader' },
        { text: '% Disiplin', style: 'tableHeader' }
      ]);

      const pegawaiMap = window.app.getPegawaiAggregations();
      pegawaiMap.forEach((p, idx) => {
        tableBody.push([
          { text: idx + 1, alignment: 'center' },
          { text: p.nip, fontSize: 7.5 },
          { text: p.nama_lengkap, bold: true },
          { text: p.unit_kerja || '-', fontSize: 7.5 },
          { text: p.totalHadir, alignment: 'center', bold: true },
          { text: p.tepatCount, alignment: 'center', color: '#065F46' },
          { 
            text: p.telatCount > 0 ? `${p.telatCount}x (${p.totalMenitTelat}m)` : '0', 
            alignment: 'center', 
            color: p.telatCount > 0 ? '#991B1B' : '#065F46',
            bold: p.telatCount > 0
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
      // Mode Log Harian
      tableWidths = [22, 60, 100, 135, 140, 48, 48, 95, 80];
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

      // Batasi 500 baris pertama jika sangat banyak agar ukuran PDF tetap efisien
      const exportList = evaluatedRecords.slice(0, 500);

      exportList.forEach((r, idx) => {
        let statusColor = '#065F46'; // Tepat waktu hijau
        if (r.isTerlambat) statusColor = '#991B1B'; // Telat merah
        else if (r.isPulangCepat) statusColor = '#92400E'; // Pulang cepat amber
        else if (r.status_kehadiran !== 'Hadir') statusColor = '#1E40AF'; // Izin biru

        let statusText = r.statusLabel;
        if (r.isTerlambat) {
          statusText = `Telat (+${r.menitTerlambat}m)`;
        } else if (r.isPulangCepat) {
          statusText = `Pulang (-${r.menitPulangCepat}m)`;
        }

        tableBody.push([
          { text: idx + 1, alignment: 'center' },
          { text: r.tanggal, alignment: 'center', fontSize: 7.5 },
          { text: r.nip, fontSize: 7.5 },
          { text: r.nama_lengkap || 'Pegawai', bold: true },
          { text: r.unit_kerja || '-', fontSize: 7.5 },
          { text: r.jam_masuk || '-', alignment: 'center', bold: r.isTerlambat, color: r.isTerlambat ? '#991B1B' : '#000' },
          { text: r.jam_pulang || '-', alignment: 'center', bold: r.isPulangCepat, color: r.isPulangCepat ? '#92400E' : '#000' },
          { text: statusText, color: statusColor, bold: true, fontSize: 7.5 },
          { text: r.keterangan || '-', fontSize: 7 }
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

        // 2. JUDUL DOKUMEN & AMBANG BATAS
        {
          text: judulLaporan,
          alignment: 'center',
          fontSize: 12,
          bold: true,
          color: '#002B49',
          margin: [0, 2, 0, 3]
        },
        {
          text: `Kebijakan Batas Jam Kerja: Masuk Maksimal ${config.jamMasuk} WIB ${config.toleransi > 0 ? `(+${config.toleransi}m toleransi)` : ''} | Pulang Minimal ${config.jamPulang} WIB (Jumat: ${config.jamPulangJumat} WIB)`,
          alignment: 'center',
          fontSize: 8,
          color: '#475569',
          margin: [0, 0, 0, 10]
        },

        // 3. RINGKASAN METRIK KPI (Tabel Eksekutif)
        {
          table: {
            widths: ['*', '*', '*', '*'],
            body: [
              [
                { text: 'Total Presensi Terdata', style: 'kpiLabel' },
                { text: 'Kehadiran Tepat Waktu', style: 'kpiLabel' },
                { text: 'Keterlambatan Datang', style: 'kpiLabel' },
                { text: 'Pulang Lebih Awal', style: 'kpiLabel' }
              ],
              [
                { text: `${totalLog} Catatan`, style: 'kpiValue' },
                { text: `${tepatCount} (${persenTepat}%)`, style: 'kpiValue', color: '#065F46' },
                { text: `${telatCount} (${persenTelat}%) • Rata ${rataMenitTelat}m`, style: 'kpiValue', color: '#991B1B' },
                { text: `${pulangCepatCount} Kejadian`, style: 'kpiValue', color: '#92400E' }
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
            paddingLeft: function () { return 5; },
            paddingRight: function () { return 5; },
            paddingTop: function () { return 4; },
            paddingBottom: function () { return 4; }
          }
        },

        // 5. BLOK TANDA TANGAN PEJABAT
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
                { text: 'Dekan FHISIP Universitas Terbuka', bold: true, fontSize: 8.5 },
                { text: '', margin: [0, 35, 0, 0] },
                { text: '( .................................................... )', bold: true, fontSize: 8.5 },
                { text: 'NIP. .................................................', fontSize: 8, color: '#555' }
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
          fontSize: 8,
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
          fontSize: 9.5,
          color: '#002B49',
          alignment: 'center'
        }
      },

      defaultStyle: {
        fontSize: 7.5,
        lineHeight: 1.15
      }
    };

    const fileName = `Rekap_Presensi_FHISIP_UT_${config.jamMasuk.replace(':', '.')}_${new Date().toISOString().slice(0, 10)}.pdf`;

    window.pdfMake.createPdf(docDefinition).download(fileName);
    window.app.showToast('Dokumen PDF resmi berhasil diunduh!', 'success');
  }

  window.pdfExport = {
    exportPdf
  };

})();
