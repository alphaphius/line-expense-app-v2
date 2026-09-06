function handleLineWebhook_(e) {
  const body = JSON.parse((e && e.postData && e.postData.contents) || '{"events":[]}');
  const events = Array.isArray(body.events) ? body.events : [];
  events.forEach(function (event) {
    if (isDuplicateLineEvent_(event.webhookEventId)) return;
    try {
      handleLineEvent_(event);
      completeLineEvent_(event.webhookEventId);
    } catch (error) {
      // Reply token ใช้ได้ครั้งเดียวเท่านั้น จึงต้องปิด event แม้ประมวลผลล้มเหลว
      // เพื่อไม่ให้ webhook retry นำ token เดิมกลับมาใช้ซ้ำ
      completeLineEvent_(event.webhookEventId);
      console.error('LINE event error: ' + (error && error.stack ? error.stack : error));
      const replyTarget = getLineContextId_(event.source) || (event.source && event.source.userId);
      if (replyTarget) {
        try { pushLine_(replyTarget, [{ type: 'text', text: 'เกิดข้อผิดพลาด: ' + cleanString_(error.message || error, 300) }]); } catch (ignored) { console.error(ignored); }
      }
    }
  });
}

function handleLineEvent_(event) {
  setupIfNeeded_();
  const userId = cleanString_(event.source && event.source.userId);
  const contextId = getLineContextId_(event.source);
  if (event.type === 'message' && event.message && event.message.type === 'image') {
    handleLineImage_(event, userId, contextId);
    return;
  }
  if (event.type === 'postback') {
    handleLinePostback_(event, userId, parseQueryString_(event.postback && event.postback.data), contextId);
    return;
  }
  if (event.type === 'message' && event.message && event.message.type === 'text') {
    const text = cleanString_(event.message.text);
    if (/^(ยกเลิก|cancel)$/i.test(text)) {
      const cancelled = cancelLineSession_(userId, contextId);
      replyLine_(event.replyToken, [{ type: 'text', text: cancelled.message }]);
    } else {
      replyLine_(event.replyToken, [{ type: 'text', text: 'ส่งรูปบิลเข้ามาได้เลยครับ ระบบจะถามจำนวนหน้า โครงการ และบริษัทก่อนวิเคราะห์' }]);
    }
    return;
  }
  if (event.type === 'follow' && event.replyToken) {
    replyLine_(event.replyToken, [{ type: 'text', text: 'ยินดีต้อนรับสู่ Line Expense App\nส่งรูปบิลเพื่อเริ่มบันทึกค่าใช้จ่ายได้เลยครับ' }]);
  }
}

function handleLineImage_(event, userId, contextId) {
  if (!userId) throw new Error('ไม่พบ LINE userId');
  let session = findActiveLineSession_(userId, contextId);
  if (session && ['PROCESSING', 'AWAITING_PROJECT', 'AWAITING_COMPANY'].indexOf(session.status) >= 0) {
    replyLine_(event.replyToken, [{ type: 'text', text: 'กรุณาทำรายการเดิมให้เสร็จก่อน หรือพิมพ์ “ยกเลิก” เพื่อเริ่มใหม่' }]);
    return;
  }
  if (!session) session = createLineSession_(userId, contextId);

  const received = toNumber_(session.received_pages);
  const expected = toNumber_(session.expected_pages);
  if (expected && received >= expected) {
    replyLine_(event.replyToken, [{ type: 'text', text: 'ได้รับรูปครบตามจำนวนแล้ว กรุณาเลือกโครงการ หรือพิมพ์ “ยกเลิก” เพื่อเริ่มใหม่' }]);
    return;
  }

  saveLineImageToSession_(session, event.message.id, received + 1);
  session = updateObjectById_(SHEETS.SESSIONS, 'session_id', session.session_id, {
    received_pages: received + 1,
    status: expected
      ? ((received + 1 >= expected) ? (session.project_id && session.company_id ? 'AWAITING_COMPANY' : 'AWAITING_PROJECT') : 'COLLECTING_PAGES')
      : 'AWAITING_PAGE_COUNT',
    updated_at: nowIso_(),
  });

  if (!expected) {
    replyLine_(event.replyToken, [pageCountMessage_(session.session_id, received + 1)]);
  } else if (received + 1 < expected) {
    replyLine_(event.replyToken, [{ type: 'text', text: 'ได้รับหน้า ' + (received + 1) + '/' + expected + ' แล้ว กรุณาส่งหน้าถัดไป' }]);
  } else if (session.project_id && session.company_id) {
    processSelectedLineSession_(session.session_id, userId, event.replyToken, contextId);
  } else {
    replyLine_(event.replyToken, [projectSelectionMessage_(session.session_id)]);
  }
}

function handleLinePostback_(event, userId, data, contextId) {
  const action = cleanString_(data.action);
  if (action === 'set_pages') {
    const session = requireUserSession_(data.session_id, userId, contextId);
    const pages = Math.max(1, Math.min(APP_CONFIG.MAX_PAGES_PER_BILL, Number(data.pages) || 1));
    if (pages < toNumber_(session.received_pages)) throw new Error('จำนวนหน้าต้องไม่น้อยกว่ารูปที่ส่งมาแล้ว');
    updateObjectById_(SHEETS.SESSIONS, 'session_id', session.session_id, {
      expected_pages: pages,
      project_id: '',
      company_id: '',
      status: toNumber_(session.received_pages) >= pages ? 'AWAITING_PROJECT' : 'COLLECTING_PAGES',
      updated_at: nowIso_(),
    });
    if (toNumber_(session.received_pages) >= pages) {
      replyLine_(event.replyToken, [projectSelectionMessage_(session.session_id)]);
    } else {
      replyLine_(event.replyToken, [{ type: 'text', text: 'บิลชุดนี้มี ' + pages + ' หน้า\nได้รับแล้ว ' + session.received_pages + ' หน้า กรุณาส่งหน้าถัดไป' }]);
    }
    return;
  }

  if (action === 'use_quick_settings') {
    const session = requireUserSession_(data.session_id, userId, contextId);
    const quick = getQuickSettingBySlot_(getQuickSettings_(), data.slot);
    if (!quick.configured) throw new Error(quick.message || ('ยังไม่ได้ตั้งค่าลัด ' + quick.slot));
    if (quick.page_count < toNumber_(session.received_pages)) {
      throw new Error('จำนวนหน้าในค่าลัดน้อยกว่ารูปที่ส่งมาแล้ว กรุณาเลือกจำนวนหน้าแบบกำหนดเอง');
    }
    const ready = toNumber_(session.received_pages) >= quick.page_count;
    updateObjectById_(SHEETS.SESSIONS, 'session_id', session.session_id, {
      expected_pages: quick.page_count,
      project_id: quick.project_id,
      company_id: quick.company_id,
      status: ready ? 'AWAITING_COMPANY' : 'COLLECTING_PAGES',
      updated_at: nowIso_(),
    });
    if (ready) {
      processSelectedLineSession_(session.session_id, userId, event.replyToken, contextId);
    } else {
      replyLine_(event.replyToken, [{
        type: 'text',
        text: 'ใช้' + quick.label + ' แล้ว\n'
          + 'โครงการ: ' + quick.project_name + '\n'
          + 'บริษัท: ' + quick.company_name + '\n'
          + 'ได้รับแล้ว ' + session.received_pages + '/' + quick.page_count + ' หน้า กรุณาส่งหน้าถัดไป',
      }]);
    }
    return;
  }

  if (action === 'select_project') {
    const session = requireUserSession_(data.session_id, userId, contextId);
    const project = findById_(SHEETS.PROJECTS, 'project_id', data.project_id);
    if (!project || !toBoolean_(project.active)) throw new Error('ไม่พบโครงการที่เลือก');
    updateObjectById_(SHEETS.SESSIONS, 'session_id', session.session_id, {
      project_id: project.project_id, status: 'AWAITING_COMPANY', updated_at: nowIso_(),
    });
    moveSessionFilesToProject_(session.session_id, project.project_name);
    replyLine_(event.replyToken, [companySelectionMessage_(session.session_id)]);
    return;
  }

  if (action === 'select_company') {
    const session = requireUserSession_(data.session_id, userId, contextId);
    const company = findById_(SHEETS.COMPANIES, 'company_id', data.company_id);
    if (!company || !toBoolean_(company.active)) throw new Error('ไม่พบบริษัทที่เลือก');
    updateObjectById_(SHEETS.SESSIONS, 'session_id', session.session_id, {
      company_id: company.company_id, status: 'AWAITING_COMPANY', updated_at: nowIso_(),
    });
    processSelectedLineSession_(session.session_id, userId, event.replyToken, contextId);
    return;
  }

  if (action === 'confirm_bill') {
    const result = confirmBill(data.bill_id, userId);
    if (!result.ok) throw new Error(result.error);
    replyLine_(event.replyToken, [buildBillSavedFlex(result.data)]);
    return;
  }
  if (action === 'cancel_bill') {
    const result = rejectBill(data.bill_id, userId);
    if (!result.ok) throw new Error(result.error);
    replyLine_(event.replyToken, [{ type: 'text', text: 'ยกเลิกบิลนี้แล้ว สามารถส่งรูปใหม่ได้เลยครับ' }]);
    return;
  }
  replyLine_(event.replyToken, [{ type: 'text', text: 'คำสั่งหมดอายุหรือไม่ถูกต้อง กรุณาส่งรูปใหม่อีกครั้ง' }]);
}

function processSelectedLineSession_(sessionId, userId, replyToken, contextId) {
  const session = requireUserSession_(sessionId, userId, contextId);
  const project = findById_(SHEETS.PROJECTS, 'project_id', session.project_id);
  const company = findById_(SHEETS.COMPANIES, 'company_id', session.company_id);
  if (!project || !toBoolean_(project.active)) throw new Error('โครงการที่เลือกไม่พร้อมใช้งาน');
  if (!company || !toBoolean_(company.active)) throw new Error('บริษัทที่เลือกไม่พร้อมใช้งาน');
  if (toNumber_(session.received_pages) !== toNumber_(session.expected_pages)) {
    throw new Error('จำนวนรูปยังไม่ครบตามที่ระบุ');
  }
  const geminiStatus = diagnoseGeminiIntegration();
  if (!geminiStatus.valid) {
    updateObjectById_(SHEETS.SESSIONS, 'session_id', session.session_id, { status: 'AWAITING_COMPANY', updated_at: nowIso_() });
    replyLine_(replyToken, [{
      type: 'text',
      text: 'ยังวิเคราะห์ไม่ได้: ' + geminiStatus.message
        + '\n\nกรุณาแก้ GEMINI_API_KEY แล้วกดตัวเลือกเดิมอีกครั้ง โดยไม่ต้องส่งรูปใหม่',
    }]);
    return;
  }
  moveSessionFilesToProject_(session.session_id, project.project_name);
  updateObjectById_(SHEETS.SESSIONS, 'session_id', session.session_id, { status: 'PROCESSING', updated_at: nowIso_() });
  replyLine_(replyToken, [{ type: 'text', text: 'รับข้อมูลครบแล้ว กำลังให้ Gemini อ่านบิล กรุณารอสักครู่…' }]);
  try {
    const bill = processStoredLineSession_(session.session_id);
    pushLine_(cleanString_(session.source_context_id) || userId, [buildBillConfirmationFlex(bill.bill_id, getLiffUrl_())]);
  } catch (error) {
    updateObjectById_(SHEETS.SESSIONS, 'session_id', session.session_id, { status: 'ERROR', updated_at: nowIso_() });
    pushLine_(cleanString_(session.source_context_id) || userId, [{
      type: 'text',
      text: 'วิเคราะห์บิลไม่สำเร็จ: ' + cleanString_(error.message || error, 300)
        + '\n\nกรุณาตรวจการตั้งค่า แล้วส่งรูปใหม่อีกครั้ง',
    }]);
  }
}

function createLineSession_(userId, contextId) {
  const timestamp = nowIso_();
  const session = {
    session_id: uuid_(), project_id: '', company_id: '', expected_pages: 0, received_pages: 0,
    status: 'AWAITING_PAGE_COUNT', source: 'LINE', source_user_id: userId, source_context_id: cleanString_(contextId), created_at: timestamp,
    expires_at: Utilities.formatDate(new Date(Date.now() + APP_CONFIG.SESSION_HOURS * 3600000), APP_CONFIG.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    updated_at: timestamp,
  };
  appendObject_(SHEETS.SESSIONS, session);
  return session;
}

function findActiveLineSession_(userId, contextId) {
  const activeStatuses = ['AWAITING_PAGE_COUNT', 'COLLECTING_PAGES', 'AWAITING_PROJECT', 'AWAITING_COMPANY', 'PROCESSING'];
  return getRows_(SHEETS.SESSIONS)
    .filter(function (row) {
      const sameContext = !cleanString_(contextId) || cleanString_(row.source_context_id) === cleanString_(contextId);
      return row.source === 'LINE' && row.source_user_id === userId && sameContext && activeStatuses.indexOf(row.status) >= 0 && cleanString_(row.expires_at) > nowIso_();
    })
    .sort(function (a, b) { return cleanString_(b.created_at).localeCompare(cleanString_(a.created_at)); })[0] || null;
}

function requireUserSession_(sessionId, userId, contextId) {
  const session = findById_(SHEETS.SESSIONS, 'session_id', sessionId);
  if (!session || session.source_user_id !== userId) throw new Error('ไม่พบรายการหรือรายการหมดอายุ');
  if (cleanString_(contextId) && cleanString_(session.source_context_id) !== cleanString_(contextId)) throw new Error('รายการนี้อยู่คนละห้องสนทนา');
  const actionable = ['AWAITING_PAGE_COUNT', 'COLLECTING_PAGES', 'AWAITING_PROJECT', 'AWAITING_COMPANY'];
  if (actionable.indexOf(cleanString_(session.status)) < 0 || cleanString_(session.expires_at) <= nowIso_()) {
    throw new Error('รายการนี้ดำเนินการไปแล้วหรือหมดอายุ กรุณาส่งรูปใหม่');
  }
  return session;
}

function cancelLineSession_(userId, contextId) {
  const session = findActiveLineSession_(userId, contextId);
  if (session) {
    updateObjectById_(SHEETS.SESSIONS, 'session_id', session.session_id, { status: 'CANCELLED', updated_at: nowIso_() });
    return { cancelled: true, message: 'ยกเลิกรายการที่กำลังทำแล้ว ส่งรูปใหม่ได้เลยครับ' };
  }
  const sessions = getRows_(SHEETS.SESSIONS)
    .filter(function (row) { return row.source === 'LINE' && row.source_user_id === userId; })
    .sort(function (a, b) { return cleanString_(b.created_at).localeCompare(cleanString_(a.created_at)); });
  for (let index = 0; index < sessions.length; index += 1) {
    const bill = getRows_(SHEETS.BILLS).find(function (row) {
      return row.session_id === sessions[index].session_id && ['NEEDS_REVIEW', 'PENDING_CONFIRMATION'].indexOf(row.status) >= 0;
    });
    if (bill) {
      const result = rejectBill(bill.bill_id, userId);
      if (!result.ok) throw new Error(result.error);
      updateObjectById_(SHEETS.SESSIONS, 'session_id', sessions[index].session_id, { status: 'CANCELLED', updated_at: nowIso_() });
      return { cancelled: true, message: 'ยกเลิกบิลที่รอตรวจสอบแล้ว ส่งรูปใหม่ได้เลยครับ' };
    }
  }
  return { cancelled: false, message: 'ไม่พบรายการที่กำลังทำหรือบิลที่รอตรวจสอบครับ' };
}

function getLineInboxFolder_(userId) {
  const inbox = getOrCreateChildFolder_(getRootFolder_(), '_LINE_INBOX');
  return getOrCreateChildFolder_(inbox, sanitizeFolderName_(userId));
}

function saveLineImageToSession_(session, messageId, pageNo) {
  const blob = getLineMessageContent_(messageId);
  const extension = blob.getContentType() === 'image/png' ? 'png' : 'jpg';
  const fileName = session.session_id.slice(0, 8) + '_p' + pageNo + '.' + extension;
  blob.setName(fileName);
  const file = getLineInboxFolder_(session.source_user_id).createFile(blob);
  const bytes = blob.getBytes();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
  appendObject_(SHEETS.DOCUMENTS, {
    doc_id: uuid_(), bill_id: '', session_id: session.session_id, page_no: pageNo, file_id: file.getId(),
    file_name: fileName, mime_type: blob.getContentType(), file_url: file.getUrl(), sha256: digest,
    size_bytes: bytes.length, created_at: nowIso_(), original_size_bytes: bytes.length,
    compression: bytes.length > APP_CONFIG.IMAGE_TARGET_BYTES ? 'pending-drive-thumbnail' : 'line-delivery', width: 0, height: 0,
  });
}

function getLineMessageContent_(messageId) {
  const response = UrlFetchApp.fetch('https://api-data.line.me/v2/bot/message/' + encodeURIComponent(messageId) + '/content', {
    method: 'get', headers: { Authorization: 'Bearer ' + getScriptProperty_(PROP_KEYS.LINE_ACCESS_TOKEN, true) }, muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) throw new Error('ดาวน์โหลดรูปจาก LINE ไม่สำเร็จ (' + response.getResponseCode() + ')');
  return response.getBlob();
}

function getLineContextId_(source) {
  return cleanString_(source && (source.groupId || source.roomId), 100);
}

function getLineDisplayName_(userId, contextId) {
  if (!userId) return 'LINE User';
  const cache = CacheService.getScriptCache();
  const cacheKey = 'line_name_' + cleanString_(contextId) + '_' + userId;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  try {
    let profileUrl = 'https://api.line.me/v2/bot/profile/' + encodeURIComponent(userId);
    if (/^C/.test(cleanString_(contextId))) profileUrl = 'https://api.line.me/v2/bot/group/' + encodeURIComponent(contextId) + '/member/' + encodeURIComponent(userId);
    if (/^R/.test(cleanString_(contextId))) profileUrl = 'https://api.line.me/v2/bot/room/' + encodeURIComponent(contextId) + '/member/' + encodeURIComponent(userId);
    const profile = callLineApi_(profileUrl, 'get');
    const displayName = cleanString_(profile.displayName || 'LINE User', 100);
    cache.put(cacheKey, displayName, 21600);
    return displayName;
  } catch (error) {
    console.error('LINE profile: ' + error.message);
    return 'LINE User';
  }
}

function backfillLineUsernames() {
  let updated = 0;
  getRows_(SHEETS.BILLS).forEach(function (bill) {
    const value = cleanString_(bill.source_user_id);
    if (bill.source === 'LINE' && /^U[a-f0-9]{20,}$/i.test(value)) {
      updateObjectById_(SHEETS.BILLS, 'bill_id', bill.bill_id, { source_user_id: getLineDisplayName_(value, bill.source_context_id), updated_at: nowIso_() });
      updated += 1;
    }
  });
  return { updated: updated, message: 'อัปเดตชื่อ LINE แล้ว ' + updated + ' รายการ' };
}

function moveSessionFilesToProject_(sessionId, projectName) {
  const folder = getImageFolder_(projectName, todayIso_());
  getRows_(SHEETS.DOCUMENTS).filter(function (row) { return row.session_id === sessionId; }).forEach(function (doc) {
    try { DriveApp.getFileById(doc.file_id).moveTo(folder); } catch (error) { console.error('Move file: ' + error.message); }
  });
}

function pageCountMessage_(sessionId, received, quickSettings) {
  const quick = quickSettings || getQuickSettings_();
  const quickSlots = configuredQuickSettings_(quick);
  const hasQuick = quickSlots.length > 0;
  const counts = [1, 2, 3, 4, 5, 6, 7, 8].filter(function (count) { return count >= received; });
  const buttons = counts.map(function (count) {
    return {
      type: 'button', height: 'sm', style: !hasQuick && count === 1 ? 'primary' : 'secondary',
      color: !hasQuick && count === 1 ? '#8F5F42' : '#5C4438',
      action: {
        type: 'postback',
        label: count === 1 ? '1 หน้า (ใบเดียว)' : String(count) + ' หน้า',
        data: 'action=set_pages&session_id=' + sessionId + '&pages=' + count,
        displayText: 'บิลนี้มี ' + count + ' หน้า',
      },
    };
  });
  const rows = [];
  for (let index = 0; index < buttons.length; index += 2) {
    rows.push({ type: 'box', layout: 'horizontal', spacing: 'sm', contents: buttons.slice(index, index + 2) });
  }
  const bodyContents = [
    { type: 'box', layout: 'vertical', backgroundColor: '#F7EDE1', cornerRadius: '10px', paddingAll: '12px', contents: [
      { type: 'text', text: 'บิลทั่วไปเลือก “1 หน้า (ใบเดียว)”', color: '#795442', size: 'xs', wrap: true },
      { type: 'text', text: 'หากเป็นเอกสารต่อเนื่องหลายหน้า ให้เลือกจำนวนหน้ารวมทั้งหมด', color: '#8A776B', size: 'xxs', wrap: true, margin: 'sm' },
    ] },
  ];
  if (hasQuick) {
    quickSlots.forEach(function (slot, index) {
      if (index > 0) bodyContents.push({ type: 'separator', color: '#E7D9CA', margin: 'lg' });
      bodyContents.push(
      { type: 'box', layout: 'vertical', backgroundColor: '#F3E7D8', borderColor: '#D7B891', borderWidth: '1px', cornerRadius: '12px', paddingAll: '14px', margin: 'md', contents: [
        { type: 'text', text: '⚡ ' + slot.label, color: '#754631', weight: 'bold', size: 'sm' },
        flexQuickSettingRow_('จำนวนหน้า', slot.page_count + ' หน้า'),
        flexQuickSettingRow_('โครงการ', slot.project_name),
        flexQuickSettingRow_('บริษัท', slot.company_name),
      ] },
      { type: 'button', height: 'md', style: index === 0 ? 'primary' : 'secondary', color: '#8F5F42', margin: 'md', action: {
        type: 'postback',
        label: 'ใช้' + slot.label,
        data: 'action=use_quick_settings&session_id=' + sessionId + '&slot=' + slot.slot,
        displayText: 'ใช้' + slot.label + ' สำหรับบิลนี้',
      } });
    });
    bodyContents.push(
      { type: 'separator', color: '#E7D9CA', margin: 'xl' },
      { type: 'text', text: 'หรือกำหนดจำนวนหน้าเอง', color: '#795442', weight: 'bold', size: 'xs', margin: 'lg' }
    );
  }
  return {
    type: 'flex', altText: hasQuick ? 'เลือกค่าลัดหรือกำหนดจำนวนหน้าบิล' : 'เลือกจำนวนหน้าของบิล',
    contents: {
      type: 'bubble', size: 'kilo',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#2D211C', paddingAll: '22px', contents: [
        { type: 'text', text: 'เตรียมอ่านบิลด้วย AI', color: '#D6B77A', weight: 'bold', size: 'xs' },
        { type: 'text', text: hasQuick ? 'เลือกวิธีรับบิล' : 'บิลชุดนี้มีกี่หน้า?', color: '#FFFFFF', weight: 'bold', size: 'xl', margin: 'md' },
        { type: 'text', text: hasQuick ? 'ใช้ค่าลัดเพื่อข้ามการเลือกโครงการและบริษัท' : 'เลือกจำนวนหน้าของเอกสารชุดเดียวกัน', color: '#D8C8BB', size: 'sm', margin: 'sm', wrap: true },
      ] },
      body: { type: 'box', layout: 'vertical', backgroundColor: '#FFFDF9', paddingAll: '20px', spacing: 'sm', contents: bodyContents.concat(rows) },
    },
  };
}

function flexQuickSettingRow_(label, value) {
  return { type: 'box', layout: 'horizontal', margin: 'sm', spacing: 'md', contents: [
    { type: 'text', text: cleanString_(label), color: '#8A776B', size: 'xxs', flex: 2 },
    { type: 'text', text: cleanString_(value || '-'), color: '#4B372F', size: 'xxs', weight: 'bold', align: 'end', wrap: true, flex: 4 },
  ] };
}

function projectSelectionMessage_(sessionId) {
  const projects = publicRows_(SHEETS.PROJECTS).filter(function (row) { return toBoolean_(row.active); });
  const items = projects.slice(0, 12).map(function (project) {
    return postbackQuickAction_(cleanString_(project.project_name, 20), 'action=select_project&session_id=' + sessionId + '&project_id=' + project.project_id, 'เลือกโครงการ ' + cleanString_(project.project_name, 40));
  });
  if (projects.length > 12 && getLiffUrl_()) items.push(uriQuickAction_('ดูทั้งหมด', getLiffUrl_()));
  return quickReplyMessage_('ได้รับรูปครบแล้ว กรุณาเลือกโครงการ', items);
}

function companySelectionMessage_(sessionId) {
  const companies = publicRows_(SHEETS.COMPANIES).filter(function (row) { return toBoolean_(row.active); });
  return quickReplyMessage_('เลือกชื่อบริษัทผู้ซื้อที่บิลควรระบุ', companies.slice(0, 13).map(function (company) {
    return postbackQuickAction_(cleanString_(company.company_name, 20), 'action=select_company&session_id=' + sessionId + '&company_id=' + company.company_id, 'เลือก ' + cleanString_(company.company_name, 35));
  }));
}

function quickReplyMessage_(text, items) {
  return { type: 'text', text: text, quickReply: { items: items } };
}

function postbackQuickAction_(label, data, displayText) {
  return { type: 'action', action: { type: 'postback', label: cleanString_(label, 20), data: data, displayText: cleanString_(displayText, 300) } };
}

function uriQuickAction_(label, uri) {
  return { type: 'action', action: { type: 'uri', label: cleanString_(label, 20), uri: uri } };
}

function parseQueryString_(text) {
  return cleanString_(text).split('&').reduce(function (result, pair) {
    const index = pair.indexOf('=');
    if (index >= 0) result[decodeURIComponent(pair.slice(0, index))] = decodeURIComponent(pair.slice(index + 1));
    return result;
  }, {});
}

function isDuplicateLineEvent_(eventId) {
  if (!eventId) return false;
  const cache = CacheService.getScriptCache();
  const key = 'line_event_' + eventId;
  if (cache.get(key)) return true;
  cache.put(key, 'processing', 600);
  return false;
}

function completeLineEvent_(eventId) {
  if (eventId) CacheService.getScriptCache().put('line_event_' + eventId, 'complete', 21600);
}

function replyLine_(replyToken, messages) {
  if (!replyToken) return;
  callLineApi_('https://api.line.me/v2/bot/message/reply', 'post', { replyToken: replyToken, messages: messages.slice(0, 5) });
}

function pushLine_(userId, messages) {
  callLineApi_('https://api.line.me/v2/bot/message/push', 'post', { to: userId, messages: messages.slice(0, 5) });
}

function callLineApi_(url, method, payload) {
  const options = {
    method: method || 'get', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + getScriptProperty_(PROP_KEYS.LINE_ACCESS_TOKEN, true) },
    muteHttpExceptions: true,
  };
  if (payload) options.payload = JSON.stringify(payload);
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('LINE API ' + code + ': ' + cleanString_(response.getContentText(), 500));
  const text = response.getContentText();
  return text ? JSON.parse(text) : {};
}

function getLiffUrl_() {
  const value = getScriptProperty_(PROP_KEYS.LIFF_ID, false) || APP_CONFIG.DEFAULT_LIFF_ID;
  if (!value) return '';
  if (/^https:\/\/liff\.line\.me\//i.test(value)) return value;
  return 'https://liff.line.me/' + value.replace(/^\/+|\/+$/g, '');
}

function getLiffId_() {
  const value = getScriptProperty_(PROP_KEYS.LIFF_ID, false) || APP_CONFIG.DEFAULT_LIFF_ID;
  const match = value.match(/^https:\/\/liff\.line\.me\/([^/?#]+)/i);
  return match ? match[1] : cleanString_(value).replace(/^\/+|\/+$/g, '');
}

function getFrontendAppUrl_() {
  const liffUrl = getLiffUrl_();
  if (liffUrl) return liffUrl;
  return getScriptProperty_(PROP_KEYS.FRONTEND_URL, true);
}

function appendUrlParams_(url, params) {
  const base = cleanString_(url, 2000);
  if (!base) throw new Error('ยังไม่ได้ตั้ง FRONTEND_URL หรือ LIFF_ID');
  const separator = base.indexOf('?') >= 0 ? '&' : '?';
  const query = Object.keys(params || {}).map(function (key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
  }).join('&');
  return base + separator + query;
}
