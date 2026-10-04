/* ============================================================
   LaoBooks ERP – Configuration
   ------------------------------------------------------------
   ຖ້າຢາກເກັບຂໍ້ມູນໃນ Google Sheet:
   1) ເປີດ README.md → ເຮັດຕາມຂັ້ນຕອນ deploy Apps Script
   2) ເອົາ URL ຂອງ Web App ມາໃສ່ APPS_SCRIPT_URL ຂ້າງລຸ່ມ
   ຖ້າປະໄວ້ວ່າງ ("") → ໂປແກມຈະໃຊ້ Demo Mode (ເກັບໃນ browser)
   ============================================================ */
window.ERP_CONFIG = {
  // ⬇️ ວາງ URL Web App ຂອງ Google Apps Script ທີ່ນີ້
  APPS_SCRIPT_URL: "",

  COMPANY: {
    name: "ບໍລິສັດ ຕົວຢ່າງ ຈຳກັດ",
    tin: "1234567890",
    currency: "LAK",
    vat_rate: 10,
    fiscal_year_start: "01-01"
  },

  // ຕັ້ງຄ່າ demo ຂໍ້ມູນຕົວຢ່າງເມື່ອເປີດຄັ້ງທຳອິດ (Demo Mode)
  SEED_DEMO_DATA: true
};


