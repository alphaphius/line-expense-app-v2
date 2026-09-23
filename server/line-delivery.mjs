import crypto from 'node:crypto';

// No credential or recipient is included in transport errors/logs.
export class LineDeliveryError extends Error {
  constructor(status, detail, retryAfter = 0) {
    super(`LINE ${status}: ${String(detail).slice(0,350)}`);
    this.status = status;
    this.retryAfter = retryAfter;
    this.retryable = status === 429 || status >= 500;
  }
}

export function retryDelay(attempt, retryAfter = 0, random = Math.random) {
  return Math.max(retryAfter * 1000, Math.min(15 * 60_000, 5000 * 2 ** Math.max(0,attempt-1)) + Math.floor(random()*1500));
}

export function isTransient(error) {
  return error.retryable === true || (!error.status && (
    ['TimeoutError','AbortError','TypeError'].includes(error.name) ||
    /ECONN|ETIMEDOUT|EAI_AGAIN|deadlock|lock wait timeout|connection|socket/i.test(`${error.code || ''} ${error.message}`)
  ));
}

export function notificationKey(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function deliverLineMessage(row, {token, fetchFn=fetch, now=Date.now, disableReply=async()=>{}}) {
  const messages=typeof row.messages==='string'?JSON.parse(row.messages):row.messages;
  const send=async body=>{
    const response=await fetchFn('https://api.line.me/v2/bot/message/reply',{
      method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(15000),
    });
    if(response.ok)return;
    const detail=await response.text().catch(()=> '');
    throw new LineDeliveryError(response.status,detail,Number(response.headers.get('retry-after'))||0);
  };
  const replyUntil=row.reply_until?new Date(String(row.reply_until).replace(' ','T')+'Z').getTime():0;
  if(row.reply_token&&replyUntil>now()){
    try { await send({replyToken:row.reply_token,messages});return 'REPLIED'; }
    catch(error){
      // Network timeout is ambiguous; retry only the SAME reply token.
      if(error.status!==400)throw error;
      if(!/reply token/i.test(error.message))throw error;
      await disableReply();
    }
  }
  // Deliberately never fall back to Push: this bill flow must not consume monthly quota.
  return 'REPLY_EXPIRED';
}

// A leased item never loses its durable record when a worker or network fails.
export async function runLeasedItem({row,perform,complete,retry,fail,maxAttempts=8}) {
  try { await perform(row);await complete(row);return 'COMPLETED'; }
  catch(error){
    if(isTransient(error)&&row.attempts<maxAttempts){await retry(row,error,retryDelay(row.attempts,error.retryAfter));return 'RETRY';}
    await fail(row,error);return 'FAILED';
  }
}
