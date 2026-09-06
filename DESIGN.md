# Design Contract

V2 ใช้หน้าตา V1 เป็น visual contract: โครงสร้างหน้าจอ, navigation, card, dashboard, upload, master data, review modal และ export flow คงเดิม

ส่วนที่ปรับโดยไม่เปลี่ยนภาพรวม:

- รองรับ viewport ขั้นต่ำ 320 px และ `100dvh`
- input บนมือถือใช้ 16 px เพื่อป้องกัน iOS zoom
- touch target ที่มองเห็นอย่างน้อย 40 px
- focus-visible และ reduced motion
- horizontal scrolling อยู่ภายใน navigation/table/chart ไม่ดันทั้งหน้า
- compiled CSS และ self-hosted runtime libraries เพื่อลด render delay
- progress feedback ระหว่างบีบอัด, upload, Gemini และ download

ภาพตรวจล่าสุดอยู่ใน `artifacts/desktop-dashboard.png`, `artifacts/desktop-upload.png`, `artifacts/mobile-dashboard.png` และ `artifacts/mobile-upload.png`
