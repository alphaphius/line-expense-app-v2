import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { config } from './config.mjs';
import { closeDb, migrate, ping } from './db.mjs';
import { ensureDataDirs } from './files.mjs';
import { ensureDefaults } from './actions/masters.mjs';
import { processNextBillAiJob, recoverBillAiJobs, repairAddressMatchFlags } from './actions/bills.mjs';
import { processNextReceiptAiJob, recoverReceiptAiJobs } from './actions/receipts.mjs';
import { captureScheduledModuleSnapshots } from './actions/modules.mjs';
import { apiErrorEnvelope, handleApi } from './api.mjs';
import { handleEvent, handleLineWebhook, verifyLineSignature } from './line.mjs';
import { startLineWorkers } from './line-queue.mjs';

const app=Fastify({logger:{level:process.env.LOG_LEVEL||'info',redact:['req.headers.authorization','req.body.sessionToken','req.body.protectedToken','req.body.args.*.dataUrl','req.body.args.*.data_url']},bodyLimit:config.maxBodyBytes,trustProxy:config.trustProxy,requestIdHeader:'x-request-id'});
app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json',{parseAs:'string'},(request,body,done)=>{request.rawJsonBody=body;try{done(null,JSON.parse(body||'{}'));}catch(error){error.statusCode=400;done(error);}});
app.addContentTypeParser('text/plain',{parseAs:'string'},(request,body,done)=>{try{done(null,JSON.parse(body||'{}'));}catch(error){error.statusCode=400;done(error);}});
await ensureDataDirs();
await migrate();
await ensureDefaults();
await repairAddressMatchFlags();
await recoverBillAiJobs();
await recoverReceiptAiJobs();
await ping();
await captureScheduledModuleSnapshots().catch(error=>app.log.error({err:error},'Initial report snapshot failed'));
const snapshotTimer=setInterval(()=>captureScheduledModuleSnapshots().catch(error=>app.log.error({err:error},'Scheduled report snapshot failed')),5*60*1000);
snapshotTimer.unref();
let billAiWorkerBusy=false;
const runBillAiWorker=async()=>{
  if(billAiWorkerBusy)return;
  billAiWorkerBusy=true;
  try{
    await processNextBillAiJob();
  }catch(error){app.log.error({err:error},'Bill AI queue worker failed');}
  finally{billAiWorkerBusy=false;}
};
const billAiTimer=setInterval(runBillAiWorker,3000);
billAiTimer.unref();
setImmediate(runBillAiWorker);
const lineWorkers=startLineWorkers({handleEvent,logger:app.log});
const aiRecoveryTimer=setInterval(()=>recoverBillAiJobs().catch(error=>app.log.error({err:error},'Bill AI recovery failed')),3*60*1000);aiRecoveryTimer.unref();
let receiptAiWorkerBusy=false;
const runReceiptAiWorker=async()=>{
  if(receiptAiWorkerBusy)return;
  receiptAiWorkerBusy=true;
  try{await processNextReceiptAiJob();}catch(error){app.log.error({err:error},'Receipt AI queue worker failed');}
  finally{receiptAiWorkerBusy=false;}
};
const receiptAiTimer=setInterval(runReceiptAiWorker,4000);
receiptAiTimer.unref();
setImmediate(runReceiptAiWorker);

app.addHook('onSend',async(request,reply,payload)=>{reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','same-origin').header('Permissions-Policy','camera=(), microphone=(), geolocation=(self)').header('X-Frame-Options','SAMEORIGIN');return payload;});
app.post('/api',async(request,reply)=>{try{reply.header('Cache-Control','no-store');return await handleApi(request.body||{});}catch(error){request.log.error({err:error,action:request.body?.action},'API request failed');reply.code(Number(error.statusCode)||500);return apiErrorEnvelope(error,request.body?.requestId||request.id);}});
app.post('/webhook/line',async(request,reply)=>{const rawBody=request.rawJsonBody||'';if(!verifyLineSignature(rawBody,request.headers['x-line-signature']))return reply.code(401).send({ok:false});const events=Array.isArray(request.body?.events)?request.body.events:[];await handleLineWebhook(events);return reply.code(200).send({ok:true});});
app.get('/api/health',async()=>({ok:true,appName:config.appName,version:config.appVersion,database:'connected',lineConfigured:!!(config.lineChannelSecret&&config.lineChannelAccessToken),receiptAiConfigured:!!config.receiptGeminiApiKey,time:new Date().toISOString()}));
app.get('/config.js',async(request,reply)=>{reply.type('text/javascript; charset=utf-8').header('Cache-Control','no-cache, no-store, must-revalidate');return `window.LINE_EXPENSE_CONFIG=Object.freeze(${JSON.stringify({apiVersion:config.apiVersion,apiEndpoint:'/api',googleMapsApiKey:config.googleMapsApiKey,googleMapsMapId:config.googleMapsMapId,requestTimeoutMs:90000,longRequestTimeoutMs:330000})});`;});
await app.register(fastifyStatic,{root:config.publicDir,prefix:'/',maxAge:'1h',immutable:false,index:['index.html'],setHeaders(reply,filePath){if(/\.(?:html|js|css|webmanifest)$/i.test(filePath))reply.header('Cache-Control','no-cache, no-store, must-revalidate');else if(/\.(wasm|gz)$/i.test(filePath))reply.header('Cache-Control','public, max-age=31536000, immutable');}});
app.setNotFoundHandler((request,reply)=>{if(request.method==='GET'&&!path.extname(request.url.split('?')[0]))return reply.sendFile('index.html');return reply.code(404).send({error:'Not found'});});

const shutdown=async signal=>{app.log.info({signal},'Shutting down');clearInterval(snapshotTimer);clearInterval(billAiTimer);clearInterval(receiptAiTimer);clearInterval(aiRecoveryTimer);await app.close();await lineWorkers.stop();while(billAiWorkerBusy||receiptAiWorkerBusy)await new Promise(resolve=>setTimeout(resolve,100));await closeDb();process.exit(0);};
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
await app.listen({host:config.host,port:config.port});
