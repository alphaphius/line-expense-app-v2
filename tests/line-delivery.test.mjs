import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { deliverLineMessage, isTransient, LineDeliveryError, notificationKey, retryDelay, runLeasedItem } from '../server/line-delivery.mjs';

const row={seq:1,attempts:1,target:'test-user',messages:JSON.stringify([{type:'text',text:'saved'}]),retry_key:'1b1c3dba-09b6-4c1a-9c17-8497e260b914',reply_token:''};
const response=(status,body='',headers={})=>new Response(body,{status,headers});

test('LINE delivery uses the free reply for next-step controls instead of consuming a push',async()=>{
  const calls=[];
  const result=await deliverLineMessage({...row,reply_token:'reply',reply_until:'2026-09-23 00:01:00.000'},{token:'test',now:()=>Date.UTC(2026,8,23),fetchFn:async(url,options)=>{calls.push({url,...options});return response(200);}});
  assert.equal(result,'REPLIED');assert.equal(calls.length,1);assert.match(calls[0].url,/\/reply$/);
  assert.equal(JSON.parse(calls[0].body).replyToken,'reply');
});

test('expired reply never falls back to quota-consuming Push',async()=>{
  const calls=[];let disabled=0;
  const item={...row,reply_token:'expired',reply_until:'2026-09-23 00:01:00.000'};
  const fetchFn=async(url)=>{calls.push(url);return response(400,'{"message":"Invalid reply token"}');};
  const opts={token:'test',now:()=>Date.UTC(2026,8,23),fetchFn,disableReply:async()=>{disabled++;item.reply_token='';}};
  assert.equal(await deliverLineMessage(item,opts),'REPLY_EXPIRED');
  assert.equal(calls.length,1);assert.match(calls[0],/\/reply$/);assert.equal(disabled,1);
  assert.equal(await deliverLineMessage(item,opts),'REPLY_EXPIRED');assert.equal(calls.length,1);
});

test('invalid Flex content is not misclassified as an expired reply token',async()=>{
  let calls=0;
  await assert.rejects(deliverLineMessage({...row,reply_token:'reply',reply_until:'2026-09-23 00:01:00.000'},{token:'test',now:()=>Date.UTC(2026,8,23),fetchFn:async()=>{calls++;return response(400,'invalid message contents');}}),{status:400});
  assert.equal(calls,1);
});

test('ambiguous reply timeout is retried without immediately duplicating it by push',async()=>{
  let calls=0;
  await assert.rejects(deliverLineMessage({...row,reply_token:'reply',reply_until:'2026-09-23 00:01:00.000'},{token:'test',now:()=>Date.UTC(2026,8,23),fetchFn:async()=>{calls++;throw new DOMException('timeout','TimeoutError');}}));
  assert.equal(calls,1);
});

test('LINE 429 preserves retry-after and is not reported as successful delivery',async()=>{
  const waiting={...row,reply_token:'reply',reply_until:'2026-09-23 00:01:00.000'};
  await assert.rejects(deliverLineMessage(waiting,{token:'test',now:()=>Date.UTC(2026,8,23),fetchFn:async()=>response(429,'rate limit',{'retry-after':'60'})}),error=>{
    assert.equal(error.retryAfter,60);assert.equal(error.retryable,true);assert.ok(retryDelay(1,error.retryAfter,()=>0)>=60000);return true;
  });
});

test('outbox row without a valid reply token makes no LINE API request',async()=>{
  let calls=0;
  assert.equal(await deliverLineMessage(row,{token:'test',fetchFn:async()=>{calls++;return response(200);}}),'REPLY_EXPIRED');
  assert.equal(calls,0);
});

test('image timeout reschedules the durable item; later attempts complete the SAME item',async()=>{
  const states=[];
  const options={row,complete:async item=>states.push([item.seq,'COMPLETED']),retry:async(item,error,delay)=>{assert.ok(delay>=5000);states.push([item.seq,'RETRY']);},fail:async()=>assert.fail('must retry')};
  assert.equal(await runLeasedItem({...options,perform:async()=>{throw new DOMException('download timed out','TimeoutError');}}),'RETRY');
  assert.equal(await runLeasedItem({...options,row:{...row,attempts:2},perform:async()=>{}}),'COMPLETED');
  assert.deepEqual(states,[[1,'RETRY'],[1,'COMPLETED']]);
});

test('exhausted and permanent failures stop retrying but do not prevent the next job',async()=>{
  const states=[];
  const base={complete:async()=>states.push('complete'),retry:async()=>assert.fail('no retry'),fail:async()=>states.push('failed')};
  await runLeasedItem({...base,row:{...row,attempts:8},perform:async()=>{throw new LineDeliveryError(503,'busy');}});
  await runLeasedItem({...base,row,perform:async()=>{throw new LineDeliveryError(401,'invalid token');}});
  await runLeasedItem({...base,row:{...row,seq:2},perform:async()=>{}});
  assert.deepEqual(states,['failed','failed','complete']);
});

test('transient connection/DB errors back off; validation failures do not loop forever',()=>{
  for(const error of [new TypeError('fetch failed'),Object.assign(new Error('lock wait timeout'),{code:'ER_LOCK_WAIT_TIMEOUT'}),new LineDeliveryError(503,'busy')])assert.equal(isTransient(error),true);
  assert.equal(isTransient(new Error('กรุณาเลือกโครงการ')),false);
  assert.equal(isTransient(new LineDeliveryError(400,'invalid payload')),false);
  assert.equal(notificationKey('event:1:message:0'),notificationKey('event:1:message:0'));
  assert.notEqual(notificationKey('event:2:message:0'),notificationKey('event:1:message:0'));
});

test('LINE webhook commits before 200 and bill flow contains no automatic Push worker',async()=>{
  const server=await fs.readFile(new URL('../server/server.mjs',import.meta.url),'utf8');
  assert.match(server,/await handleLineWebhook\(events\);return reply.code\(200\)/);
  const ai=server.slice(server.indexOf('const runBillAiWorker='),server.indexOf('const billAiTimer='));
  assert.doesNotMatch(ai,/notifyBillAiJobOutcome/);
  assert.doesNotMatch(server,/billNotifyTimer|notifyBillAiJobOutcome|getPendingBillAiNotification/);
  const line=await fs.readFile(new URL('../server/line.mjs',import.meta.url),'utf8');
  const delivery=await fs.readFile(new URL('../server/line-delivery.mjs',import.meta.url),'utf8');
  assert.match(line,/action=check_bill_ai/);
  assert.doesNotMatch(line,/message\/push|pushWithRetry/);
  assert.doesNotMatch(delivery,/message\/push|PUSH_ACCEPTED/);
  const bills=await fs.readFile(new URL('../server/actions/bills.mjs',import.meta.url),'utf8');
  assert.match(bills,/values.line_session_id=lineSessionId/);
  assert.match(bills,/source_context_id=\? FOR UPDATE/);
  assert.match(bills,/if\(error.existingJobId\)return getBillAiJob/);
});
