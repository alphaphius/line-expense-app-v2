# Google → NAS migration runbook

การย้ายใช้แนวทาง copy-only: อ่านข้อมูลจาก Google และเขียนลง WorkHub NAS โดยไม่แก้ไขหรือลบต้นทาง

## ลำดับที่ปลอดภัย

1. Deploy WorkHub NAS ด้วยฐานข้อมูลว่าง
2. สำรอง Google Sheet/Drive และ MariaDB
3. Export manifest จาก Google: master data, bills, bill items, document metadata และไฟล์ต้นฉบับ
4. Import เข้า MariaDB ด้วย ID เดิมเพื่อรักษาความสัมพันธ์
5. เปรียบเทียบจำนวน record และยอดรวมรายเดือน
6. สุ่มเปิดรูปบิลและ Export Excel/DOCX อย่างน้อย 10 รายการ
7. เปิดใช้งาน NAS แบบคู่ขนาน และหยุดเขียนระบบ Google เมื่อยืนยัน cutover
8. เก็บ Google เป็น read-only rollback อย่างน้อย 30 วัน

## คำสั่ง Export และ Import

Export จาก Google แบบอ่านอย่างเดียว (ไม่แก้ไขข้อมูลต้นทาง):

```bash
SOURCE_API_URL="https://script.google.com/macros/s/DEPLOYMENT_ID/exec" npm run migration:export-google
```

นำ `migration-data/google-export.json` ไปวางที่ `/volume1/docker/workhub/migration/google-export.json` บน NAS แล้วสั่ง Import ใน Container Manager terminal:

```bash
docker compose -f compose.synology.yaml exec workhub \
  env MIGRATION_FILE=/migration/google-export.json npm run migration:import-nas
```

คำสั่ง Import รันซ้ำได้โดยข้ามบิลที่มี `bill_id` เดิม และเก็บ Google ไว้เป็นต้นทางสำรอง

## Validation ที่ต้องผ่าน

```sql
SELECT COUNT(*) AS bills, ROUND(SUM(grand_total), 2) AS total
FROM bills WHERE status <> 'REJECTED';

SELECT DATE_FORMAT(COALESCE(document_date, created_at), '%Y-%m') AS period,
       COUNT(*) AS bills,
       ROUND(SUM(grand_total), 2) AS total
FROM bills
WHERE status <> 'REJECTED'
GROUP BY period
ORDER BY period;

SELECT COUNT(*) AS missing_files
FROM bill_documents
WHERE file_path = '';

SELECT national_id, COUNT(*) AS duplicates
FROM workers
GROUP BY national_id
HAVING COUNT(*) > 1;
```

ห้าม cutover หากจำนวนบิล ยอดรวมรายเดือน จำนวนรูป หรือ checksum ไฟล์ไม่ตรงกับ manifest ต้นทาง
