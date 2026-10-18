/**
 * Google Apps Script for Admin Application Form Backend
 * 
 * SETUP INSTRUCTIONS:
 * 1. Create a new Google Sheet
 * 2. Add the following headers in row 1:
 *    Application ID | Date | Time | Full Name | Aadhaar Number | PAN Number | Date of Birth | Amount | Payment Status | Payment Reference | Created By
 * 3. Go to Extensions > Apps Script
 * 4. Copy this entire code into the script editor
 * 5. Deploy as Web App:
 *    - Execute as: Me
 *    - Who has access: Anyone (for prototype) or Only myself (for production)
 * 6. Copy the Web App URL and paste it into app.js where it says:
 *    const GOOGLE_SCRIPT_URL = 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE';
 * 7. IMPORTANT: Restrict Google Sheet access in production
 */

// Sheet name where data will be stored
const SHEET_NAME = 'Applications';

/**
 * Handle GET requests (for testing)
 */
function doGet(e) {
    return handleRequest(e);
}

/**
 * Handle POST requests (from the application form)
 */
function doPost(e) {
    return handleRequest(e);
}

/**
 * Main request handler
 */
function handleRequest(e) {
    const lock = LockService.getScriptLock();
    
    try {
        // Wait for lock (max 10 seconds)
        lock.waitLock(10000);
        
        // Parse the request data
        let data;
        if (e && e.postData && e.postData.contents) {
            data = JSON.parse(e.postData.contents);
        } else if (e && e.parameter) {
            data = e.parameter;
        } else {
            return createResponse({
                success: false,
                message: 'No data received'
            });
        }
        
        // Validate required fields
        if (!data.applicationId || !data.fullName || !data.aadhaarNumber || !data.panNumber) {
            return createResponse({
                success: false,
                message: 'Missing required fields'
            });
        }
        
        // Get or create the sheet
        const sheet = getOrCreateSheet();
        
        // Check if application already exists (for updates)
        const existingRow = findApplicationById(sheet, data.applicationId);
        
        if (existingRow) {
            // Update existing application
            updateApplication(sheet, existingRow, data);
        } else {
            // Add new application
            addApplication(sheet, data);
        }
        
        return createResponse({
            success: true,
            message: 'Application saved successfully',
            applicationId: data.applicationId
        });
        
    } catch (error) {
        console.error('Error:', error);
        return createResponse({
            success: false,
            message: error.toString()
        });
    } finally {
        lock.releaseLock();
    }
}

/**
 * Get or create the applications sheet
 */
function getOrCreateSheet() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    
    if (!sheet) {
        sheet = ss.insertSheet(SHEET_NAME);
        // Add headers
        sheet.appendRow([
            'Application ID',
            'Date',
            'Time',
            'Full Name',
            'Aadhaar Number',
            'PAN Number',
            'Date of Birth',
            'Amount',
            'Payment Status',
            'Payment Reference',
            'Created By',
            'Timestamp'
        ]);
        
        // Format header row
        sheet.getRange(1, 1, 1, 12).setFontWeight('bold').setBackground('#2563eb').setFontColor('#ffffff');
        
        // Freeze header row
        sheet.setFrozenRows(1);
    }
    
    return sheet;
}

/**
 * Find application by ID
 */
function findApplicationById(sheet, applicationId) {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;
    
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    
    for (let i = 0; i < ids.length; i++) {
        if (ids[i][0] === applicationId) {
            return i + 2; // Return row number (1-indexed)
        }
    }
    
    return null;
}

/**
 * Add new application
 */
function addApplication(sheet, data) {
    sheet.appendRow([
        data.applicationId,
        data.date,
        data.time,
        data.fullName,
        data.aadhaarNumber,
        data.panNumber,
        data.dateOfBirth,
        data.amount,
        data.paymentStatus,
        data.paymentTimestamp || '',
        data.createdBy,
        new Date().toISOString()
    ]);
}

/**
 * Update existing application
 */
function updateApplication(sheet, rowNum, data) {
    sheet.getRange(rowNum, 1, 1, 12).setValues([[
        data.applicationId,
        data.date,
        data.time,
        data.fullName,
        data.aadhaarNumber,
        data.panNumber,
        data.dateOfBirth,
        data.amount,
        data.paymentStatus,
        data.paymentTimestamp || '',
        data.createdBy,
        new Date().toISOString()
    ]]);
}

/**
 * Create JSON response
 */
function createResponse(data) {
    return ContentService
        .createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Get all applications (for dashboard)
 * Note: This would need proper authentication in production
 */
function getApplications() {
    const sheet = getOrCreateSheet();
    const lastRow = sheet.getLastRow();
    
    if (lastRow < 2) {
        return createResponse({
            success: true,
            applications: []
        });
    }
    
    const data = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
    
    const applications = data.map(row => ({
        applicationId: row[0],
        date: row[1],
        time: row[2],
        fullName: row[3],
        aadhaarNumber: row[4],
        panNumber: row[5],
        dateOfBirth: row[6],
        amount: row[7],
        paymentStatus: row[8],
        paymentTimestamp: row[9],
        createdBy: row[10],
        timestamp: row[11]
    }));
    
    return createResponse({
        success: true,
        applications: applications
    });
}

/**
 * Get application by ID
 */
function getApplicationById(applicationId) {
    const sheet = getOrCreateSheet();
    const rowNum = findApplicationById(sheet, applicationId);
    
    if (!rowNum) {
        return createResponse({
            success: false,
            message: 'Application not found'
        });
    }
    
    const row = sheet.getRange(rowNum, 1, 1, 12).getValues()[0];
    
    const application = {
        applicationId: row[0],
        date: row[1],
        time: row[2],
        fullName: row[3],
        aadhaarNumber: row[4],
        panNumber: row[5],
        dateOfBirth: row[6],
        amount: row[7],
        paymentStatus: row[8],
        paymentTimestamp: row[9],
        createdBy: row[10],
        timestamp: row[11]
    };
    
    return createResponse({
        success: true,
        application: application
    });
}

/**
 * Delete application by ID
 */
function deleteApplicationById(applicationId) {
    const sheet = getOrCreateSheet();
    const rowNum = findApplicationById(sheet, applicationId);
    
    if (!rowNum) {
        return createResponse({
            success: false,
            message: 'Application not found'
        });
    }
    
    sheet.deleteRow(rowNum);
    
    return createResponse({
        success: true,
        message: 'Application deleted successfully'
    });
}

/**
 * Get dashboard statistics
 */
function getStatistics() {
    const sheet = getOrCreateSheet();
    const lastRow = sheet.getLastRow();
    
    if (lastRow < 2) {
        return createResponse({
            success: true,
            stats: {
                totalApplications: 0,
                pendingPayments: 0,
                paidApplications: 0,
                totalAmount: 0
            }
        });
    }
    
    const data = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
    
    let totalApplications = data.length;
    let pendingPayments = 0;
    let paidApplications = 0;
    let totalAmount = 0;
    
    data.forEach(row => {
        const paymentStatus = row[8];
        const amount = row[7];
        
        if (paymentStatus === 'Pending') {
            pendingPayments++;
        } else if (paymentStatus === 'Paid') {
            paidApplications++;
            totalAmount += amount;
        }
    });
    
    return createResponse({
        success: true,
        stats: {
            totalApplications,
            pendingPayments,
            paidApplications,
            totalAmount
        }
    });
}

/**
 * SECURITY NOTES FOR PRODUCTION:
 * 
 * 1. Add authentication to protect the endpoints:
 *    - Use Google Apps Script's Session.getActiveUser()
 *    - Implement API key validation
 *    - Add OAuth2 authentication
 * 
 * 2. Restrict access to the Google Sheet:
 *    - Only allow specific email addresses
 *    - Use domain restrictions if applicable
 * 
 * 3. Add rate limiting to prevent abuse
 * 
 * 4. Implement data validation on the server side
 * 
 * 5. Add logging for audit trails
 * 
 * 6. Consider using a proper database for production
 *    - Firebase
 *    - PostgreSQL
 *    - MongoDB
 *    - Or other secure database solutions
 * 
 * 7. Never expose sensitive data in API responses
 *    - Mask Aadhaar numbers in responses
 *    - Mask PAN numbers in responses
 *    - Only return full data to authenticated admins
 * 
 * 8. Use HTTPS in production
 * 
 * 9. Implement proper error handling and logging
 * 
 * 10. Regular security audits and updates
 */
