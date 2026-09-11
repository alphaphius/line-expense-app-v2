# WorkHub

เว็บแอปสำหรับจัดการค่าใช้จ่าย เอกสารใบรับเงิน สรุปค่าแรง และ Task Manager โดยรุ่นนี้ Deploy บน Synology NAS ใช้ MariaDB 10 และพื้นที่ไฟล์ของ NAS แทน Google Sheets/Drive

## สถานะระบบ

- ค่าใช้จ่ายและบิล: พร้อมใช้งานบนเว็บ ไม่ถามรหัส และใช้ Gemini เฉพาะ OCR บิล
- เอกสารใบรับเงิน: ใช้ Gemini API key แยกจากส่วนบิล รองรับ OCR บัตรไทยแบบหลายรูปต่อคำขอ, เก็บรูปบน NAS ก่อนวิเคราะห์, กลับมาทำต่อเมื่อติด traffic, Quick Edit, ป้องกันข้อมูลซ้ำ และแยกปุ่ม Export DOCX/Excel
- สรุปค่าแรงและ Task Manager: มีพื้นที่โมดูลและโครงข้อมูลสำหรับพัฒนาต่อ โดยต้องผ่านรหัสส่วนงานภายใน
- LINE OA: Backend บน NAS รองรับแชตส่วนตัว/กลุ่ม รูปหลายหน้า ค่าลัด การเลือกโครงการ/บริษัท ยืนยัน/ยกเลิก และป้องกัน Webhook ซ้ำ; LIFF ยังไม่จำเป็นต่อ Flow รับบิล
- Google Apps Script, Sheet และ Drive เดิม: เก็บไว้เป็นระบบสำรอง ไม่ถูกลบหรือเขียนทับ

## สถาปัตยกรรม NAS

- Fastify ให้บริการหน้า PWA และ JSON API จาก Container เดียว
- MariaDB เก็บข้อมูลธุรกิจแบบ relational พร้อม index และ transaction
- ไฟล์ถาวรอยู่ที่ `/volume1/docker/workhub/data`
- รูปถูกย่อและบีบอัดก่อนเก็บ เพื่อลดพื้นที่และขนาด DOCX
- Technical session เปิดอัตโนมัติสำหรับส่วนบิล ส่วนงานภายในใช้ protected session พร้อม rate limit
- Mutation สำคัญมี request ID/idempotency ป้องกันการกดหรือส่งซ้ำ
- รองรับ Desktop และ Smartphone พร้อม offline application shell โดยไม่ cache ข้อมูล API

## เริ่มในเครื่อง

ต้องมี Node.js 20+ และ Docker Desktop

```bash
npm ci
npm run verify
docker compose up --build -d --wait
npm run smoke:nas
```

เปิด `http://127.0.0.1:18080/`

## Deploy บน Synology

อ่านขั้นตอนที่ [NAS_DEPLOYMENT.md](./NAS_DEPLOYMENT.md) และขั้นตอนคัดลอกข้อมูล Google ที่ [NAS_MIGRATION.md](./NAS_MIGRATION.md)

ไฟล์หลัก:

- `compose.synology.yaml` — Project สำหรับ Synology Container Manager
- `.env.nas.example` — ตัวอย่าง Environment โดยไม่มี secret จริง
- `server/migrations/001_init.sql` — Schema MariaDB
- `server/migrations/002_line_messaging.sql` — Event deduplication และรูปชั่วคราวจาก LINE
- `server/migrations/004_receipt_ai_ocr.sql` — สถานะคิวและประวัติ Gemini OCR สำหรับเอกสารใบรับเงิน
- `scripts/export-google-migration.mjs` — Export Google แบบอ่านอย่างเดียว
- `server/scripts/import-google-migration.mjs` — Import เข้า NAS แบบรันซ้ำได้

## คำสั่งตรวจสอบ

```bash
npm test
npm run build
npm run verify
npm run smoke:nas
npm audit --omit=dev
```

## Repository และระบบเดิม

- [GitHub repository](https://github.com/alphaphius/line-expense-app-v2)
- [Google Pages รุ่นเดิม](https://alphaphius.github.io/line-expense-app-v2/)

Branch NAS ใช้ชื่อผลิตภัณฑ์ `WorkHub` ส่วน production เดิมบน branch `main` คงไว้เป็น rollback จนกว่าจะตรวจการย้ายข้อมูลและการใช้งานจริงผ่านครบทุกข้อ
