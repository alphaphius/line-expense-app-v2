# Line Expense App V2

V2 แยกจาก V1 ทั้ง Google Sheet, Apps Script, Drive folder และหน้าเว็บ โดยคงหน้าตาและฟังก์ชันของ V1 ไว้ และย้าย UI ไป GitHub Pages

## สิ่งที่พร้อมแล้ว

- Frontend แบบ static PWA ใน `frontend/` และไฟล์พร้อมเผยแพร่ใน `dist/`
- Apps Script JSON API + LINE webhook ใน `apps-script/`
- บีบอัด JPG/PNG/WEBP ในเบราว์เซอร์ก่อนบันทึก: ด้านยาวไม่เกิน 1,800 px เป้าหมายประมาณ 1.2 MB/หน้า
- LINE upload จะพยายามแทนไฟล์ต้นฉบับขนาดใหญ่ด้วย Drive thumbnail หลัง Gemini อ่านเสร็จ
- DOCX export ใช้รูปที่เหมาะกับการส่งออก เป้าหมายไม่เกินประมาณ 900 KB/หน้าเมื่อ Drive สร้าง thumbnail ได้
- แยกปุ่ม `Export DOCX` และ `Export Excel` เพื่อสร้างเฉพาะไฟล์ที่ต้องการและลดเวลารอ
- ป้องกัน submit ซ้ำด้วย request ID, MutationLog และ lock
- เปิดใช้งานได้ทันทีโดยไม่ต้องล็อกอินหรือกรอก PIN; ระบบออก technical session อายุ 6 ชั่วโมงให้อัตโนมัติเพื่อควบคุมคำขอซ้ำและ audit
- Desktop/Mobile responsive, touch target อย่างน้อย 40 px, PWA icon 192/512 และ offline shell
- SweetAlert2/Chart.js self-hosted เพื่อลด dependency จาก CDN; LIFF SDK ใช้ CDN ทางการของ LINE

## ทรัพยากร V2 ที่สร้างแล้ว

- [Google Sheet V2](https://docs.google.com/spreadsheets/d/1gub-fuTQ7II8nkIepuC15RcGO-BxzIF85oiOwP5rWa4/edit)
- [Apps Script V2](https://script.google.com/u/1/home/projects/1RasixoQVWR1qktdxsJsJiRmJujI9fIjL1b8L8TmV2h9WNp2Cppaj-dHo/edit)
- [GitHub repository](https://github.com/alphaphius/line-expense-app-v2)
- [GitHub Pages V2](https://alphaphius.github.io/line-expense-app-v2/)
- [LIFF V2](https://liff.line.me/2011471855-gvI0ZFD3)
- Web App deployment รุ่นแรก: `AKfycbwoLrlaVEI_wF0raV46IBTPQ-s6K9B0WtMTsoZaFpzoX-DZG03iN5Ureh5Rx9uslT_RAw`

V1 ไม่ถูกแก้ไข และไม่มี Script ID, Sheet ID, deployment URL หรือ secret ของ V1 อยู่ใน source V2

## ใช้งานในเครื่อง

ต้องมี Node.js 20 ขึ้นไป

```bash
npm ci
npm run verify
PORT=4175 npm run dev
```

เปิด `http://127.0.0.1:4175` โดย dev server มี mock API เฉพาะ path `__mock_api__` สำหรับตรวจหน้าจอ local เท่านั้น path นี้ไม่ถูก build ไป GitHub Pages

## เปิดระบบจริงครั้งแรก

1. เปิด Apps Script V2 ด้วยบัญชี `alphaphius.tkh@gmail.com`
2. เลือกไฟล์ `02_Setup.gs` เลือกฟังก์ชัน `setupApp` แล้วกด Run
3. กด Review permissions และอนุญาต Sheets/Drive/UrlFetch ให้โปรเจกต์ V2
4. รัน `runSelfTest` และตรวจว่าคืนค่า `passed: true`
5. ที่ Deploy → Manage deployments ตรวจว่า deployment เป็น Web app, Execute as `Me`, Who has access = `Anyone`
6. เปิด Web App URL แล้วตรวจว่าคืน JSON ที่มี `"ok":true`
7. เปิดเว็บ GitHub Pages แล้วตรวจว่า Dashboard แสดงทันทีโดยไม่มีหน้าล็อกอิน

## ตั้งค่า Gemini, LINE และ GitHub Pages

หลัง authorize แล้ว รันฟังก์ชันนี้จาก Apps Script editor โดยแทนค่าจริงของ V2:

```javascript
setSecrets(
  'GEMINI_API_KEY',
  'LINE_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
  'LIFF_ID',
  'https://YOUR_GITHUB_USER.github.io/YOUR_REPOSITORY/'
)
```

ห้ามใส่ secret ลง `frontend/config.js`, GitHub repository หรือ Sheet

จากนั้น:

1. รัน `getDeploymentSetupInfo()` แล้วคัดลอก `webhookUrl`
2. LINE Developers → Messaging API → Webhook URL → วาง URL แล้วกด Verify
3. เปิด Use webhook และปิด webhook ของ V1 ถ้าใช้ LINE OA เดียวกัน เพราะ LINE channel ใช้ webhook หลักได้หนึ่งปลายทาง
4. เพิ่ม LINE OA เข้า group และเปิด Allow bot to join group chats
5. ส่งรูปทดสอบ 1 ใบ เลือกจำนวนหน้า/โครงการ/บริษัท และยืนยันบิล
6. ตั้ง LIFF Endpoint URL เป็น GitHub Pages URL และแก้ Rich Menu ให้ชี้ `https://liff.line.me/LIFF_ID`

## เผยแพร่ GitHub Pages

สร้าง repository ใหม่ แล้ว push โฟลเดอร์นี้เป็น root ของ repository:

```bash
git init
git add .
git commit -m "Initial Line Expense App V2"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USER/YOUR_REPOSITORY.git
git push -u origin main
```

ไปที่ Repository Settings → Pages → Source = GitHub Actions จากนั้น workflow `.github/workflows/pages.yml` จะทดสอบ, build และ deploy `dist/` อัตโนมัติ

ถ้า Web App deployment URL เปลี่ยน ให้แก้ `frontend/config.js` หรือกำหนด environment variable `V2_API_ENDPOINT` ตอน build แล้ว deploy ใหม่

## คำสั่งดูแลระบบ

```bash
npm test          # contract/security/static tests
npm run build     # สร้าง dist
npm run verify    # test + build
npm run deploy:api
npm run status
npm run smoke:api
```

ดูรายละเอียดโครงสร้างที่ [ARCHITECTURE.md](./ARCHITECTURE.md) และเช็กลิสต์ก่อนใช้งานจริงที่ [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md)

## ข้อจำกัดที่ควรรู้

- แอปอยู่ในโหมด `OPEN`: ผู้ที่มีลิงก์ GitHub Pages/API สามารถเข้าถึงฟังก์ชันของระบบได้โดยไม่ต้องกรอก PIN ควรแชร์ลิงก์เฉพาะกลุ่มที่ไว้ใจได้
- Apps Script ไม่เปิด HTTP request headers ให้ `doPost` จึงตรวจ `X-Line-Signature` โดยตรงไม่ได้ รุ่นนี้ใช้ webhook key ยาวใน query stringเป็นด่านป้องกันเพิ่มเติม หากต้องการระดับ production ที่เคร่งครัด ให้เพิ่ม Cloudflare Worker สำหรับตรวจลายเซ็นก่อนส่งต่อ Apps Script
- PDF ไม่ถูก recompress ในเบราว์เซอร์เพื่อป้องกันเอกสารเสียหาย จำกัดไฟล์ละ 8 MB
- Drive thumbnail เป็น best effort หาก Google ไม่สร้าง thumbnail ระบบจะเก็บรูปเดิม แต่ DOCX จะพยายามใช้ thumbnail อีกครั้งตอน export
- ข้อมูลธุรกิจทำงานออนไลน์เท่านั้น; service worker เก็บเฉพาะ application shell และไม่ cache API response
