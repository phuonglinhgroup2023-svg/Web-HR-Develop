/*
 * Recruitment Story - Candidate application storage
 *
 * Deploy as a Web app:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * This script receives the application payload from the website, stores the
 * uploaded CV in Google Drive, and appends the application data to Google Sheet.
 */
var CONFIG = {
  driveFolderId: '',
  spreadsheetId: '',
  driveFolderName: 'Recruitment Story - CV ung vien',
  spreadsheetName: 'Recruitment Story - Ho so ung vien',
  sheetName: 'Ho so ung vien',
  maxFileBytes: 5 * 1024 * 1024
};

var HEADERS = [
  'Thoi gian nop',
  'Vi tri ung tuyen',
  'Dia diem mong muon',
  'Thu gioi thieu',
  'Dong y phan tich AI',
  'Dong y dieu khoan',
  'Ten file CV',
  'Link CV tren Drive',
  'ID file CV'
];

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: 'Missing request body' });
    }

    var body = JSON.parse(e.postData.contents);
    validatePayload(body);

    var bytes = Utilities.base64Decode(body.fileData);
    if (bytes.length > CONFIG.maxFileBytes) {
      return jsonResponse({ ok: false, error: 'File is larger than 5MB' });
    }

    var folder = getOrCreateCvFolder();
    var fileName = buildCvFileName(body.fileName);
    var blob = Utilities.newBlob(
      bytes,
      body.fileMimeType || 'application/octet-stream',
      fileName
    );
    var cvFile = folder.createFile(blob);

    var spreadsheet = getOrCreateApplicationsSpreadsheet();
    var sheet = getOrCreateSheet(spreadsheet);
    sheet.appendRow([
      new Date(),
      body.job_title || '',
      body.preferred_location || '',
      body.cover_letter || '',
      body.ai_consent === true ? 'Co' : 'Khong',
      body.terms_accepted === true ? 'Co' : 'Khong',
      body.fileName || fileName,
      cvFile.getUrl(),
      cvFile.getId()
    ]);

    return jsonResponse({
      ok: true,
      service: 'recruitment-story-applications',
      fileUrl: cvFile.getUrl(),
      spreadsheetUrl: spreadsheet.getUrl()
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      service: 'recruitment-story-applications',
      error: String(error && error.message || error)
    });
  }
}

function doGet() {
  try {
    var folder = getOrCreateCvFolder();
    var spreadsheet = getOrCreateApplicationsSpreadsheet();
    getOrCreateSheet(spreadsheet);

    return jsonResponse({
      ok: true,
      service: 'recruitment-story-applications',
      driveFolderUrl: folder.getUrl(),
      spreadsheetUrl: spreadsheet.getUrl()
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      service: 'recruitment-story-applications',
      error: String(error && error.message || error)
    });
  }
}

function validatePayload(body) {
  if (!body.fileName || !body.fileData) {
    throw new Error('fileName and fileData are required');
  }
  if (!body.terms_accepted) {
    throw new Error('terms_accepted is required');
  }
}

function getOrCreateCvFolder() {
  if (CONFIG.driveFolderId) {
    return DriveApp.getFolderById(CONFIG.driveFolderId);
  }

  var properties = PropertiesService.getScriptProperties();
  var storedId = properties.getProperty('CV_FOLDER_ID');
  if (storedId) {
    try {
      return DriveApp.getFolderById(storedId);
    } catch (error) {
      properties.deleteProperty('CV_FOLDER_ID');
    }
  }

  var folder = DriveApp.createFolder(CONFIG.driveFolderName);
  properties.setProperty('CV_FOLDER_ID', folder.getId());
  return folder;
}

function getOrCreateApplicationsSpreadsheet() {
  if (CONFIG.spreadsheetId) {
    return SpreadsheetApp.openById(CONFIG.spreadsheetId);
  }

  var properties = PropertiesService.getScriptProperties();
  var storedId = properties.getProperty('APPLICATIONS_SPREADSHEET_ID');
  if (storedId) {
    try {
      return SpreadsheetApp.openById(storedId);
    } catch (error) {
      properties.deleteProperty('APPLICATIONS_SPREADSHEET_ID');
    }
  }

  var spreadsheet = SpreadsheetApp.create(CONFIG.spreadsheetName);
  properties.setProperty('APPLICATIONS_SPREADSHEET_ID', spreadsheet.getId());
  return spreadsheet;
}

function getOrCreateSheet(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(CONFIG.sheetName);
  if (!sheet) {
    var sheets = spreadsheet.getSheets();
    var firstSheet = sheets[0];
    var isFirstSheetEmpty = firstSheet.getLastRow() === 0 && firstSheet.getLastColumn() === 0;
    sheet = sheets.length === 1 && isFirstSheetEmpty
      ? firstSheet.setName(CONFIG.sheetName)
      : spreadsheet.insertSheet(CONFIG.sheetName);
  }

  ensureHeaderRow(sheet);
  return sheet;
}

function ensureHeaderRow(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    return;
  }

  var existingHeaders = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  var hasHeaders = existingHeaders.some(function(value) {
    return String(value || '').trim() !== '';
  });

  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
}

function buildCvFileName(originalName) {
  var safeName = String(originalName || 'cv')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  return timestamp + '-' + safeName;
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
