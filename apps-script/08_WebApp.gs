function getBootstrapData(filters) {
  try {
    setupIfNeeded_();
    migrateLegacyTransactionsIfNeeded_();
    linkLegacyImagesIfNeeded_();
    const masters = listMasterData();
    const dashboard = getDashboard(filters || {});
    if (!masters.ok) throw new Error(masters.error);
    if (!dashboard.ok) throw new Error(dashboard.error);
    return ok_(toClientSafe_({
      app: { name: APP_CONFIG.APP_NAME, version: APP_CONFIG.VERSION, model: APP_CONFIG.GEMINI_MODEL, maxPages: APP_CONFIG.MAX_PAGES_PER_BILL },
      masters: masters.data,
      dashboard: dashboard.data,
      pendingReviews: getPendingReviewRows_(),
      quickSettings: getQuickSettings_(),
    }));
  } catch (error) { return fail_(error); }
}

function toClientSafe_(value) {
  return JSON.parse(JSON.stringify(value, function (key, item) {
    if (item instanceof Date) return Utilities.formatDate(item, APP_CONFIG.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
    return item === undefined ? null : item;
  }));
}

function getSystemStatus() {
  try {
    const spreadsheet = getSpreadsheet_();
    const folder = getRootFolder_();
    const lineDiagnostics = diagnoseLineIntegration();
    const geminiDiagnostics = diagnoseGeminiIntegration();
    return ok_({
      spreadsheet: spreadsheet.getName(), folder: folder.getName(), folderUrl: folder.getUrl(),
      geminiConfigured: !!getScriptProperty_(PROP_KEYS.GEMINI_API_KEY, false),
      lineConfigured: !!getScriptProperty_(PROP_KEYS.LINE_ACCESS_TOKEN, false),
      model: APP_CONFIG.GEMINI_MODEL, version: APP_CONFIG.VERSION,
      frontendUrl: getScriptProperty_(PROP_KEYS.FRONTEND_URL, false),
      lineDiagnostics: lineDiagnostics, geminiDiagnostics: geminiDiagnostics,
    });
  } catch (error) { return fail_(error); }
}

function verifyDatabaseAccess() {
  try {
    return ok_({ url: getSpreadsheet_().getUrl() });
  } catch (error) { return fail_(error); }
}

function sha256Hex_(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    cleanString_(value),
    Utilities.Charset.UTF_8
  ).map(function (byte) {
    return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join('');
}
