import { config } from '../config.mjs';
import { analysisProgressFlex, billConfirmation, pageCountMessage } from '../line.mjs';

if(!config.lineChannelAccessToken)throw new Error('LINE token is not configured');
const messages=[
  pageCountMessage('session-test',1,{slots:[]}),
  analysisProgressFlex({job_id:'job-test',status:'AI_RETRY',status_message:'Gemini ไม่ว่าง ระบบจะลองใหม่อัตโนมัติ',attempts:2,page_count:1,next_attempt_at:'2026-09-24 03:30:00.000'}),
  billConfirmation({bill_id:'bill-test',vendor_name:'ร้านทดสอบ',category_name:'วัสดุ',project_name:'โครงการทดสอบ',company_name:'บริษัททดสอบ',document_date:'2026-09-24',subtotal:100,vat_amount:7,grand_total:107,company_match:1,tax_id_match:1,address_match:1,image_quality:'CLEAR',quality_score:100,source_user_name:'ผู้ทดสอบ',review_reasons:'',needs_review:0}),
];
const response=await fetch('https://api.line.me/v2/bot/message/validate/reply',{method:'POST',headers:{Authorization:`Bearer ${config.lineChannelAccessToken}`,'Content-Type':'application/json'},body:JSON.stringify({messages}),signal:AbortSignal.timeout(15000)});
const detail=await response.text();
if(!response.ok)throw new Error(`LINE Flex validation ${response.status}: ${detail}`);
console.log(`LINE Flex validation passed (${messages.length} message variants)`);
