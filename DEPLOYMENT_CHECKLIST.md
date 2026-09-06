# Deployment Checklist

## A. Google V2

- [x] สร้าง Google Sheet V2 แยกจาก V1
- [x] สร้าง Apps Script V2 แยกจาก V1
- [x] Push source 19 ไฟล์
- [x] สร้าง deployment version 1
- [x] เจ้าของบัญชีอนุญาตสิทธิ์ที่ระบบต้องใช้
- [x] `setupApp()` สำเร็จและมี 13 sheets ตาม schema
- [x] `runSelfTest()` ทำงานจบโดยไม่พบ failure
- [x] Web App เปิดแบบไม่ login และคืน health JSON 200

## B. Secrets

- [ ] `GEMINI_API_KEY`
- [ ] `LINE_ACCESS_TOKEN`
- [ ] `LINE_CHANNEL_SECRET`
- [ ] `LIFF_ID`
- [ ] `FRONTEND_URL`
- [ ] เปลี่ยน PIN เริ่มต้น `1234`

## C. GitHub Pages

- [ ] ยืนยันชื่อและ visibility ของ repository ใหม่
- [ ] Push branch `main`
- [ ] Settings → Pages → GitHub Actions
- [ ] Workflow test/build/deploy ผ่าน
- [ ] เปิด Pages URL บน Desktop และ Smartphone
- [ ] ตรวจ PWA manifest/icons/service worker

## D. LINE OA

- [ ] ใช้ `webhookUrl` จาก `getDeploymentSetupInfo()`
- [ ] Verify webhook ผ่าน
- [ ] เปิด Use webhook
- [ ] เปิด Allow bot to join group chats
- [ ] ตั้ง LIFF Endpoint เป็น GitHub Pages
- [ ] Rich Menu ชี้ LIFF URL ไม่ชี้ Apps Script/Drive
- [ ] ทดสอบ private chat 1 รูป
- [ ] ทดสอบ group chat 1 รูปและหลายหน้า
- [ ] ทดสอบยกเลิก session และส่งใหม่
- [ ] ทดสอบ Flex ยืนยัน/แก้ไขและ push กลับห้องต้นทาง

## E. Export / Recovery

- [ ] Export Word เดือนทดสอบและตรวจขนาดไฟล์
- [ ] Export Excel และตรวจยอดรวม
- [ ] เปิดรูป preview จากบิล
- [ ] ลบ/กู้คืนบิล
- [ ] ตรวจ `AuditLogs`, `MutationLog`, `SecurityLog`
- [ ] สำรอง Sheet ก่อนแก้ schema หรือย้ายข้อมูล
