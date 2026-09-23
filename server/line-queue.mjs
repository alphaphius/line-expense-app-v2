import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { execute, one, select, transaction } from './db.mjs';
import { config } from './config.mjs';
import { deliverLineMessage, notificationKey, runLeasedItem } from './line-delivery.mjs';

const context=new AsyncLocalStorage();
const sqlDate=ms=>new Date(ms).toISOString().slice(0,23).replace('T',' ');
export const lineEventContext=()=>context.getStore();

export async function enqueueLineEvents(events) {
  await transaction(async db=>{
    for(const event of events){
      if(!['message','postback','follow','join'].includes(event.type))continue;
      const source=event.source||{};
      const target=source.groupId||source.roomId||source.userId||'';
      if(!target)continue;
      const id=event.webhookEventId||notificationKey(JSON.stringify(event));
      const [old]=await db.execute("SELECT event_id FROM line_webhook_events WHERE event_id=? AND status='COMPLETED'",[id]);
      if(old.length)continue;
      // Status queries must still respond while an image download is backing off.
      const statusQuery=event.type==='message'&&/^(สถานะ|status|ต่อ)$/i.test(event.message?.text||'');
      const lane=notificationKey(`${target}:${source.userId||''}${statusQuery?':status':''}`);
      await db.execute('INSERT IGNORE INTO line_inbox (event_id,lane,payload) VALUES (?,?,?)',[id,lane,JSON.stringify(event)]);
    }
  });
}

export async function enqueueLineMessage(target,messages,{replyToken='',key}={}) {
  if(!target)throw new Error('Missing LINE notification target');
  const ctx=context.getStore();
  const identity=key||(ctx?`${ctx.row.event_id}:message:${ctx.sequence++}`:crypto.randomUUID());
  await execute(`INSERT IGNORE INTO line_outbox (dedupe_key,target,messages,reply_token,reply_until,retry_key)
    VALUES (:key,:target,:messages,:reply,:until,:retry)`,{
    key:notificationKey(identity),target,messages:JSON.stringify(messages.slice(0,5)),reply:replyToken,
    until:replyToken?sqlDate(new Date(String(ctx?.row.created_at||sqlDate(Date.now())).replace(' ','T')+'Z').getTime()+50000):null,
    retry:crypto.randomUUID(),
  });
}

export async function bindLineSession(id) {
  const ctx=context.getStore();
  if(ctx){await execute('UPDATE line_inbox SET session_id=:id WHERE seq=:seq AND lease_token=:lease',{id,seq:ctx.row.seq,lease:ctx.row.lease_token});ctx.row.session_id=id;}
}

export async function claimLineWork(table,{transactionFn=transaction}={}) {
  if(!['line_inbox','line_outbox'].includes(table))throw new Error('Invalid LINE queue');
  // Short DB lock serializes claims across processes; network work never holds this lock.
  return transactionFn(async db=>{
    const [locks]=await db.execute('SELECT GET_LOCK(?,0) AS acquired',[`workhub:${table}:claim`]);
    if(!Number(locks[0]?.acquired))return null;
    try {
      const lane=table==='line_inbox'?`AND NOT EXISTS (SELECT 1 FROM line_inbox older WHERE older.lane=q.lane AND older.seq<q.seq AND older.status IN ('PENDING','RETRY','PROCESSING'))`:`AND NOT EXISTS (SELECT 1 FROM line_outbox older WHERE older.target=q.target AND older.seq<q.seq AND (older.status='PENDING' OR (older.status='PROCESSING' AND older.lease_until>=UTC_TIMESTAMP(3))))`;
      const [rows]=await db.execute(`SELECT q.* FROM ${table} q WHERE ((q.status IN ('PENDING','RETRY') AND q.available_at<=UTC_TIMESTAMP(3)) OR (q.status='PROCESSING' AND q.lease_until<UTC_TIMESTAMP(3))) ${lane} ORDER BY q.seq LIMIT 1 FOR UPDATE`);
      if(!rows[0])return null;
      const row=rows[0];row.attempts+=1;row.lease_token=crypto.randomUUID();
      await db.execute(`UPDATE ${table} SET status='PROCESSING',attempts=?,lease_token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE),updated_at=UTC_TIMESTAMP(3) WHERE seq=?`,[row.attempts,row.lease_token,row.seq]);
      // Commit before releasing the named lock, so another connection sees the claim.
      await db.commit();
      return row;
    }finally{await db.execute('SELECT RELEASE_LOCK(?)',[`workhub:${table}:claim`]);}
  });
}

async function settle(table,row,status,error='',delay=0) {
  await execute(`UPDATE ${table} SET status=:status,last_error=:error,available_at=:due,lease_until=NULL,updated_at=UTC_TIMESTAMP(3) ${table==='line_outbox'&&status==='COMPLETED'?",reply_token=''":''} WHERE seq=:seq AND lease_token=:lease`,{
    seq:row.seq,lease:row.lease_token,status,error:String(error).slice(0,1000),due:sqlDate(Date.now()+delay),
  });
}

export function startLineWorkers({handleEvent,logger=console}) {
  let stopped=false;
  const active=new Set();
  let inboxActive=0,outboxActive=0;
  const work=async table=>{
    const row=await claimLineWork(table);if(!row)return;
    const event=table==='line_inbox'?JSON.parse(row.payload):null;
    const target=event&&(event.source?.groupId||event.source?.roomId||event.source?.userId);
    await runLeasedItem({row,maxAttempts:table==='line_inbox'?8:20,
      perform:async()=>{
        if(event){
          // Loading indicator is best-effort and never spends the reply token.
          const loading=event.message?.type==='image'&&event.source?.type==='user'&&row.attempts===1
            ? fetch('https://api.line.me/v2/bot/chat/loading/start',{method:'POST',headers:{Authorization:`Bearer ${config.lineChannelAccessToken}`,'Content-Type':'application/json'},body:JSON.stringify({chatId:target,loadingSeconds:60}),signal:AbortSignal.timeout(3000)}).catch(()=>{})
            : Promise.resolve();
          await Promise.all([loading,context.run({row,sequence:0},()=>handleEvent(event))]);return;
        }
        await deliverLineMessage(row,{token:config.lineChannelAccessToken,disableReply:()=>execute("UPDATE line_outbox SET reply_token='' WHERE seq=:seq AND lease_token=:lease",{seq:row.seq,lease:row.lease_token})});
      },
      complete:()=>settle(table,row,'COMPLETED'),
      retry:async(_,error,delay)=>{
        logger.warn?.({queue:table,seq:row.seq,attempt:row.attempts,error:error.message},'LINE work scheduled for retry');
        await settle(table,row,'RETRY',error.message,delay);
      },
      fail:async(_,error)=>{
        logger.error?.({queue:table,seq:row.seq,attempt:row.attempts,error:error.message},'LINE work requires attention');
        if(event&&row.attempts===1&&event.replyToken)await enqueueLineMessage(target,[{type:'text',text:`ทำรายการไม่สำเร็จ: ${String(error.message).slice(0,250)}\nกรุณาแก้ไขตามข้อความแล้วลองใหม่ หรือพิมพ์ “สถานะ” เพื่อตรวจรายการที่เก็บได้แล้ว`}],{replyToken:event.replyToken,key:`${row.event_id}:failed`});
        await settle(table,row,'FAILED',error.message);
      },
    });
  };
  const launch=table=>{
    const task=work(table).catch(error=>logger.error?.({error:error.message,queue:table},'LINE queue worker error'));
    active.add(task);task.finally(()=>{active.delete(task);if(table==='line_inbox')inboxActive--;else outboxActive--;});
  };
  const tick=()=>{
    if(stopped)return;
    if(inboxActive<3){inboxActive++;launch('line_inbox');}
    if(outboxActive<3){outboxActive++;launch('line_outbox');}
  };
  const timer=setInterval(tick,400);timer.unref();tick();
  // Preserve recent failures for diagnosis, not raw reply tokens indefinitely.
  const cleanup=setInterval(()=>Promise.all([
    execute("DELETE FROM line_inbox WHERE status IN ('COMPLETED','FAILED') AND updated_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 7 DAY)"),
    execute("DELETE FROM line_outbox WHERE status IN ('COMPLETED','FAILED') AND updated_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 7 DAY)"),
  ]).catch(error=>logger.error?.({error:error.message},'LINE queue retention failed')),3600000);cleanup.unref();
  return {async stop(){stopped=true;clearInterval(timer);clearInterval(cleanup);await Promise.allSettled([...active]);}};
}

export async function lineQueueStatus(){
  return {
    inbox:await select('SELECT status,COUNT(*) AS count,MIN(created_at) AS oldest FROM line_inbox GROUP BY status'),
    outbox:await select('SELECT status,COUNT(*) AS count,MIN(created_at) AS oldest FROM line_outbox GROUP BY status'),
  };
}

export async function lineQueueWarnings(){
  const rows=await select("SELECT status,COUNT(*) AS n FROM line_outbox WHERE status IN ('FAILED','RETRY') GROUP BY status");
  return rows.map(row=>row.status==='FAILED'?`LINE มี Reply ส่งไม่สำเร็จ ${row.n} รายการใน 7 วันล่าสุด กรุณาตรวจ Log / สิทธิ์ LINE`:`LINE กำลังลองส่ง Reply ใหม่ ${row.n} รายการ การบันทึกบิลยังทำงานแยกกัน`);
}

export async function pendingLineInput(user,contextId){
  return one(`SELECT status,attempts,session_id FROM line_inbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.source.userId'))=:user
    AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.source.groupId')),JSON_UNQUOTE(JSON_EXTRACT(payload,'$.source.roomId')),JSON_UNQUOTE(JSON_EXTRACT(payload,'$.source.userId')))=:context
    AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.message.type'))='image' ORDER BY seq DESC LIMIT 1`,{user,context:contextId});
}
