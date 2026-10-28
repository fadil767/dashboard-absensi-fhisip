/**
 * MODUL GENERATOR LAPORAN REKAPITULASI KEHADIRAN RESMI (FORMAT BIOMETRIK FHISIP UT)
 * Fakultas Hukum, Ilmu Sosial, dan Ilmu Politik (FHISIP) Universitas Terbuka
 *
 * Menghasilkan luaran Excel (.xlsx) terolah yang 100% sesuai format standar
 * "Laporan Rekapitulasi (FHISIP [Bulan] [Tahun])" lengkap:
 * - Urutan No. ID Biometrik & Pengelompokan Seksi beruntun (ADMINISTRASI / DOSEN / PTNPNS / FHISIP)
 * - Perhitungan live Normal, Riil (=K-M), Absen (=S+T+Z+AA+AC), Trlmbt, Plg. Cpt, Lmbr (Sabtu-Minggu),
 *   Tanpa Keterangan, D.Luar, Sakit, Cuti, Ijin, Total Seksi, Grand Total, & Kop Tanda Tangan Dekan FHISIP-UT.
 */

(function () {
  'use strict';

  const MONTH_NAMES = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  const DAY_NAMES_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  // Peta Resmi No. ID Biometrik, Nama Lengkap Bergelar, & Seksi Urutan Mesin Biometrik FHISIP UT
  const OFFICIAL_BIOMETRIC_ROSTER = {
    "199305122009031148": {
      "order": 100,
      "pin": 148,
      "name": "Acep Surya",
      "group": "ADMINISTRASI"
    },
    "197205122016032227": {
      "order": 200,
      "pin": 227,
      "name": "Caecilia Maria\nI.H,S.Psi",
      "group": "ADMINISTRASI"
    },
    "197805122022032233": {
      "order": 300,
      "pin": 233,
      "name": "Muhammad Jati Eko Ermanto, S.H.",
      "group": "ADMINISTRASI"
    },
    "197205122019031302": {
      "order": 400,
      "pin": 302,
      "name": "Iwan Ruswana",
      "group": "ADMINISTRASI"
    },
    "199205122017031372": {
      "order": 500,
      "pin": 372,
      "name": "Endang Ismiatun",
      "group": "ADMINISTRASI"
    },
    "197405122013031404": {
      "order": 600,
      "pin": 404,
      "name": "Elisa Pandanwangi,\nS.Sos., M.Kom.",
      "group": "ADMINISTRASI"
    },
    "198705122022032467": {
      "order": 700,
      "pin": 451,
      "name": "Erika Darmayanti, S.P.\nS.E",
      "group": "ADMINISTRASI"
    },
    "199405122014032549": {
      "order": 800,
      "pin": 549,
      "name": "Dr. Agus Priyanto,\nM.Si",
      "group": "DOSEN"
    },
    "197005122015031550": {
      "order": 900,
      "pin": 550,
      "name": "Drs. Agus Riyanto,\nM.Ed.",
      "group": "DOSEN"
    },
    "197205122017031552": {
      "order": 1000,
      "pin": 552,
      "name": "Anto Hidayat, S.IP.,\nM.S",
      "group": "DOSEN"
    },
    "197405122019031554": {
      "order": 1100,
      "pin": 554,
      "name": "Dra. Arifah Bintarti",
      "group": "DOSEN"
    },
    "197905122006032559": {
      "order": 1200,
      "pin": 559,
      "name": "Prof. Daryono, SH.",
      "group": "DOSEN"
    },
    "198705122014032567": {
      "order": 1300,
      "pin": 567,
      "name": "Dr. Irsanti WA,S.Sos.M., Si.",
      "group": "DOSEN"
    },
    "198905122016032569": {
      "order": 1400,
      "pin": 569,
      "name": "Prof. Dr. Karnedi, M.A.",
      "group": "DOSEN"
    },
    "199405122021031574": {
      "order": 1500,
      "pin": 574,
      "name": "Dr. Meita Istianda,\nM.Si",
      "group": "DOSEN"
    },
    "197205122006032577": {
      "order": 1600,
      "pin": 577,
      "name": "Dra. Nila Kusuma,\nM.Si.",
      "group": "DOSEN"
    },
    "197305122007031578": {
      "order": 1700,
      "pin": 578,
      "name": "Dra. Parwitaningsih,\nM.S",
      "group": "DOSEN"
    },
    "198105122015031586": {
      "order": 1800,
      "pin": 586,
      "name": "Dr. Sri Sediyaningsih, M.Si.",
      "group": "DOSEN"
    },
    "198905122005031594": {
      "order": 1900,
      "pin": 594,
      "name": "Widyasari, S.S.,\nM.Hum.",
      "group": "DOSEN"
    },
    "199405122010032599": {
      "order": 2000,
      "pin": 599,
      "name": "Yanti Hermawati, S.Sos.I., M.Si.",
      "group": "DOSEN"
    },
    "197005122013031800": {
      "order": 2100,
      "pin": 800,
      "name": "Dra. Yulia Budiwati, M.Si.",
      "group": "DOSEN"
    },
    "197605122019031806": {
      "order": 2200,
      "pin": 806,
      "name": "Dr. Milwan, S.Sos.,\nM.Si",
      "group": "DOSEN"
    },
    "197905122022032809": {
      "order": 2300,
      "pin": 809,
      "name": "Dra. Ace Sriati Rachman M.Si.",
      "group": "DOSEN"
    },
    "197605122008032831": {
      "order": 2400,
      "pin": 831,
      "name": "Zumarie Putrimezu, S.E.",
      "group": "ADMINISTRASI"
    },
    "198005122012032835": {
      "order": 2500,
      "pin": 835,
      "name": "Eka Indriati, S.Kom.",
      "group": "ADMINISTRASI"
    },
    "197105122010032851": {
      "order": 2600,
      "pin": 851,
      "name": "Drs. Hasanuddin, M.Si.",
      "group": "DOSEN"
    },
    "198705122008032867": {
      "order": 2700,
      "pin": 867,
      "name": "Rahma Tri N S.IKom.",
      "group": "ADMINISTRASI"
    },
    "199305122014032873": {
      "order": 2800,
      "pin": 873,
      "name": "Pratiwi Anindita,\nM.Hum",
      "group": "DOSEN"
    },
    "197205122018032877": {
      "order": 2900,
      "pin": 873,
      "name": "Dr. Seno Wibowo,\nM.H. M.Hum",
      "group": "DOSEN"
    },
    "198705122015031892": {
      "order": 3000,
      "pin": 892,
      "name": "Bambang Agus, M.A.P",
      "group": "DOSEN"
    },
    "199305122019031148": {
      "order": 3200,
      "pin": 1148,
      "name": "Nadia Nurani Isfarin, LL.M.",
      "group": "DOSEN",
      "tugasBelajar": true
    },
    "197905122012032159": {
      "order": 3300,
      "pin": 1159,
      "name": "Bahir Mukhammad, S.H., M.H.",
      "group": "DOSEN"
    },
    "198805122010032193": {
      "order": 3400,
      "pin": 1193,
      "name": "Azrul Reza Rifqi A,\nS.E.",
      "group": "ADMINISTRASI"
    },
    "198905122011031194": {
      "order": 3500,
      "pin": 1194,
      "name": "Gilang Munggaran,\nS.E.",
      "group": "ADMINISTRASI"
    },
    "199405122012032249": {
      "order": 3600,
      "pin": 1249,
      "name": "Syafiqoh  S.E.Sy., M.A.",
      "group": "DOSEN"
    },
    "197005122013031250": {
      "order": 3700,
      "pin": 1250,
      "name": "Nur Hayati, S.Pd. M.A",
      "group": "DOSEN"
    },
    "197105122014032251": {
      "order": 3800,
      "pin": 1251,
      "name": "Vica Ananta  S.Pd,\nM.A.",
      "group": "DOSEN"
    },
    "197205122015031252": {
      "order": 3900,
      "pin": 1252,
      "name": "Madiha D.C  S.H., LL.M.",
      "group": "DOSEN"
    },
    "197305122016032253": {
      "order": 4000,
      "pin": 1253,
      "name": "Isma Dwi Fiani S.I.Kom., M.Si.",
      "group": "DOSEN"
    },
    "197505122018032255": {
      "order": 4100,
      "pin": 1255,
      "name": "Dedy Juniadi, S.Kom,\nM.A",
      "group": "DOSEN"
    },
    "197505122007031280": {
      "order": 4200,
      "pin": 1280,
      "name": "M Yusuf Wibisana,\nS.Kom",
      "group": "ADMINISTRASI"
    },
    "198705122019031292": {
      "order": 4300,
      "pin": 1292,
      "name": "Sarah Fadilla, M.A.B",
      "group": "DOSEN"
    },
    "199305122007031298": {
      "order": 4400,
      "pin": 1298,
      "name": "Rachmawati W \nM.I.Kom.",
      "group": "DOSEN"
    },
    "199405122008032299": {
      "order": 4500,
      "pin": 1299,
      "name": "Widiyanto, S.Pd.,\nM.Kom.",
      "group": "DOSEN"
    },
    "198405122012032339": {
      "order": 4600,
      "pin": 1339,
      "name": "Muhamad Lazuardi, S.Kom.",
      "group": "ADMINISTRASI"
    },
    "198505122013031340": {
      "order": 4700,
      "pin": 1340,
      "name": "Rahmat Hidayat, S.E.",
      "group": "ADMINISTRASI",
      "tugasBelajar": true
    },
    "198605122014032341": {
      "order": 4800,
      "pin": 1341,
      "name": "Rani Dwi S, S.A.P.",
      "group": "ADMINISTRASI"
    },
    "198505122016032415": {
      "order": 5000,
      "pin": 1415,
      "name": "Sapto Setyo  S.IP.,\nM.A.",
      "group": "DOSEN",
      "subGroup": "PTNPNS"
    },
    "198605122017031416": {
      "order": 5100,
      "pin": 1416,
      "name": "Dina Fadiyah, S.IP.,\nM.A",
      "group": "DOSEN",
      "subGroup": "PTNPNS"
    },
    "197005122008032425": {
      "order": 5200,
      "pin": 1425,
      "name": "Dr. Tora Akadira, M.Si.\nM.A",
      "group": "DOSEN",
      "subGroup": "PTNPNS"
    },
    "198605122020032491": {
      "order": 5300,
      "pin": 1491,
      "name": "Viku Paoki, S.Sos",
      "group": "ADMINISTRASI"
    },
    "198905122008032569": {
      "order": 5400,
      "pin": 1569,
      "name": "Amud Sunarya S.Pd.,\nM.Si",
      "group": "DOSEN"
    },
    "199105122010032571": {
      "order": 5500,
      "pin": 1571,
      "name": "Nur Ambia Arma\nM.A.P.",
      "group": "DOSEN"
    },
    "199205122011031572": {
      "order": 5600,
      "pin": 1572,
      "name": "Aji Fajar Suryo M. A.",
      "group": "DOSEN"
    },
    "197805122022032583": {
      "order": 5700,
      "pin": 1583,
      "name": "Enggar M  S.Pd.,\nM.Hum.",
      "group": "DOSEN"
    },
    "197905122005031584": {
      "order": 5800,
      "pin": 1584,
      "name": "Ardik Ardianto, M.A.",
      "group": "DOSEN"
    },
    "198805122014032593": {
      "order": 5900,
      "pin": 1593,
      "name": "Sri Pujiati, S.Pd., M.So",
      "group": "DOSEN"
    },
    "198905122015031594": {
      "order": 6000,
      "pin": 1596,
      "name": "Irla Yulia",
      "group": "DOSEN"
    },
    "199105122017031596": {
      "order": 6100,
      "pin": 1596,
      "name": "Nurkhalila F, M.I.Kom.",
      "group": "DOSEN"
    },
    "197005122021031600": {
      "order": 6200,
      "pin": 1600,
      "name": "Laras Ayu  S.I.P.,\nM.Sos",
      "group": "DOSEN"
    },
    "197605122009031606": {
      "order": 6300,
      "pin": 1606,
      "name": "Husna Putri\nS.S.T.,M.B.A",
      "group": "DOSEN"
    },
    "198005122013031610": {
      "order": 6400,
      "pin": 1610,
      "name": "Meliza, S.H., M.H.",
      "group": "DOSEN"
    },
    "198105122014032611": {
      "order": 6500,
      "pin": 1611,
      "name": "Hanif Hardianto, M.H.",
      "group": "DOSEN"
    },
    "198805122021031618": {
      "order": 6600,
      "pin": 1618,
      "name": "Dwi Rahmawati,\nS.E.M.AB",
      "group": "DOSEN"
    },
    "197405122014032629": {
      "order": 6700,
      "pin": 1629,
      "name": "Drs. Wawan\nRuswanto M.Si",
      "group": "DOSEN"
    },
    "197805122018032633": {
      "order": 6800,
      "pin": 1633,
      "name": "Dr. Eha Saleha,  M.Si.",
      "group": "DOSEN"
    },
    "197005122013031700": {
      "order": 6900,
      "pin": 1700,
      "name": "Septin Tri F, S.M.",
      "group": "ADMINISTRASI"
    },
    "197105122014032701": {
      "order": 7000,
      "pin": 1701,
      "name": "M Yossy Kusuma,\nS.Kom.",
      "group": "ADMINISTRASI"
    },
    "197205122015031702": {
      "order": 7100,
      "pin": 1702,
      "name": "Annisa Tul Hasanah,\nS.E",
      "group": "ADMINISTRASI"
    },
    "197305122016032703": {
      "order": 7200,
      "pin": 1703,
      "name": "Deka Taufiq R ,S.E.",
      "group": "ADMINISTRASI"
    },
    "197405122017031704": {
      "order": 7300,
      "pin": 1704,
      "name": "Eka Nurjanah, S.H.",
      "group": "ADMINISTRASI"
    },
    "197505122018032705": {
      "order": 7400,
      "pin": 1705,
      "name": "Karlia Zainul, S.Kom.I.",
      "group": "ADMINISTRASI"
    },
    "197605122019031706": {
      "order": 7500,
      "pin": 1706,
      "name": "Lisa Dea Plasenta,\nS.K.L",
      "group": "ADMINISTRASI"
    },
    "197705122020032707": {
      "order": 7600,
      "pin": 1707,
      "name": "Raden Roro Siti\nFatimah",
      "group": "ADMINISTRASI"
    },
    "197105122021031726": {
      "order": 7700,
      "pin": 1726,
      "name": "Bintang Parashteo,\nM.H",
      "group": "DOSEN"
    },
    "198005122019031760": {
      "order": 7800,
      "pin": 1760,
      "name": "Aam Mariyamah,\nM.Hum.",
      "group": "DOSEN"
    },
    "198505122006032765": {
      "order": 7900,
      "pin": 1765,
      "name": "Agus Priyanto, S.A.B.,\nM.I.P.",
      "group": "DOSEN"
    },
    "198605122007031766": {
      "order": 8000,
      "pin": 1766,
      "name": "Amelia Yeza\nPradhipta, S.Hum., M.Si.",
      "group": "DOSEN"
    },
    "198905122017031794": {
      "order": 8100,
      "pin": 1794,
      "name": "Fadri Ari Sandi, S.A.N., M.P.A.",
      "group": "DOSEN"
    },
    "200610001801": {
      "order": 8200,
      "pin": 1801,
      "name": "Gita Khuzaimah\nMaulida, M.I.Pol.",
      "group": "DOSEN"
    },
    "200710001802": {
      "order": 8300,
      "pin": 1802,
      "name": "Grace Prima Apriani\nSihombing, M.Sos.",
      "group": "DOSEN"
    },
    "200910001804": {
      "order": 8400,
      "pin": 1804,
      "name": "Helni Sadid Parassa,\nS.Ip., M.Si.",
      "group": "DOSEN"
    },
    "201210001807": {
      "order": 8500,
      "pin": 1807,
      "name": "Husnaeni Fauziah\nAmani, M.Si.",
      "group": "DOSEN"
    },
    "201510001846": {
      "order": 8600,
      "pin": 1846,
      "name": "Rafika Afriyanti,  S.Sos., M.P.A.",
      "group": "DOSEN"
    },
    "201710001848": {
      "order": 8700,
      "pin": 1848,
      "name": "Rezki Aguswidya\nUtami, M.A.B.",
      "group": "DOSEN"
    },
    "200810001857": {
      "order": 8800,
      "pin": 1857,
      "name": "Rosiana Nurwa\nIndah, S.Hum., M.A.",
      "group": "DOSEN"
    },
    "201210001861": {
      "order": 8900,
      "pin": 1861,
      "name": "Sarah Anistia, S.T.,\nM.A",
      "group": "DOSEN"
    },
    "201710001866": {
      "order": 9000,
      "pin": 1866,
      "name": "Sekartaji Anisa Putri,\nM.Si.",
      "group": "DOSEN"
    },
    "200610001873": {
      "order": 9100,
      "pin": 1873,
      "name": "Wira Puji Hendarwati,  M.A.",
      "group": "DOSEN"
    },
    "200810001875": {
      "order": 9200,
      "pin": 1875,
      "name": "Yusup Lintang Cahyo, S.I.P., M.A.P.",
      "group": "DOSEN"
    },
    "201610001901": {
      "order": 9300,
      "pin": 1901,
      "name": "Yadi Apriadi, S.Kom.",
      "group": "FHISIP"
    },
    "201010001931": {
      "order": 9400,
      "pin": 1931,
      "name": "Azzahra Rabiatul\nAdawiy",
      "group": "FHISIP"
    },
    "201110001950": {
      "order": 9500,
      "pin": 1950,
      "name": "Rahadian Kamandaru",
      "group": "FHISIP"
    },
    "201210001951": {
      "order": 9600,
      "pin": 1951,
      "name": "Dr. Endang Tri Irianingsih M.Sos.",
      "group": "FHISIP"
    },
    "201410001953": {
      "order": 9700,
      "pin": 1953,
      "name": "Arina Haque",
      "group": "FHISIP"
    },
    "201810001957": {
      "order": 9800,
      "pin": 1957,
      "name": "Irma Mega Putri",
      "group": "FHISIP"
    },
    "200610001963": {
      "order": 9900,
      "pin": 1963,
      "name": "Irva Sectio Caesaria\nSa",
      "group": "FHISIP"
    },
    "200910001966": {
      "order": 10000,
      "pin": 1966,
      "name": "Aprilia Cahyani\nPrabudi",
      "group": "FHISIP"
    },
    "201610001973": {
      "order": 10100,
      "pin": 1973,
      "name": "M. Rizki Adiyaksa",
      "group": "FHISIP"
    },
    "201410001989": {
      "order": 10200,
      "pin": 1280,
      "name": "Asia Susanti, S.S.\nS.Kom",
      "group": "ADMINISTRASI"
    },
    "202210002033": {
      "order": 10300,
      "pin": 1159,
      "name": "Puryanto S.ST., M.Ds",
      "group": "DOSEN"
    },
    "201110002040": {
      "order": 10400,
      "pin": 2040,
      "name": "Ishmah Ariiqoh",
      "group": "ADMINISTRASI"
    },
    "201210002041": {
      "order": 10500,
      "pin": 2041,
      "name": "Radhitya Putranugraha, S.Psi.",
      "group": "ADMINISTRASI"
    },
    "201310002042": {
      "order": 10600,
      "pin": 2042,
      "name": "Raihan Rizky Andana, S.M.",
      "group": "ADMINISTRASI"
    },
    "201410002043": {
      "order": 10700,
      "pin": 2043,
      "name": "Muhammad Yahya Fadillah, S.Mat.",
      "group": "ADMINISTRASI"
    },
    "201510002044": {
      "order": 10800,
      "pin": 2044,
      "name": "Mohammad Sihabudin Al Qurtubi, S.Si.D.",
      "group": "ADMINISTRASI"
    },
    "201610002045": {
      "order": 10900,
      "pin": 2045,
      "name": "Wafiddin Naufal, S.T.",
      "group": "ADMINISTRASI"
    },
    "201710002046": {
      "order": 11000,
      "pin": 2046,
      "name": "Firya Syafira, S.Kom.",
      "group": "ADMINISTRASI"
    },
    "198705122020032617": {
      "order": 6506,
      "pin": 1617,
      "name": "Abdurrahman Rahim Thaha",
      "group": "DOSEN"
    },
    "197505122014032305": {
      "order": 4506,
      "pin": 1305,
      "name": "ADISTHY SHABRINA N.",
      "group": "DOSEN"
    },
    "199205122010032247": {
      "order": 3553,
      "pin": 1247,
      "name": "DANIEL PASARIBU,S.Pd",
      "group": "DOSEN"
    },
    "199205122021032605": {
      "order": 6205,
      "pin": 1605,
      "name": "Destiana, S.A.B., M.A.B.",
      "group": "ADMINISTRASI"
    },
    "198805122019032260": {
      "order": 4105,
      "pin": 1260,
      "name": "Dewi Maharani Rachmaningsih, S.Hum., M.A.",
      "group": "DOSEN"
    },
    "197605122005031439": {
      "order": 5214,
      "pin": 1439,
      "name": "Dr. Faizal Madya, S.IP., M.Si.",
      "group": "DOSEN"
    },
    "198205122010032570": {
      "order": 1401,
      "pin": 570,
      "name": "Dr. Isnaeni Yuliani, M.Si.",
      "group": "DOSEN"
    },
    "197905122008031662": {
      "order": 6829,
      "pin": 1662,
      "name": "Dr. M. Jeffri Arlinandes Chandra, S.H., M.H.",
      "group": "DOSEN"
    },
    "196805121995031579": {
      "order": 1701,
      "pin": 579,
      "name": "Dr. Muhtarom, S.E., M.M., Ak., CA",
      "group": "DOSEN"
    },
    "196105121989031555": {
      "order": 1101,
      "pin": 555,
      "name": "Drs. Ayi Karyana, M.Si.",
      "group": "DOSEN"
    },
    "198705122018032793": {
      "order": 8027,
      "pin": 1793,
      "name": "Evi Zakiyah, S.IIP., M.Hum.",
      "group": "DOSEN"
    },
    "197405122017031254": {
      "order": 4001,
      "pin": 1254,
      "name": "GUNAWAN WIRADHARMA",
      "group": "DOSEN"
    },
    "198505122014031556": {
      "order": 1102,
      "pin": 556,
      "name": "Habiburrahman, S.Sos., M.A.",
      "group": "DOSEN"
    },
    "199305122012032573": {
      "order": 1404,
      "pin": 573,
      "name": "Indra Pratama Putra S.",
      "group": "DOSEN"
    },
    "198805122007031568": {
      "order": 1301,
      "pin": 568,
      "name": "Jayanti Armida Sari",
      "group": "DOSEN"
    },
    "198905122019032821": {
      "order": 2312,
      "pin": 821,
      "name": "Lingga Yonita, M.I.Kom.",
      "group": "DOSEN"
    },
    "197305122015031928": {
      "order": 3036,
      "pin": 928,
      "name": "Majidah",
      "group": "DOSEN"
    },
    "202010001641": {
      "order": 6808,
      "pin": 1641,
      "name": "Muhammad Danu",
      "group": "ADMINISTRASI"
    },
    "197805122016032433": {
      "order": 5208,
      "pin": 1433,
      "name": "Nong Ayu Triyanti",
      "group": "DOSEN"
    },
    "198405122007031064": {
      "order": 3095,
      "pin": 1064,
      "name": "Ridho Harta",
      "group": "DOSEN"
    },
    "201510001900": {
      "order": 9225,
      "pin": 1900,
      "name": "Rivaldy N Muhammad",
      "group": "FHISIP"
    },
    "201610001883": {
      "order": 9208,
      "pin": 1883,
      "name": "Roman Hadi Saputro, M.I",
      "group": "DOSEN"
    },
    "199105122020032862": {
      "order": 2611,
      "pin": 862,
      "name": "Sarah Ayu Putri Novaria, M.I.Kom.",
      "group": "DOSEN"
    },
    "199005122020032595": {
      "order": 1901,
      "pin": 595,
      "name": "Sarah Derma Ekaputri, S.I.Kom., M.I.Kom.",
      "group": "DOSEN"
    },
    "199205122021032870": {
      "order": 2703,
      "pin": 870,
      "name": "Viola Dwi Putri Syarif, S.Hum., M.IP.",
      "group": "DOSEN"
    },
    "199305122015031648": {
      "order": 6815,
      "pin": 1648,
      "name": "Vivi Indra Amelia, Nst.",
      "group": "DOSEN"
    },
    "198105122019031436": {
      "order": 5211,
      "pin": 1436,
      "name": "Windra Irawan",
      "group": "DOSEN"
    }
  };

  // Indeks balik No. ID Biometrik -> NIP resmi agar baris impor "PIN-xxx" otomatis menyatu ke pegawai yang tepat
  const PIN_TO_OFFICIAL_NIP = {};
  for (const [nipKey, meta] of Object.entries(OFFICIAL_BIOMETRIC_ROSTER)) {
    if (meta.pin !== '' && meta.pin != null && !PIN_TO_OFFICIAL_NIP[String(meta.pin)]) {
      PIN_TO_OFFICIAL_NIP[String(meta.pin)] = nipKey;
    }
  }

  // Keterangan generik sistem yang tidak perlu memenuhi kolom AF pada Laporan Rekapitulasi
  const GENERIC_SYSTEM_NOTES = new Set([
    'mesin biometrik',
    'import rekap mesin presensi',
    'data presensi oktober',
    'import tabular',
    'work from home (wfh)',
    'wfh',
    'izin sakit',
    'izin resmi',
    'cuti tahunan / bersama',
    'cuti tahunan',
    'dinas luar',
    'lembur',
    'lembur akhir pekan',
    'lembur akhir pekan (sabtu)',
    'lembur akhir pekan (minggu)',
    '-'
  ]);

  /**
   * Menghitung jumlah hari kerja normal (Senin - Jumat) dalam rentang tanggal YYYY-MM-DD (inklusif)
   */
  function getWorkingDaysInRange(startYmd, endYmd) {
    if (!startYmd || !endYmd) return 0;
    const sParts = String(startYmd).slice(0, 10).split('-').map(Number);
    const eParts = String(endYmd).slice(0, 10).split('-').map(Number);
    if (sParts.length !== 3 || eParts.length !== 3) return 0;

    const cur = new Date(sParts[0], sParts[1] - 1, sParts[2]);
    const end = new Date(eParts[0], eParts[1] - 1, eParts[2]);
    if (isNaN(cur.getTime()) || isNaN(end.getTime()) || cur > end) return 0;

    let count = 0;
    while (cur <= end) {
      const wd = cur.getDay();
      if (wd !== 0 && wd !== 6) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  function formatYmdToDmyDash(ymd) {
    if (!ymd) return '';
    const parts = String(ymd).slice(0, 10).split('-');
    if (parts.length < 3) return ymd;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }

  function formatYmdToDmySlash(ymd) {
    if (!ymd) return '';
    const parts = String(ymd).slice(0, 10).split('-');
    if (parts.length < 3) return ymd;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function formatTanggalIndo(dateStr) {
    if (!dateStr) return '';
    const parts = String(dateStr).slice(0, 10).split('-');
    if (parts.length < 3) return dateStr;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return dateStr;
    return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
  }

  function getDayNameFromYmd(ymd) {
    if (!ymd) return '-';
    const parts = String(ymd).slice(0, 10).split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return '-';
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return isNaN(d.getTime()) ? '-' : DAY_NAMES_ID[d.getDay()];
  }

  function isMeaningfulSpecialNote(noteStr) {
    if (!noteStr) return false;
    const clean = String(noteStr).trim();
    if (!clean) return false;
    const lower = clean.toLowerCase();
    if (GENERIC_SYSTEM_NOTES.has(lower)) return false;
    if (/^(import |mesin biometrik|data presensi |lembur akhir pekan)/i.test(clean)) return false;
    return true;
  }

  function canonicalizeNip(rawNip) {
    const s = String(rawNip || '').trim();
    const mPin = /^PIN-(\d+)$/i.exec(s);
    if (mPin && PIN_TO_OFFICIAL_NIP[mPin[1]]) {
      return PIN_TO_OFFICIAL_NIP[mPin[1]];
    }
    return s;
  }

  /**
   * Resolusi metadata biometrik pegawai (mendukung pegawai master maupun pegawai baru hasil Tambah/Import)
   */
  function resolveBiometricMeta(p) {
    const nipStr = String(p.nip || '').trim();
    const mapped = OFFICIAL_BIOMETRIC_ROSTER[nipStr];
    if (mapped) {
      return {
        pin: mapped.pin,
        displayName: mapped.name || p.nama_lengkap || ('Pegawai ' + nipStr),
        group: mapped.group || 'DOSEN',
        subGroup: mapped.subGroup || '',
        order: mapped.order || 50000,
        tugasBelajarDefault: Boolean(mapped.tugasBelajar)
      };
    }

    // Fallback cerdas untuk pegawai baru yang diimpor di masa mendatang
    let pin = '';
    const mNonPns = /^\d{4}1000(\d{4})$/.exec(nipStr);
    const mPinOnly = /^PIN-(\d+)$/i.exec(nipStr);
    const mAsn = /^\d{14}[12](\d{3})$/.exec(nipStr);
    const jab = String(p.jabatan || '').toLowerCase();
    const unit = String(p.unit_kerja || '');
    const isDosen = jab.includes('dosen') ||
      (unit.includes('Program Studi') && !jab.includes('tenaga kependidikan') && !jab.includes('administrasi') && !jab.includes('pengelola'));

    if (mPinOnly) {
      pin = parseInt(mPinOnly[1], 10);
    } else if (mNonPns) {
      pin = parseInt(mNonPns[1], 10);
    } else if (mAsn) {
      const d3 = parseInt(mAsn[1], 10);
      pin = isDosen && d3 < 549 ? (1000 + d3) : d3;
    } else {
      const mTail = /(\d{3,4})$/.exec(nipStr);
      if (mTail) pin = parseInt(mTail[1], 10);
    }

    const group = (p.status_kepegawaian === 'Non-PNS' && typeof pin === 'number' && pin >= 1900 && pin < 2000)
      ? 'FHISIP'
      : (isDosen ? 'DOSEN' : 'ADMINISTRASI');

    return {
      pin: pin !== '' ? pin : nipStr,
      displayName: p.nama_lengkap || ('Pegawai ' + nipStr),
      group,
      subGroup: '',
      order: typeof pin === 'number' ? (80000 + pin) : 95000,
      tugasBelajarDefault: false
    };
  }

  /**
   * Mengambil ringkasan live seluruh periode bulan yang ada di Dashboard
   */
  function getAvailableMonthsSummary() {
    const evaluated = (window.app && typeof window.app.getEvaluatedRecords === 'function')
      ? window.app.getEvaluatedRecords()
      : [];

    const defaultMonths = ['2026-09', '2026-10', '2026-11', '2026-12'];
    const monthMap = new Map();

    defaultMonths.forEach(ym => {
      monthMap.set(ym, {
        ym,
        records: [],
        nips: new Set(),
        dates: [],
        hadirCount: 0,
        telatCount: 0,
        lemburCount: 0,
        izinCount: 0
      });
    });

    evaluated.forEach(r => {
      if (!r || !r.tanggal || r.tanggal.length < 7) return;
      const ym = r.tanggal.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(ym)) return;

      if (!monthMap.has(ym)) {
        monthMap.set(ym, {
          ym,
          records: [],
          nips: new Set(),
          dates: [],
          hadirCount: 0,
          telatCount: 0,
          lemburCount: 0,
          izinCount: 0
        });
      }

      const bucket = monthMap.get(ym);
      bucket.records.push(r);
      if (r.nip) bucket.nips.add(String(r.nip).trim());
      bucket.dates.push(r.tanggal.slice(0, 10));

      if (r.isLembur) {
        bucket.lemburCount++;
      } else if (r.isIzinCutiSakitDinas) {
        bucket.izinCount++;
      } else if (r.status_kehadiran === 'Hadir') {
        bucket.hadirCount++;
        if (r.isTerlambat) bucket.telatCount++;
      }
    });

    const sortedYms = Array.from(monthMap.keys()).sort();
    return sortedYms.map(ym => {
      const b = monthMap.get(ym);
      const [y, m] = ym.split('-').map(Number);
      const uniqueDates = [...new Set(b.dates)].sort();
      const lastCalendarDay = new Date(y, m, 0).getDate();
      const defaultEnd = `${ym}-${String(lastCalendarDay).padStart(2, '0')}`;

      return {
        ym,
        year: y,
        month: m,
        labelBulan: `${MONTH_NAMES[m - 1]} ${y}`,
        count: b.records.length,
        pegawaiCount: b.nips.size,
        minDate: uniqueDates.length > 0 ? uniqueDates[0] : `${ym}-01`,
        maxDate: uniqueDates.length > 0 ? uniqueDates[uniqueDates.length - 1] : defaultEnd,
        lastCalendarDate: defaultEnd,
        hadirCount: b.hadirCount,
        telatCount: b.telatCount,
        lemburCount: b.lemburCount,
        izinCount: b.izinCount
      };
    });
  }

  /**
   * Menyinkronkan tampilan Modal Ekspor Bulanan dengan data live terbaru di Dashboard
   */
  function refreshExportModalUI(options = {}) {
    const selectEl = document.getElementById('export-month-select');
    if (!selectEl) return;

    const summaries = getAvailableMonthsSummary();
    const summaryByYm = new Map(summaries.map(s => [s.ym, s]));
    const previousValue = selectEl.value;

    let targetYm = previousValue;
    if (options.preferActiveFilter) {
      const filterState = (window.app && typeof window.app.getActiveFilterState === 'function')
        ? window.app.getActiveFilterState()
        : null;

      if (filterState && filterState.bulan && summaryByYm.has(filterState.bulan)) {
        targetYm = filterState.bulan;
      } else {
        const populated = summaries.filter(s => s.count > 0);
        if (populated.length > 0) {
          targetYm = populated[populated.length - 1].ym;
        }
      }
    }

    if (!summaryByYm.has(targetYm)) {
      targetYm = summaries[0] ? summaries[0].ym : '2026-10';
    }

    selectEl.innerHTML = summaries.map(s => {
      const infoText = s.count > 0
        ? `${s.count.toLocaleString('id-ID')} data presensi • s/d ${formatYmdToDmyDash(s.maxDate)}`
        : 'Belum ada data presensi';
      return `<option value="${s.ym}"${s.ym === targetYm ? ' selected' : ''}>${s.labelBulan} (${infoText})</option>`;
    }).join('');

    selectEl.value = targetYm;
    updateSelectedMonthPreview(targetYm, Boolean(options.updateSignatureDate));

    const septSummary = summaryByYm.get('2026-09');
    const octSummary = summaryByYm.get('2026-10');
    const elQuickSept = document.getElementById('quick-export-sept-count');
    const elQuickOct = document.getElementById('quick-export-oct-count');
    if (elQuickSept && septSummary) {
      elQuickSept.textContent = `${septSummary.count.toLocaleString('id-ID')} data`;
    }
    if (elQuickOct && octSummary) {
      elQuickOct.textContent = `${octSummary.count.toLocaleString('id-ID')} data`;
    }
  }

  /**
   * Memperbarui kartu pratinjau ringkasan live & tanggal tanda tangan saat pilihan bulan berubah
   */
  function updateSelectedMonthPreview(ymVal, updateSigDate = true) {
    const summaries = getAvailableMonthsSummary();
    const info = summaries.find(s => s.ym === ymVal);
    if (!info) return;

    if (updateSigDate) {
      const elDate = document.getElementById('export-signature-date');
      if (elDate) {
        elDate.value = info.count > 0 ? info.maxDate : info.lastCalendarDate;
      }
    }

    const box = document.getElementById('export-live-summary-box');
    if (!box) return;

    if (info.count === 0) {
      box.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px;">
          <strong>⚠️ Periode ${info.labelBulan}: Belum ada catatan presensi di Dashboard</strong>
          <span class="badge-status badge-warning" style="font-size:0.7rem;">0 Data</span>
        </div>
        <div style="margin-top:4px; font-size:0.76rem; color:var(--text-muted);">
          Silakan tambahkan presensi atau impor berkas Excel terlebih dahulu untuk periode ini.
        </div>
      `;
      return;
    }

    const workDays = getWorkingDaysInRange(`${info.ym}-01`, info.maxDate);
    box.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px; margin-bottom:6px;">
        <strong style="color:var(--ut-navy); font-size:0.82rem;">⚡ Format Rekapitulasi Biometrik Live (${info.labelBulan})</strong>
        <span class="badge-status badge-tepat" style="font-size:0.7rem; padding:2px 8px;">● ${workDays} Hari Kerja Normal</span>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(125px, 1fr)); gap:8px; font-size:0.76rem;">
        <div style="background:#FFF; border:1px solid #CBD5E1; border-radius:6px; padding:6px 8px;">
          <div style="color:var(--text-muted);">Total Data Bulan Ini</div>
          <strong style="font-size:0.92rem; color:var(--ut-blue);">${info.count.toLocaleString('id-ID')} Data</strong>
        </div>
        <div style="background:#FFF; border:1px solid #CBD5E1; border-radius:6px; padding:6px 8px;">
          <div style="color:var(--text-muted);">Pegawai Terdata</div>
          <strong style="font-size:0.92rem; color:var(--ut-navy);">${info.pegawaiCount} Pegawai</strong>
        </div>
        <div style="background:#FFF; border:1px solid #CBD5E1; border-radius:6px; padding:6px 8px;">
          <div style="color:var(--text-muted);">Rentang Tanggal</div>
          <strong style="font-size:0.78rem; color:var(--ut-navy);">${formatYmdToDmyDash(info.minDate)} s/d ${formatYmdToDmyDash(info.maxDate)}</strong>
        </div>
        <div style="background:#FFF; border:1px solid #CBD5E1; border-radius:6px; padding:6px 8px;">
          <div style="color:var(--text-muted);">Rincian Status</div>
          <strong style="font-size:0.75rem; color:#334155;">${info.hadirCount} Hadir • ${info.lemburCount} Lembur • ${info.izinCount} Izin/Cuti</strong>
        </div>
      </div>
    `;
  }

  /**
   * Mesin Inti Pembangun Workbook "Laporan Rekapitulasi" (38 Kolom A..AL)
   * Sesuai persis contoh luaran Excel resmi FHISIP UT
   */
  function buildRecapWorkbookFromRecords(records, options = {}) {
    if (!window.XLSX) {
      alert('Pustaka SheetJS (XLSX) belum siap dimuat.');
      return null;
    }

    const groupBy = options.groupBy || 'kategori';
    const pegawaiList = (window.app && typeof window.app.getPegawaiList === 'function')
      ? window.app.getPegawaiList()
      : (window.INITIAL_FHISIP_DATA ? window.INITIAL_FHISIP_DATA.pegawai : []);

    // Tentukan rentang tanggal laporan
    const dates = [...new Set(records.map(a => (a.tanggal || '').slice(0, 10)).filter(Boolean))].sort();
    const fallbackYear = Number(options.year) || 2026;
    const fallbackMonth = Number(options.month) || 10;
    const fallbackYm = `${fallbackYear}-${String(fallbackMonth).padStart(2, '0')}`;
    const lastCalDay = new Date(fallbackYear, fallbackMonth, 0).getDate();

    const startDate = options.startDate || (dates.length > 0 ? dates[0] : `${fallbackYm}-01`);
    const endDate = options.endDate || (dates.length > 0 ? dates[dates.length - 1] : `${fallbackYm}-${String(lastCalDay).padStart(2, '0')}`);
    const periodeStr = `Dari ${formatYmdToDmyDash(startDate)} s/d ${formatYmdToDmyDash(endDate)}`;
    const headerSubtitle = options.headerSubtitle || `(FHISIP ${MONTH_NAMES[fallbackMonth - 1]} ${fallbackYear})`;

    const workingDaysNormal = getWorkingDaysInRange(startDate, endDate);

    function createEmpBucket(p) {
      const nipStr = String(p.nip || '').trim();
      const bio = resolveBiometricMeta(p);
      return {
        nip: nipStr,
        nama_lengkap: bio.displayName,
        unit_kerja: p.unit_kerja || 'FHISIP',
        pin: bio.pin,
        group: bio.group,
        subGroup: bio.subGroup,
        order: bio.order,
        tugasBelajar: bio.tugasBelajarDefault,
        normalDays: workingDaysNormal,
        hadirDates: new Set(),
        terlambat: 0,
        pulangCepat: 0,
        lembur: 0,
        tanpaKeteranganExplicit: 0,
        dinasLuarExplicit: 0,
        sakit: 0,
        cuti: 0,
        izin: 0,
        hasAnyRecord: false,
        specialNotes: [],
        adminNotes: []
      };
    }

    const empMap = new Map();
    for (const p of pegawaiList) {
      if (!p || !p.nip) continue;
      const nipKey = String(p.nip).trim();
      empMap.set(nipKey, createEmpBucket(p));
    }

    // Agregasi catatan presensi live dari Dashboard
    for (const r of records) {
      if (!r || !r.nip) continue;
      const nipKey = canonicalizeNip(r.nip);
      if (!nipKey) continue;

      if (!empMap.has(nipKey)) {
        empMap.set(nipKey, createEmpBucket({
          nip: nipKey,
          nama_lengkap: r.nama_lengkap,
          unit_kerja: r.unit_kerja
        }));
      }

      const agg = empMap.get(nipKey);
      agg.hasAnyRecord = true;
      const effStatus = r.status_kehadiran || 'Hadir';
      const ymd = (r.tanggal || '').slice(0, 10);

      if (r.isLembur || effStatus === 'Lembur') {
        agg.lembur++;
      } else if (effStatus === 'Hadir') {
        agg.hadirDates.add(ymd);
        if (r.isTerlambat) agg.terlambat++;
        if (r.isPulangCepat) agg.pulangCepat++;
      } else if (effStatus === 'Cuti') {
        agg.cuti++;
      } else if (effStatus === 'Sakit') {
        agg.sakit++;
      } else if (effStatus === 'Izin') {
        agg.izin++;
      } else if (effStatus === 'Tugas Belajar') {
        agg.tugasBelajar = true;
      } else if (effStatus === 'Dinas Luar') {
        agg.dinasLuarExplicit++;
      } else if (effStatus === 'Alpha') {
        agg.tanpaKeteranganExplicit++;
      }

      if (r.keterangan && isMeaningfulSpecialNote(r.keterangan)) {
        const cleanNote = String(r.keterangan).trim();
        if (/^(form belum|blm mengajukan|belum mengajukan)/i.test(cleanNote)) {
          agg.adminNotes.push(cleanNote.toUpperCase());
        } else {
          agg.specialNotes.push(cleanNote);
        }
      }
    }

    // Filter pegawai yang aktif pada data laporan (serta pegawai Tugas Belajar jika laporan bulanan penuh)
    const includeTugasBelajar = !options.onlyMatchedEmployees;
    let activeEmps = Array.from(empMap.values()).filter(
      e => e.hasAnyRecord || (includeTugasBelajar && e.tugasBelajar && records.length > 0)
    );

    if (activeEmps.length === 0 && !options.onlyMatchedEmployees) {
      activeEmps = Array.from(empMap.values());
    }

    // Finalisasi perhitungan Normal, Riil, Absen, D.Luar, Cuti, Sakit, Ijin per pegawai
    for (const emp of activeEmps) {
      const riilDays = Math.min(emp.normalDays, emp.hadirDates.size);
      const absenDays = Math.max(0, emp.normalDays - riilDays);

      emp.riilDays = riilDays;
      emp.absenDays = absenDays;

      if (emp.tugasBelajar && riilDays === 0) {
        emp.tanpaKeterangan = 0;
        emp.dinasLuar = 0;
        emp.sakit = 0;
        emp.cuti = 0;
        emp.izin = 0;
        if (!emp.specialNotes.includes('Tugas Belajar')) {
          emp.specialNotes.unshift('Tugas Belajar');
        }
      } else {
        // Pastikan komponen ketidakhadiran (S + T + Z + AA + AC) = M (Absen) secara presisi seperti contoh resmi
        let remAbsen = absenDays;
        const useSakit = Math.min(remAbsen, emp.sakit);
        remAbsen -= useSakit;
        const useCuti = Math.min(remAbsen, emp.cuti);
        remAbsen -= useCuti;
        const useIzin = Math.min(remAbsen, emp.izin);
        remAbsen -= useIzin;
        const useAlpha = Math.min(remAbsen, emp.tanpaKeteranganExplicit);
        remAbsen -= useAlpha;

        // Sisa hari kerja tanpa scan masuk/cuti/sakit/izin tercatat sebagai D.Luar (T), persis standar contoh biometrik UT
        emp.sakit = useSakit;
        emp.cuti = useCuti;
        emp.izin = useIzin;
        emp.tanpaKeterangan = useAlpha;
        emp.dinasLuar = remAbsen;
      }
    }

    // Susun blok seksi (Run-Length Grouping sesuai urutan No. ID Biometrik atau Per Prodi)
    const sectionBlocks = [];
    if (groupBy === 'kategori') {
      activeEmps.sort((a, b) =>
        (a.order - b.order) ||
        (Number(a.pin) || 99999) - (Number(b.pin) || 99999) ||
        a.nama_lengkap.localeCompare(b.nama_lengkap, 'id')
      );

      for (const emp of activeEmps) {
        const secName = emp.group || 'DOSEN';
        const lastBlock = sectionBlocks[sectionBlocks.length - 1];
        if (!lastBlock || lastBlock.title !== secName) {
          sectionBlocks.push({
            title: secName,
            subTitle: emp.subGroup || '',
            emps: [emp]
          });
        } else {
          if (!lastBlock.subTitle && emp.subGroup && lastBlock.emps.length === 0) {
            lastBlock.subTitle = emp.subGroup;
          }
          lastBlock.emps.push(emp);
        }
      }
    } else {
      activeEmps.sort((a, b) =>
        (a.unit_kerja || '').localeCompare(b.unit_kerja || '', 'id') ||
        (a.order - b.order)
      );
      const byUnit = new Map();
      for (const emp of activeEmps) {
        const u = emp.unit_kerja || 'Dekanat FHISIP';
        if (!byUnit.has(u)) byUnit.set(u, []);
        byUnit.get(u).push(emp);
      }
      for (const [u, list] of byUnit.entries()) {
        sectionBlocks.push({ title: u.toUpperCase(), subTitle: '', emps: list });
      }
    }

    // Bangun Worksheet 'Rekap ' (38 Kolom A..AL)
    const wb = window.XLSX.utils.book_new();
    const ws = {};
    const merges = [];

    const setCell = (cellRef, val, type = 's', formula = null) => {
      const cell = { v: val, t: type };
      if (formula) cell.f = formula;
      ws[cellRef] = cell;
    };

    // 1. Kop Laporan (Baris 1 - 3, Baris 4 - 9 kosong persis contoh)
    setCell('A1', 'Laporan Rekapitulasi');
    merges.push({ s: { r: 0, c: 0 }, e: { r: 2, c: 15 } }); // A1:P3

    setCell('Q2', headerSubtitle);
    merges.push({ s: { r: 1, c: 16 }, e: { r: 2, c: 20 } }); // Q2:U3

    setCell('AB3', periodeStr);
    merges.push({ s: { r: 2, c: 27 }, e: { r: 7, c: 33 } }); // AB3:AH8

    // 2. Judul Kolom Tabel (Baris 10 & Baris 11 — 100% identik dengan contoh Excel)
    setCell('B10', 'Nama');
    merges.push({ s: { r: 9, c: 1 }, e: { r: 10, c: 4 } }); // B10:E11

    setCell('F10', 'No. ID');
    merges.push({ s: { r: 9, c: 5 }, e: { r: 10, c: 9 } }); // F10:J11

    setCell('K10', 'Normal');
    setCell('L10', 'Riil');
    setCell('M10', 'Absen');
    setCell('M11', 'Hari');

    setCell('O10', 'Trlmbt');
    setCell('P10', 'Plg. Cpt');
    setCell('R10', 'Lmbr');
    setCell('S10', 'Tanpa Keterangan');
    setCell('T10', 'D.Luar');
    setCell('W10', 'N/In');
    setCell('X10', 'N/Out');
    setCell('Y10', 'Scan');
    setCell('Z10', 'Sakit');
    setCell('AA10', 'Cuti');
    setCell('AC10', 'Ijin');
    setCell('AG10', 'Jam Kerja');
    setCell('AG11', 'Jam');
    setCell('AH10', 'Rata-2\n%');
    merges.push({ s: { r: 9, c: 33 }, e: { r: 10, c: 34 } }); // AH10:AI11

    // 3. Baris Seksi, Pegawai, & Subtotal per Seksi
    let currentRow = 12;
    const groupSubtotalRows = [];

    for (const block of sectionBlocks) {
      if (!block.emps || block.emps.length === 0) continue;

      // Baris Judul Seksi (ADMINISTRASI / DOSEN / FHISIP)
      setCell(`B${currentRow}`, block.title);
      merges.push({ s: { r: currentRow - 1, c: 1 }, e: { r: currentRow - 1, c: 34 } });
      currentRow++;

      // Sub-judul opsional (mis. PTNPNS di bawah DOSEN)
      if (block.subTitle) {
        setCell(`B${currentRow}`, block.subTitle);
        merges.push({ s: { r: currentRow - 1, c: 1 }, e: { r: currentRow - 1, c: 34 } });
        currentRow++;
      }

      const startEmpRow = currentRow;

      for (const emp of block.emps) {
        const r = currentRow;

        // Kolom B: Nama Lengkap
        setCell(`B${r}`, emp.nama_lengkap);
        merges.push({ s: { r: r - 1, c: 1 }, e: { r: r - 1, c: 5 } }); // B:F

        // Kolom G: No. ID Biometrik
        if (emp.pin !== '' && emp.pin != null) {
          setCell(`G${r}`, emp.pin, typeof emp.pin === 'number' ? 'n' : 's');
          merges.push({ s: { r: r - 1, c: 6 }, e: { r: r - 1, c: 9 } }); // G:J
        }

        // Kolom K: Normal Hari Kerja
        setCell(`K${r}`, emp.normalDays, 'n');

        // Kolom L: Riil Kehadiran (=K-M)
        setCell(`L${r}`, emp.riilDays, 'n', `K${r}-M${r}`);

        // Kolom M: Absen Hari (selalu ditulis termasuk 0, persis contoh Excel)
        const absenFormula = (emp.tugasBelajar && emp.riilDays === 0)
          ? null
          : `S${r}+T${r}+Z${r}+AA${r}+AC${r}`;
        setCell(`M${r}`, emp.absenDays, 'n', absenFormula);
        merges.push({ s: { r: r - 1, c: 12 }, e: { r: r - 1, c: 13 } }); // M:N

        // Kolom O: Trlmbt (hanya jika > 0)
        if (emp.terlambat > 0) setCell(`O${r}`, emp.terlambat, 'n');

        // Kolom P: Plg. Cpt (hanya jika > 0)
        if (emp.pulangCepat > 0) {
          setCell(`P${r}`, emp.pulangCepat, 'n');
          merges.push({ s: { r: r - 1, c: 15 }, e: { r: r - 1, c: 16 } }); // P:Q
        }

        // Kolom R: Lmbr — Sabtu/Minggu Tanpa Jam (hanya jika > 0)
        if (emp.lembur > 0) setCell(`R${r}`, emp.lembur, 'n');

        // Kolom S: Tanpa Keterangan (hanya jika > 0)
        if (emp.tanpaKeterangan > 0) setCell(`S${r}`, emp.tanpaKeterangan, 'n');

        // Kolom T: D.Luar (hanya jika > 0)
        if (emp.dinasLuar > 0) {
          setCell(`T${r}`, emp.dinasLuar, 'n');
          merges.push({ s: { r: r - 1, c: 19 }, e: { r: r - 1, c: 21 } }); // T:V
        }

        // Kolom Z: Sakit (hanya jika > 0)
        if (emp.sakit > 0) setCell(`Z${r}`, emp.sakit, 'n');

        // Kolom AA: Cuti (hanya jika > 0)
        if (emp.cuti > 0) {
          setCell(`AA${r}`, emp.cuti, 'n');
          merges.push({ s: { r: r - 1, c: 26 }, e: { r: r - 1, c: 27 } }); // AA:AB
        }

        // Kolom AC: Ijin (hanya jika > 0)
        if (emp.izin > 0) setCell(`AC${r}`, emp.izin, 'n');

        // Kolom AD: Total Kehadiran (=K-M)
        setCell(`AD${r}`, emp.riilDays, 'n', `K${r}-M${r}`);
        merges.push({ s: { r: r - 1, c: 29 }, e: { r: r - 1, c: 30 } }); // AD:AE

        // Kolom AF: Keterangan khusus (mis. Tugas Belajar, Cuti alasan penting, dll.)
        const uniqSpecial = [...new Set(emp.specialNotes)].filter(Boolean);
        if (uniqSpecial.length > 0) {
          setCell(`AF${r}`, uniqSpecial.join(', '));
        }

        // Kolom AK: Faktor Pegawai (1)
        setCell(`AK${r}`, 1, 'n');

        // Kolom AL: Catatan form administrasi jika ada (mis. FORM BELUM)
        const uniqAdmin = [...new Set(emp.adminNotes)].filter(Boolean);
        if (uniqAdmin.length > 0) {
          setCell(`AL${r}`, uniqAdmin.join(', '));
        }

        currentRow++;
      }

      const endEmpRow = currentRow - 1;

      // Baris Subtotal Seksi: hanya kolom B ("Total: N"), K, L, dan AD — persis contoh Excel!
      const subRow = currentRow;
      groupSubtotalRows.push(subRow);

      setCell(`B${subRow}`, `Total: ${block.emps.length}`);
      merges.push({ s: { r: subRow - 1, c: 1 }, e: { r: subRow - 1, c: 9 } }); // B:J

      const sumK = block.emps.reduce((acc, e) => acc + e.normalDays, 0);
      const sumL = block.emps.reduce((acc, e) => acc + e.riilDays, 0);

      setCell(`K${subRow}`, sumK, 'n', `SUM(K${startEmpRow}:K${endEmpRow})`);
      setCell(`L${subRow}`, sumL, 'n', `SUM(L${startEmpRow}:L${endEmpRow})`);
      setCell(`AD${subRow}`, sumL, 'n', `SUM(AD${startEmpRow}:AD${endEmpRow})`);
      merges.push({ s: { r: subRow - 1, c: 29 }, e: { r: subRow - 1, c: 30 } }); // AD:AE

      currentRow++;
    }

    // 4. Baris Grand Total: hanya kolom B ("Grand Total: N"), K, L, AD, dan AK — persis contoh Excel!
    const grandRow = currentRow;
    setCell(`B${grandRow}`, `Grand Total: ${activeEmps.length}`);
    merges.push({ s: { r: grandRow - 1, c: 1 }, e: { r: grandRow - 1, c: 9 } }); // B:J

    if (groupSubtotalRows.length > 0) {
      const sumSubFormula = (col) => `SUM(${groupSubtotalRows.map(r => `${col}${r}`).join(',')})`;
      const totalNormalAll = activeEmps.reduce((acc, e) => acc + e.normalDays, 0);
      const totalRiilAll = activeEmps.reduce((acc, e) => acc + e.riilDays, 0);

      setCell(`K${grandRow}`, totalNormalAll, 'n', sumSubFormula('K'));
      setCell(`L${grandRow}`, totalRiilAll, 'n', sumSubFormula('L'));
      setCell(`AD${grandRow}`, totalRiilAll, 'n', sumSubFormula('AD'));
      merges.push({ s: { r: grandRow - 1, c: 29 }, e: { r: grandRow - 1, c: 30 } }); // AD:AE
      setCell(`AK${grandRow}`, activeEmps.length, 'n', `SUM(AK13:AK${grandRow - 1})`);
    }

    // 5. Blok Footer Supervisor & Tanda Tangan Dekan FHISIP-UT (Spasi baris & format DD/MM/YYYY persis contoh)
    const sigStartRow = grandRow + 3;
    setCell(`C${sigStartRow}`, 'Oleh:');
    setCell(`E${sigStartRow}`, 'Supervisor');
    merges.push({ s: { r: sigStartRow - 1, c: 4 }, e: { r: sigStartRow, c: 7 } }); // E:H

    const printDateSlash = formatYmdToDmySlash(endDate);
    setCell(`J${sigStartRow}`, printDateSlash);
    merges.push({ s: { r: sigStartRow - 1, c: 9 }, e: { r: sigStartRow - 1, c: 12 } }); // J:M

    const totalPagesEst = Math.max(1, Math.ceil((grandRow - 11) / 20));
    setCell(`AE${sigStartRow}`, `Hal. ${totalPagesEst}`);
    merges.push({ s: { r: sigStartRow - 1, c: 30 }, e: { r: sigStartRow, c: 33 } }); // AE:AH

    const signatureDate = options.signatureDate || endDate;
    const dateDekanStr = `Tangerang Selatan, ${formatTanggalIndo(signatureDate)}`;
    setCell(`Z${sigStartRow + 3}`, dateDekanStr);
    setCell(`Z${sigStartRow + 4}`, 'Dekan FHISIP-UT,');

    setCell(`Z${sigStartRow + 9}`, 'Dr. Meita Istianda, S.IP., M.Si.');
    setCell(`Z${sigStartRow + 10}`, 'NIP 196705191987012001');

    // Batas Range A1:AL[baris NIP Dekan] (38 Kolom A..AL)
    const lastRowNum = sigStartRow + 10;
    ws['!ref'] = `A1:AL${lastRowNum}`;
    ws['!merges'] = merges;

    ws['!cols'] = [
      { wch: 2 },  // A
      { wch: 8 },  // B
      { wch: 10 }, // C
      { wch: 8 },  // D
      { wch: 12 }, // E
      { wch: 4 },  // F
      { wch: 5 },  // G (No. ID)
      { wch: 5 },  // H
      { wch: 4 },  // I
      { wch: 2 },  // J
      { wch: 8 },  // K (Normal)
      { wch: 8 },  // L (Riil)
      { wch: 6 },  // M (Absen)
      { wch: 4 },  // N
      { wch: 8 },  // O (Trlmbt)
      { wch: 6 },  // P (Plg. Cpt)
      { wch: 4 },  // Q
      { wch: 6 },  // R (Lmbr)
      { wch: 16 }, // S (Tanpa Keterangan)
      { wch: 6 },  // T (D.Luar)
      { wch: 4 },  // U
      { wch: 4 },  // V
      { wch: 6 },  // W (N/In)
      { wch: 6 },  // X (N/Out)
      { wch: 6 },  // Y (Scan)
      { wch: 6 },  // Z (Sakit)
      { wch: 6 },  // AA (Cuti)
      { wch: 4 },  // AB
      { wch: 6 },  // AC (Ijin)
      { wch: 8 },  // AD (Total Kehadiran)
      { wch: 4 },  // AE
      { wch: 26 }, // AF (Keterangan)
      { wch: 10 }, // AG (Jam Kerja)
      { wch: 8 },  // AH (Rata-2 %)
      { wch: 4 },  // AI
      { wch: 2 },  // AJ
      { wch: 6 },  // AK (Faktor)
      { wch: 16 }  // AL (Catatan Form)
    ];

    window.XLSX.utils.book_append_sheet(wb, ws, 'Rekap ');

    return {
      wb,
      recordCount: records.length,
      employeeCount: activeEmps.length,
      sectionCount: sectionBlocks.length,
      startDate,
      endDate
    };
  }

  /**
   * Membangun Workbook Laporan Rekapitulasi Bulanan Resmi dari data live Dashboard
   */
  function buildMonthlyWorkbook(options = {}) {
    const year = Number(options.year) || 2026;
    const month = Number(options.month) || 10;
    const monthStr = String(month).padStart(2, '0');
    const ymPrefix = `${year}-${monthStr}`;
    const namaBulan = MONTH_NAMES[month - 1];

    const evaluatedAll = (window.app && typeof window.app.getEvaluatedRecords === 'function')
      ? window.app.getEvaluatedRecords()
      : [];

    const monthRecords = evaluatedAll.filter(r => r.tanggal && r.tanggal.startsWith(ymPrefix));

    return buildRecapWorkbookFromRecords(monthRecords, {
      ...options,
      year,
      month,
      headerSubtitle: `(FHISIP ${namaBulan} ${year})`
    });
  }

  /**
   * Memicu unduhan berkas di browser
   */
  function triggerDownload(href, filename) {
    try {
      const a = document.createElement('a');
      a.href = href;
      a.setAttribute('download', filename);
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (a && a.parentNode) a.parentNode.removeChild(a);
      }, 1500);
    } catch (err) {
      window.location.assign(href);
    }
  }

  /**
   * Ekspor Laporan Rekapitulasi Bulanan Resmi (.xlsx) sesuai contoh format standar UT
   */
  function exportMonthlyExcel(options = {}) {
    const month = Number(options.month) || 10;
    const year = Number(options.year) || 2026;
    const groupBy = options.groupBy || 'kategori';
    const namaBulan = MONTH_NAMES[month - 1];
    const modeSuffix = groupBy === 'prodi' ? '_Per_Prodi' : '_Resmi';
    const filename = `Rekapitulasi_Kehadiran_FHISIP_${namaBulan}_${year}${modeSuffix}.xlsx`;

    try {
      const built = buildMonthlyWorkbook({ ...options, year, month, groupBy });
      if (!built || !built.wb) return;

      const wbout = window.XLSX.write(built.wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, filename);
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      if (window.app && window.app.showToast) {
        window.app.showToast(
          `Laporan Rekapitulasi ${namaBulan} ${year} (${built.employeeCount} pegawai • ${built.recordCount.toLocaleString('id-ID')} data live) berhasil diunduh!`,
          'success'
        );
      }
    } catch (e) {
      console.error('Gagal menulis berkas XLSX:', e);
      alert('Gagal menghasilkan berkas Excel: ' + e.message);
    }
  }

  /**
   * Ekspor Hasil Filter Saat Ini di Dashboard menjadi format "Laporan Rekapitulasi" (.xlsx)
   */
  function exportFilteredRecapExcel() {
    const menuExport = document.getElementById('menu-export');
    if (menuExport && typeof menuExport.hidePopover === 'function') {
      try { menuExport.hidePopover(); } catch (_) {}
    }

    const filtered = (window.app && typeof window.app.getFilteredRecords === 'function')
      ? window.app.getFilteredRecords()
      : [];

    if (filtered.length === 0) {
      if (window.app && window.app.showToast) {
        window.app.showToast('Tidak ada data presensi pada filter saat ini untuk diolah ke Excel.', 'warning');
      }
      return;
    }

    const filterState = (window.app && window.app.getActiveFilterState) ? window.app.getActiveFilterState() : {};
    let subtitle = '(FHISIP Hasil Filter)';
    if (filterState.bulan) {
      const [y, m] = filterState.bulan.split('-').map(Number);
      if (y && m) subtitle = `(FHISIP ${MONTH_NAMES[m - 1]} ${y})`;
    }

    const built = buildRecapWorkbookFromRecords(filtered, {
      groupBy: filterState.unit ? 'prodi' : 'kategori',
      headerSubtitle: subtitle,
      onlyMatchedEmployees: true
    });
    if (!built || !built.wb) return;

    const wbout = window.XLSX.write(built.wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const todayStr = new Date().toISOString().slice(0, 10);
    const filename = `Laporan_Rekapitulasi_Terolah_FHISIP_${todayStr}.xlsx`;

    triggerDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 4000);

    if (window.app && window.app.showToast) {
      window.app.showToast(
        `Laporan Rekapitulasi Terolah (${built.employeeCount} pegawai • ${built.recordCount.toLocaleString('id-ID')} data) berhasil diunduh!`,
        'success'
      );
    }
  }

  /**
   * Ekspor Database Presensi Live (.xlsx):
   * Sheet 1 ('Rekap ') dalam format Laporan Rekapitulasi Terolah + Sheet 2 ('Log Presensi Live')
   */
  function exportLiveDatabaseXlsx(ymFilter = '') {
    if (!window.XLSX) {
      alert('Pustaka SheetJS (XLSX) belum siap dimuat.');
      return;
    }

    const pegawaiList = (window.app && typeof window.app.getPegawaiList === 'function')
      ? window.app.getPegawaiList()
      : [];
    const empByNip = new Map(pegawaiList.map(p => [String(p.nip).trim(), p]));

    let evaluated = (window.app && typeof window.app.getEvaluatedRecords === 'function')
      ? window.app.getEvaluatedRecords()
      : [];

    if (ymFilter) {
      evaluated = evaluated.filter(r => r.tanggal && r.tanggal.startsWith(ymFilter));
    }

    let subtitle = '(FHISIP Semua Periode)';
    let labelFile = 'Semua_Periode';
    if (ymFilter) {
      const [y, m] = ymFilter.split('-').map(Number);
      if (y && m) {
        subtitle = `(FHISIP ${MONTH_NAMES[m - 1]} ${y})`;
        labelFile = `${MONTH_NAMES[m - 1]}_${y}`;
      }
    }

    // Sheet 1: Format Laporan Rekapitulasi Terolah (persis contoh resmi)
    const built = buildRecapWorkbookFromRecords(evaluated, {
      groupBy: 'kategori',
      headerSubtitle: subtitle
    });
    if (!built || !built.wb) return;
    const wb = built.wb;

    // Sheet 2: Log Harian Lengkap agar data mentah tetap tersedia bila dibutuhkan
    const logRows = evaluated
      .slice()
      .sort((a, b) =>
        (b.tanggal || '').localeCompare(a.tanggal || '') ||
        (a.nama_lengkap || '').localeCompare(b.nama_lengkap || '', 'id')
      )
      .map((r, i) => {
        const emp = empByNip.get(String(r.nip || '').trim()) || {};
        const bio = resolveBiometricMeta({ ...emp, ...r });
        return {
          'No': i + 1,
          'Tanggal': r.tanggal,
          'Hari': getDayNameFromYmd(r.tanggal),
          'No. ID': bio.pin,
          'NIP': String(r.nip || ''),
          'Nama Lengkap': bio.displayName,
          'Seksi Biometrik': bio.group,
          'Program Studi / Unit Kerja': r.unit_kerja || emp.unit_kerja || '-',
          'Jam Masuk': r.isNonTimed ? '-' : (r.jam_masuk || '-'),
          'Jam Pulang': r.isNonTimed ? '-' : (r.jam_pulang || '-'),
          'Status Kehadiran': r.status_kehadiran || 'Hadir',
          'Evaluasi Disiplin': r.statusLabel || '-',
          'Terlambat (Menit)': r.isNonTimed ? 0 : (r.menitTerlambat || 0),
          'Pulang Cepat (Menit)': r.isNonTimed ? 0 : (r.menitPulangCepat || 0),
          'Keterangan': r.keterangan || ''
        };
      });

    if (logRows.length > 0) {
      const wsLog = window.XLSX.utils.json_to_sheet(logRows);
      wsLog['!cols'] = [
        { wch: 6 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 20 }, { wch: 28 },
        { wch: 15 }, { wch: 34 }, { wch: 11 }, { wch: 11 }, { wch: 16 }, { wch: 22 },
        { wch: 16 }, { wch: 18 }, { wch: 28 }
      ];
      window.XLSX.utils.book_append_sheet(wb, wsLog, 'Log Presensi Live');
    }

    const wbout = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);

    const todayStr = new Date().toISOString().slice(0, 10);
    const filename = `Rekap_dan_Database_Live_FHISIP_${labelFile}_${todayStr}.xlsx`;

    triggerDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 4000);

    if (window.app && window.app.showToast) {
      window.app.showToast(`Rekapitulasi & Database Excel Live (${logRows.length.toLocaleString('id-ID')} data) berhasil diunduh!`, 'success');
    }
  }

  /**
   * Buka Modal Dialog Pilihan Laporan Bulanan & Sinkronkan Angka Live
   */
  function openExportModal() {
    const menuExport = document.getElementById('menu-export');
    if (menuExport && typeof menuExport.hidePopover === 'function') {
      try { menuExport.hidePopover(); } catch (_) {}
    }
    refreshExportModalUI({ preferActiveFilter: true, updateSignatureDate: true });
    const modal = document.getElementById('modal-export-monthly');
    if (modal) {
      modal.classList.add('active');
    } else if (window.app && window.app.openModal) {
      window.app.openModal('modal-export-monthly');
    }
  }

  /**
   * Ekspor Laporan Rekapitulasi Bulanan dalam format CSV identik struktur contoh
   */
  function exportMonthlyCsv(options = {}) {
    const month = Number(options.month) || 10;
    const year = Number(options.year) || 2026;
    const groupBy = options.groupBy || 'kategori';
    const namaBulan = MONTH_NAMES[month - 1];
    const modeSuffix = groupBy === 'prodi' ? '_Per_Prodi' : '_Resmi';
    const filename = `Rekapitulasi_Kehadiran_FHISIP_${namaBulan}_${year}${modeSuffix}.csv`;

    const built = buildMonthlyWorkbook({ ...options, year, month, groupBy });
    if (!built || !built.wb) return;
    const ws = built.wb.Sheets['Rekap '];
    const csv = '\uFEFF' + window.XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 4000);

    if (window.app && window.app.showToast) {
      window.app.showToast(`CSV Rekapitulasi ${namaBulan} ${year} (${built.employeeCount} pegawai) berhasil diunduh!`, 'success');
    }
  }

  window.monthlyReportGenerator = {
    buildRecapWorkbookFromRecords,
    buildMonthlyWorkbook,
    exportMonthlyExcel,
    exportMonthlyCsv,
    exportFilteredRecapExcel,
    exportLiveDatabaseXlsx,
    refreshExportModalUI,
    updateSelectedMonthPreview,
    getAvailableMonthsSummary,
    openExportModal
  };

})();
