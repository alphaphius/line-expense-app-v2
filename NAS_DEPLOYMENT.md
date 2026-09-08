# WorkHub on Synology NAS

ระบบนี้รันหน้าเว็บ, API และ LINE webhook ใน Container เดียว ใช้ MariaDB 10 ของ Synology และเก็บไฟล์ถาวรใน Docker volume ชื่อ `workhub-data` บน NAS โดยไม่พึ่ง Google Drive หรือ Google Sheets

## 1. สำรองระบบเดิม

- อย่าลบ Google Sheet, Google Drive หรือ Apps Script เดิม
- ดาวน์โหลดสำเนา Sheet และโฟลเดอร์ Drive ก่อนย้ายข้อมูลจริง
- เปิด WorkHub บน NAS คู่ขนานจนตรวจยอดและจำนวนรายการตรงกันแล้วเท่านั้น

## 2. สร้างฐานข้อมูลผ่าน phpMyAdmin

เข้าสู่ phpMyAdmin ด้วยผู้ดูแล แล้วรัน SQL ต่อไปนี้ โดยเปลี่ยนรหัสผ่านให้เป็นค่าสุ่มยาวอย่างน้อย 24 ตัวอักษร

```sql
CREATE DATABASE IF NOT EXISTS workhub
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'workhub_app'@'%'
  IDENTIFIED BY 'CHANGE_TO_A_LONG_RANDOM_PASSWORD';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON workhub.* TO 'workhub_app'@'%';

FLUSH PRIVILEGES;
```

บัญชีแอปไม่มีสิทธิ์ `DROP DATABASE`, `GRANT OPTION` หรือสิทธิ์ผู้ดูแลเครื่อง

## 3. เตรียมไฟล์บน NAS

1. ติดตั้ง **Container Manager** จาก Package Center
2. สร้างโฟลเดอร์ `/volume1/docker/workhub/app` และ `/volume1/docker/workhub/migration` (Container Manager จะสร้าง volume `workhub-data` ให้อัตโนมัติ)
3. วาง source ทั้งหมดใน `/volume1/docker/workhub/app`
4. คัดลอก `.env.nas.example` เป็น `.env.nas`
5. ใส่ `DB_PASSWORD`, `GEMINI_API_KEY`, `WORKHUB_PASSWORD_HASH`, `PUBLIC_BASE_URL`, `LINE_CHANNEL_SECRET` และ `LINE_CHANNEL_ACCESS_TOKEN`

สร้าง password hash โดยรันในโฟลเดอร์โปรเจกต์:

```bash
npm run hash:password
```

นำผลลัพธ์ทั้งบรรทัดไปใส่ `WORKHUB_PASSWORD_HASH` ห้ามใส่รหัสจริงใน `.env.nas`

## 4. Deploy Container

ใน Container Manager เลือก **Project → Create → Create docker-compose.yml** แล้วเลือก `compose.synology.yaml` จากโฟลเดอร์แอป จากนั้น Build และ Start project ชื่อ `workhub`

ไฟล์ Compose ใช้ host network เพื่อให้ Container ต่อ MariaDB package ของ Synology ผ่าน `127.0.0.1` ได้โดยตรง ตั้ง memory/process limit ที่รองรับ DSM 7 และไม่ใช้ `cpus`/`NanoCPUs` เพราะ kernel ของ Synology บางรุ่นไม่ได้เปิด CPU CFS scheduler

ตรวจสอบภายใน LAN:

```text
http://192.168.1.200:8080/api/health
http://192.168.1.200:8080/
```

## 5. ตั้ง HTTPS Reverse Proxy

ใน DSM ไปที่ **Control Panel → Login Portal → Advanced → Reverse Proxy**

- Source: HTTPS, hostname เช่น `workhub.nasgfe1.synology.me`, port `443`
- Destination: HTTP, hostname `127.0.0.1`, port `8080`
- เปิด HTTP/2 และ WebSocket
- ผูก certificate ที่ตรงกับ hostname
- Forward header `X-Forwarded-Proto: https`

จากนั้นตั้ง LINE Developers Console ดังนี้:

- Webhook URL: `https://workhub.nasgfe1.synology.me/webhook/line`
- เปิด **Use webhook** และ **Allow bot to join group chats**
- กด Verify และต้องได้ HTTP 200

อย่าเปิด port `8080` หรือ `3306` ออกอินเทอร์เน็ตที่ router ระบบภายนอกควรเข้าเฉพาะ HTTPS 443 ผ่าน reverse proxy

## 6. สิ่งที่ต้องตรวจหลัง Deploy

- หน้าแรกแสดงชื่อ WorkHub และเปิดส่วนค่าใช้จ่ายได้โดยไม่ถามรหัส
- เอกสารใบรับเงิน/ค่าแรง/Task ขอรหัสส่วนภายใน
- เพิ่ม/แก้ไข/ลบบิลแบบกู้คืนได้
- OCR บิลใช้ Gemini; OCR บัตรประชาชนใช้ Tesseract ในอุปกรณ์และไม่ส่งรูปไป AI
- รูปบิลและบัตรถูกบีบอัดเป็น JPEG ก่อนเก็บ
- Template `.doc` และ `.docx` ผ่านการตรวจ Placeholder ครบ
- Export Excel และ DOCX เป็นคนละปุ่ม และดาวน์โหลดได้บน Desktop/Smartphone
- Restart container แล้วยังเห็นข้อมูลและไฟล์เดิม
- LINE OA รับรูปจากแชตส่วนตัวและกลุ่ม เลือกจำนวนหน้า/ค่าลัด แล้วส่งผลกลับห้องต้นทาง

## 7. Backup

ตั้ง Hyper Backup ให้สำรองทั้งสองส่วนพร้อมกัน:

- MariaDB database `workhub`
- Docker volume `workhub-data`

การกู้คืนต้องใช้ snapshot ที่อยู่ช่วงเวลาเดียวกัน เพื่อให้ record ใน MariaDB ตรงกับไฟล์บน disk
