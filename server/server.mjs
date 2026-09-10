import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { config } from './config.mjs';
import { closeDb, migrate, ping } from './db.mjs';
import { ensureDataDirs } from './files.mjs';
import { ensureDefaults } from './actions/masters.mjs';
import { repairAddressMatchFlags } from './actions/bills.mjs';
import { apiErrorEnvelope, handleApi } from './api.mjs';
import { handleLineWebhook, verifyLineSignature } from './line.mjs';

const app=Fastify({logger:{level:process.env.LOG_LEVEL||'info',redact:['req.headers.authorization','req.body.sessionToken','req.body.protectedToken','req.body.args.*.dataUrl','req.body.args.*.data_url']},bodyLimit:config.maxBodyBytes,trustProxy:config.trustProxy,requestIdHeader:'x-request-id'});
app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json',{parseAs:'string'},(request,body,done)=>{request.rawJsonBody=body;try{done(null,JSON.parse(body||'{}'));}catch(error){error.statusCode=400;done(error);}});
app.addContentTypeParser('text/plain',{parseAs:'string'},(request,body,done)=>{try{done(null,JSON.parse(body||'{}'));}catch(error){error.statusCode=400;done(error);}});
await ensureDataDirs();
await migrate();
await ensureDefaults();
await repairAddressMatchFlags();
await ping();

app.addHook('onSend',async(request,reply,payload)=>{reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','same-origin').header('Permissions-Policy','camera=(), microphone=(), geolocation=()').header('X-Frame-Options','SAMEORIGIN');return payload;});
app.post('/api',async(request,reply)=>{try{reply.header('Cache-Control','no-store');return await handleApi(request.body||{});}catch(error){request.log.error({err:error,action:request.body?.action},'API request failed');reply.code(Number(error.statusCode)||500);return apiErrorEnvelope(error,request.body?.requestId||request.id);}});
app.post('/webhook/line',async(request,reply)=>{const rawBody=request.rawJsonBody||'';if(!verifyLineSignature(rawBody,request.headers['x-line-signature']))return reply.code(401).send({ok:false});const events=Array.isArray(request.body?.events)?request.body.events:[];setImmediate(()=>handleLineWebhook(events,request.log).catch(error=>request.log.error({err:error},'LINE webhook processing failed')));return reply.code(200).send({ok:true});});
app.get('/api/health',async()=>({ok:true,appName:config.appName,version:config.appVersion,database:'connected',lineConfigured:!!(config.lineChannelSecret&&config.lineChannelAccessToken),time:new Date().toISOString()}));
await app.register(fastifyStatic,{root:config.publicDir,prefix:'/',maxAge:'1h',immutable:false,index:['index.html'],setHeaders(reply,filePath){if(/(?:index\.html|config\.js|service-worker\.js|app\.js|api\.js|protected-access\.js|receipts\.js|pwa\.js|styles\.css)$/.test(filePath))reply.header('Cache-Control','no-cache, no-store, must-revalidate');else if(/\.(wasm|gz)$/.test(filePath))reply.header('Cache-Control','public, max-age=31536000, immutable');}});
app.setNotFoundHandler((request,reply)=>{if(request.method==='GET'&&!path.extname(request.url.split('?')[0]))return reply.sendFile('index.html');return reply.code(404).send({error:'Not found'});});

const shutdown=async signal=>{app.log.info({signal},'Shutting down');await app.close();await closeDb();process.exit(0);};
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
await app.listen({host:config.host,port:config.port});
