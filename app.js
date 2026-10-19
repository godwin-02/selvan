// ============================================================
// Application State
// ============================================================
let applications = [];
let editingApplicationId = null;
let aadhaarFile = null;  // Actual File/Blob — used for OCR and upload
let panFile = null;       // Actual File/Blob — used for OCR and upload

// Scan request IDs — prevent stale OCR results from overwriting newer ones
let aadhaarScanId = 0;
let panScanId = 0;

// ============================================================
// UPI Configuration
// ============================================================
const UPI_CONFIG = {
    pa: '9789051375@axl',
    pn: 'DENNI MUTHU',
    cu: 'INR',
    tn: 'Application Payment'
};

// Google Apps Script URL (Replace with your actual deployment URL)
const GOOGLE_SCRIPT_URL = 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE';

// ============================================================
// DOM Elements
// ============================================================
const dashboardScreen = document.getElementById('dashboardScreen');
const formScreen = document.getElementById('formScreen');
const viewModal = document.getElementById('viewModal');
const paymentModal = document.getElementById('paymentModal');

// ============================================================
// Debug Logging — non-sensitive technical info only
// ============================================================
const DEBUG_OCR = true;

function logDebug(message, data) {
    if (!DEBUG_OCR) return;
    if (data !== undefined) {
        console.log('[OCR Debug]', message, data);
    } else {
        console.log('[OCR Debug]', message);
    }
}

// ============================================================
// Initialize
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    loadApplications();
    setupEventListeners();
    showForm();
});

// ============================================================
// Screen Management
// ============================================================
function showDashboard() {
    dashboardScreen.classList.remove('hidden');
    formScreen.classList.add('hidden');
    updateDashboardStats();
    renderApplicationsList();
}

function showForm() {
    dashboardScreen.classList.add('hidden');
    formScreen.classList.remove('hidden');
    resetForm();
}

// ============================================================
// Event Listeners
// ============================================================
function setupEventListeners() {
    // Dashboard
    document.getElementById('newAppBtn').addEventListener('click', showForm);
    document.getElementById('searchInput').addEventListener('input', filterApplications);
    document.getElementById('statusFilter').addEventListener('change', filterApplications);
    document.getElementById('dateFilter').addEventListener('change', filterApplications);

    // Form Navigation
    document.getElementById('backToDashboard').addEventListener('click', () => {
        showDashboard();
        editingApplicationId = null;
    });

    // Photo Upload + auto-OCR on capture
    setupPhotoUpload(
        'aadhaarPhoto', 'aadhaarPhotoPlaceholder', 'aadhaarPhotoPreview',
        'aadhaarPreviewImg', 'retakeAadhaar', 'aadhaar'
    );
    setupPhotoUpload(
        'panPhoto', 'panPhotoPlaceholder', 'panPhotoPreview',
        'panPreviewImg', 'retakePan', 'pan'
    );

    // Scan buttons — if file already loaded run OCR immediately,
    // otherwise open the camera/file picker and OCR will auto-start on capture
    document.getElementById('scanAadhaarBtn').addEventListener('click', () => {
        if (aadhaarFile) {
            processDocument(aadhaarFile, 'aadhaar');
        } else {
            // Trigger the file input; OCR fires automatically in the change handler
            document.getElementById('aadhaarPhoto').click();
        }
    });

    document.getElementById('scanPanBtn').addEventListener('click', () => {
        if (panFile) {
            processDocument(panFile, 'pan');
        } else {
            document.getElementById('panPhoto').click();
        }
    });

    // UPI Payment
    const payNowBtn = document.getElementById('payNowBtn');
    if (payNowBtn) payNowBtn.addEventListener('click', showPaymentModal);
    document.getElementById('closePaymentModal').addEventListener('click', closePaymentModal);
    document.getElementById('openUpiAppBtn').addEventListener('click', openUpiApp);
    paymentModal.addEventListener('click', (e) => {
        if (e.target === paymentModal) closePaymentModal();
    });

    // Form Submission
    document.getElementById('applicationForm').addEventListener('submit', handleFormSubmit);

    // Modal
    document.getElementById('closeModal').addEventListener('click', closeModal);
    viewModal.addEventListener('click', (e) => {
        if (e.target === viewModal) closeModal();
    });

    // Input Formatting
    document.getElementById('aadhaarNumber').addEventListener('input', formatAadhaar);
    document.getElementById('panNumber').addEventListener('input', formatPAN);

    // Dynamic QR if payment modal is open
    document.getElementById('amount').addEventListener('input', () => {
        if (!paymentModal.classList.contains('hidden')) {
            const amount = document.getElementById('amount').value;
            if (amount && parseFloat(amount) > 0) {
                document.getElementById('paymentModalAmount').textContent =
                    `₹${parseFloat(amount).toLocaleString('en-IN')}`;
                generateQrCode(generateUpiUri(amount));
            }
        }
    });
}

// ============================================================
// Photo Upload Setup
// Stores the actual File/Blob and immediately auto-starts OCR
// ============================================================
function setupPhotoUpload(inputId, placeholderId, previewId, imgId, retakeBtnId, docType) {
    const input       = document.getElementById(inputId);
    const placeholder = document.getElementById(placeholderId);
    const preview     = document.getElementById(previewId);
    const img         = document.getElementById(imgId);
    const retakeBtn   = document.getElementById(retakeBtnId);

    if (!input || !placeholder || !preview || !img || !retakeBtn) {
        console.error('Photo upload setup failed — missing elements', { inputId });
        return;
    }

    // Clicking the placeholder or the retake button triggers the native file/camera picker
    placeholder.addEventListener('click', () => input.click());
    retakeBtn.addEventListener('click', () => {
        // Clear current file so a retake truly replaces it
        if (docType === 'aadhaar') aadhaarFile = null;
        else panFile = null;
        input.value = '';   // reset so same file can be re-selected
        input.click();
    });

    // ──────────────────────────────────────────────────────────
    // THE CORE FIX: change event captures the real File/Blob
    // and immediately starts the unified OCR pipeline
    // ──────────────────────────────────────────────────────────
    input.addEventListener('change', async (e) => {
        const rawFile = e.target.files && e.target.files[0];

        logDebug('Camera/picker change event fired', {
            fileReceived: !!rawFile,
            type: rawFile ? rawFile.type : 'none',
            size: rawFile ? rawFile.size : 0,
            isFileInstance: rawFile instanceof File
        });

        if (!rawFile) {
            // User cancelled or camera dismissed — do nothing silently
            logDebug('No file — camera was likely cancelled');
            return;
        }

        // Validate before doing anything else
        if (rawFile.size === 0) {
            showOcrMessage(docType, 'Unable to process the captured image. Please retake the photo.', 'error');
            return;
        }

        // Normalise: some browsers return a Blob rather than a File
        const file = (rawFile instanceof File)
            ? rawFile
            : new File([rawFile], `${docType}-document.jpg`, { type: rawFile.type || 'image/jpeg' });

        // Store the ACTUAL File/Blob in application state
        if (docType === 'aadhaar') {
            aadhaarFile = file;
            logDebug('Stored aadhaarFile', { type: file.type, size: file.size });
        } else {
            panFile = file;
            logDebug('Stored panFile', { type: file.type, size: file.size });
        }

        // Show preview using an Object URL (separate from the file itself)
        const previewUrl = URL.createObjectURL(file);
        img.src = previewUrl;
        img.onload = () => URL.revokeObjectURL(previewUrl); // free memory after load
        placeholder.classList.add('hidden');
        preview.classList.remove('hidden');

        showOcrMessage(docType, 'Document captured. Reading document…', 'info');

        // ── AUTO-START OCR immediately after capture ──
        await processDocument(file, docType);
    });
}

// ============================================================
// UNIFIED DOCUMENT PROCESSING PIPELINE
// ── Memory-safe sequential design ──
//
// OLD (broken on mobile): 4 canvases × 16 MB each = ~150 MB peak
// NEW: 1 reused canvas, processed and freed before next attempt
//
// Pipeline per scan attempt:
//   File → ImageBitmap → ONE canvas (scaled) → Blob → OCR
//   If confidence OK → done, canvas freed
//   If not → reuse same canvas, apply next filter → Blob → OCR
// ============================================================

// OCR processing lock — prevents duplicate concurrent OCR calls
const ocrLock = { aadhaar: false, pan: false };

// Max dimension for OCR canvas — balances text legibility vs memory
// 1600px on longest side ≈ 4 MB canvas buffer vs 48+ MB at full 6K resolution
const MAX_OCR_SIDE = 1600;

// Confidence threshold above which we stop trying more versions
const CONFIDENCE_STOP = 72;

async function processDocument(file, type) {
    logDebug('processDocument called', {
        type,
        fileType: file ? file.type : 'none',
        fileSizeKB: file ? Math.round(file.size / 1024) : 0
    });

    if (!file || file.size === 0) {
        showOcrMessage(type, 'Please capture or upload a photo first.', 'error');
        return;
    }

    // ── Processing lock: cancel duplicate calls ──
    if (ocrLock[type]) {
        logDebug('OCR already running for', type, '— ignoring duplicate call');
        return;
    }
    ocrLock[type] = true;

    // Bump scan ID so any in-flight stale run is discarded
    const scanId = type === 'aadhaar' ? ++aadhaarScanId : ++panScanId;

    showOcrMessage(type, 'Validating image…', 'info');

    // Single reusable canvas — created once, freed at the end
    let canvas = null;
    let ctx    = null;

    try {
        // ── Step 1: Decode image into an ImageBitmap (GPU-decoded, no base64) ──
        let bitmap;
        try {
            bitmap = await createImageBitmap(file);
        } catch (err) {
            logDebug('createImageBitmap failed', err.message);
            showOcrMessage(type, 'Unable to read the captured image. Please retake the photo.', 'error');
            return;
        }

        const srcW = bitmap.width;
        const srcH = bitmap.height;

        if (!srcW || !srcH) {
            bitmap.close();
            showOcrMessage(type, 'Invalid image dimensions. Please retake the photo.', 'error');
            return;
        }

        // ── Step 2: Calculate target dimensions — ONE resize, never upsample ──
        const scale = Math.min(1, MAX_OCR_SIDE / Math.max(srcW, srcH));
        const tW    = Math.round(srcW * scale);
        const tH    = Math.round(srcH * scale);

        logDebug('Image dimensions', {
            original: `${srcW}×${srcH}`,
            target:   `${tW}×${tH}`,
            scale:    scale.toFixed(3),
            originalSizeKB: Math.round(file.size / 1024)
        });

        // ── Step 3: Create ONE canvas at target size ──
        canvas = document.createElement('canvas');
        canvas.width  = tW;
        canvas.height = tH;
        ctx = canvas.getContext('2d');

        // Draw the decoded bitmap into the canvas (scaled down in one pass)
        ctx.drawImage(bitmap, 0, 0, tW, tH);

        // Release the ImageBitmap immediately — no longer needed
        bitmap.close();
        bitmap = null;

        // ── Step 3b: Capture the raw scaled pixels as a snapshot ──
        // We store this once so every OCR attempt can restore a clean
        // version of the image without re-decoding the original file.
        // This avoids createImageBitmap(file, {resize…}) which is
        // NOT supported in Android WebView / mobile Chrome.
        const rawPixels = ctx.getImageData(0, 0, tW, tH);

        // ── Step 4: Check stale scan ──
        if ((type === 'aadhaar' ? aadhaarScanId : panScanId) !== scanId) {
            logDebug('Stale scan after decode, discarding');
            return;
        }

        showOcrMessage(type, 'Reading document…', 'info');

        // ── Step 5: Sequential OCR attempts — ONE blob in memory at a time ──
        // Attempt 1: High-contrast grayscale  — best for Aadhaar/PAN on mobile
        // Attempt 2: Adaptive threshold       — helps with uneven lighting
        // Attempt 3: Raw resized original     — plain fallback
        //
        // For each attempt:
        //   1. Restore clean raw pixels onto the canvas
        //   2. Apply filter in-place (no extra array allocation)
        //   3. canvas.toBlob → OCR
        //   4. Blob goes out of scope → GC-eligible before next attempt

        const attempts = [
            { name: 'highContrast', applyFn: applyHighContrast },
            { name: 'threshold',    applyFn: applyThreshold    },
            { name: 'original',     applyFn: null              }
        ];

        let bestText       = '';
        let bestConfidence = 0;
        let attemptsDone   = 0;

        for (const attempt of attempts) {
            // Guard: bail if a newer scan has started
            if ((type === 'aadhaar' ? aadhaarScanId : panScanId) !== scanId) {
                logDebug('Stale scan mid-loop, discarding');
                return;
            }

            logDebug(`OCR attempt: ${attempt.name}`);

            // Restore clean raw pixels (copy of rawPixels.data into a new ImageData)
            // This overwrites any filter applied in the previous iteration
            const workingData = new ImageData(
                new Uint8ClampedArray(rawPixels.data), tW, tH
            );

            if (attempt.applyFn) {
                attempt.applyFn(workingData.data);
            }

            ctx.putImageData(workingData, 0, 0);
            // workingData is now GC-eligible (canvas has its own copy)

            // Convert canvas to Blob — NO base64, much lower memory
            const blob = await canvasToBlob(canvas, 'image/jpeg', 0.88);

            logDebug(`${attempt.name} blob size: ${Math.round(blob.size / 1024)} KB`);

            // Run OCR on this single Blob
            let result;
            try {
                result = await Tesseract.recognize(blob, 'eng', {
                    logger: (m) => {
                        if (m.status === 'recognizing text') {
                            const cId = type === 'aadhaar' ? aadhaarScanId : panScanId;
                            if (scanId === cId) {
                                showOcrMessage(
                                    type,
                                    `Reading document… ${Math.round(m.progress * 100)}%`,
                                    'info'
                                );
                            }
                        }
                    }
                });
            } catch (ocrErr) {
                logDebug(`OCR error on attempt "${attempt.name}"`, ocrErr.message);
                attemptsDone++;
                continue;
            }

            attemptsDone++;
            const conf = result.data.confidence || 0;
            logDebug(`Confidence for "${attempt.name}": ${conf}`);

            if (conf > bestConfidence) {
                bestConfidence = conf;
                bestText       = result.data.text;
            }

            // Good enough — stop early, save memory and time
            if (conf >= CONFIDENCE_STOP) {
                logDebug('Confidence threshold met, stopping early');
                break;
            }
        }

        // ── Step 6: Final stale check ──
        if ((type === 'aadhaar' ? aadhaarScanId : panScanId) !== scanId) {
            logDebug('Stale scan after OCR, discarding result');
            return;
        }

        logDebug('OCR finished', {
            attempts:   attemptsDone,
            confidence: bestConfidence,
            textLength: bestText.length
        });

        if (!bestText || bestConfidence === 0) {
            showOcrMessage(type,
                'The image is too unclear to read. Please retake the photo with the card filling most of the frame.',
                'error');
            return;
        }

        // ── Step 7: Extract details and auto-fill ──
        if (type === 'aadhaar') {
            extractAadhaarDetails(bestText, bestConfidence);
        } else {
            extractPanDetails(bestText, bestConfidence);
        }

    } catch (err) {
        // Catch low-memory and other unexpected errors
        const msg = (err && err.message) ? err.message.toLowerCase() : '';
        logDebug('processDocument caught error', err.message || err);

        if (msg.includes('memory') || msg.includes('oom') || msg.includes('allocation')) {
            showOcrMessage(type,
                'The image is too large to process on this device. Please retake the document photo with the card filling most of the frame.',
                'error');
        } else {
            showOcrMessage(type,
                'Unable to process the document. Please retake the photo or enter details manually.',
                'error');
        }
    } finally {
        // ── Always release canvas and unlock ──
        if (canvas) {
            // Setting dimensions to 0 releases the backing pixel buffer on most browsers
            canvas.width  = 0;
            canvas.height = 0;
            canvas = null;
            ctx    = null;
        }
        ocrLock[type] = false;
        logDebug('OCR lock released for', type);
    }
}

// ============================================================
// In-place pixel filters — operate on a single ImageData.data
// No new arrays allocated — modifies the Uint8ClampedArray directly
// ============================================================

// High-contrast grayscale: best first attempt for Indian ID cards
function applyHighContrast(d) {
    // Contrast factor ≈ 1.8 — strong but not clipping fine text
    const factor = (259 * (1.8 + 255)) / (255 * (259 - 1.8));
    for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const e = Math.max(0, Math.min(255, factor * (g - 128) + 128));
        d[i] = d[i + 1] = d[i + 2] = e;
        // alpha (d[i+3]) unchanged
    }
}

// Adaptive threshold / binarise: helps with uneven lighting
function applyThreshold(d) {
    // Single pass: compute mean, then binarise
    let sum = 0;
    const pixels = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
        sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    const thr = (sum / pixels) * 0.82;
    for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const b = g > thr ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = b;
    }
}

// ============================================================
// canvas.toBlob wrapper
// ============================================================
function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('canvas.toBlob returned null'));
        }, type, quality);
    });
}

// ============================================================
// OCR Message Helper
// ============================================================
function showOcrMessage(type, text, cls) {
    const id  = type === 'aadhaar' ? 'aadhaarOcrMessage' : 'panOcrMessage';
    const div = document.getElementById(id);
    div.textContent = text;
    div.className   = `ocr-message show ${cls}`;
}

// ============================================================
// Aadhaar Detail Extraction
// ============================================================
function extractAadhaarDetails(text, confidence) {
    let detected = false;
    const type = 'aadhaar';

    // Aadhaar number: 12 digits, optionally spaced/dashed in groups of 4
    const aadhaarMatches = text.match(/\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b|\b\d{12}\b/g);
    if (aadhaarMatches) {
        const raw = aadhaarMatches[0].replace(/[\s\-]/g, '');
        if (raw.length === 12) {
            document.getElementById('aadhaarNumber').value = raw;
            detected = true;
        }
    }

    // Full name — title-case words, no digits, reasonable length
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    for (const line of lines) {
        if (
            /^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/.test(line) &&
            !/\d/.test(line) &&
            line.length > 3 &&
            line.length < 60
        ) {
            const ll = line.toLowerCase();
            if (!ll.includes('aadhaar') && !ll.includes('government') &&
                !ll.includes('india') && !ll.includes('unique')) {
                document.getElementById('fullName').value = line;
                detected = true;
                break;
            }
        }
    }

    // Date of birth: DD/MM/YYYY or DD-MM-YYYY
    const dobMatch = text.match(/\b(0[1-9]|[12]\d|3[01])[\/\-](0[1-9]|1[0-2])[\/\-]\d{4}\b/);
    if (dobMatch) {
        const parts = dobMatch[0].replace(/-/g, '/').split('/');
        if (parts.length === 3) {
            document.getElementById('dateOfBirth').value = `${parts[2]}-${parts[1]}-${parts[0]}`;
            detected = true;
        }
    }

    if (detected) {
        const lowConf = confidence < 50;
        showOcrMessage(type,
            lowConf
                ? 'Details detected — please verify carefully before saving.'
                : 'Details detected. Please verify before saving.',
            'success'
        );
    } else {
        showOcrMessage(type,
            'Document captured, but details could not be detected. Please retake the photo or enter details manually.',
            'error'
        );
    }
}

// ============================================================
// PAN Detail Extraction
// ============================================================
function extractPanDetails(text, confidence) {
    let detected = false;
    const type = 'pan';

    // PAN: 5 alpha + 4 digit + 1 alpha
    const panMatch = text.match(/[A-Z]{5}[0-9]{4}[A-Z]/i);
    if (panMatch) {
        document.getElementById('panNumber').value = panMatch[0].toUpperCase();
        detected = true;
    }

    // Full name — only fill if not already populated
    if (!document.getElementById('fullName').value) {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        for (const line of lines) {
            if (
                /^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/.test(line) &&
                !/\d/.test(line) &&
                line.length > 3 &&
                line.length < 60
            ) {
                const ll = line.toLowerCase();
                if (!ll.includes('permanent') && !ll.includes('account') &&
                    !ll.includes('number')    && !ll.includes('income')  &&
                    !ll.includes('tax')       && !ll.includes('department') &&
                    !ll.includes('government')&& !ll.includes('india')) {
                    document.getElementById('fullName').value = line;
                    detected = true;
                    break;
                }
            }
        }
    }

    // DOB — only fill if not already populated
    if (!document.getElementById('dateOfBirth').value) {
        const dobMatch = text.match(/\b(0[1-9]|[12]\d|3[01])[\/\-](0[1-9]|1[0-2])[\/\-]\d{4}\b/);
        if (dobMatch) {
            const parts = dobMatch[0].replace(/-/g, '/').split('/');
            if (parts.length === 3) {
                document.getElementById('dateOfBirth').value = `${parts[2]}-${parts[1]}-${parts[0]}`;
                detected = true;
            }
        }
    }

    if (detected) {
        const lowConf = confidence < 50;
        showOcrMessage(type,
            lowConf
                ? 'Details detected — please verify carefully before saving.'
                : 'Details detected. Please verify before saving.',
            'success'
        );
    } else {
        showOcrMessage(type,
            'Document captured, but details could not be detected. Please retake the photo or enter details manually.',
            'error'
        );
    }
}

// ============================================================
// Input Formatting
// ============================================================
function formatAadhaar(e) {
    e.target.value = e.target.value.replace(/\D/g, '');
}

function formatPAN(e) {
    e.target.value = e.target.value.toUpperCase();
}

// ============================================================
// UPI / Payment
// ============================================================
function generateUpiUri(amount) {
    const params = new URLSearchParams({
        pa: UPI_CONFIG.pa,
        pn: UPI_CONFIG.pn,
        am: parseFloat(amount).toFixed(2),
        cu: UPI_CONFIG.cu,
        tn: UPI_CONFIG.tn
    });
    return `upi://pay?${params.toString()}`;
}

function generateQrCode(upiUri) {
    const canvas  = document.getElementById('paymentQrCanvas');
    const qrError = document.getElementById('qrError');
    if (!canvas) return;
    try {
        new QRious({ element: canvas, value: upiUri, size: 200, level: 'H' });
        canvas.style.display = 'block';
        qrError.classList.add('hidden');
    } catch (err) {
        console.error('QR generation error:', err);
        canvas.style.display = 'none';
        qrError.classList.remove('hidden');
    }
}

function showPaymentModal() {
    const amount   = document.getElementById('amount').value;
    const errorDiv = document.getElementById('upiError');
    if (!amount || parseFloat(amount) <= 0) {
        errorDiv.textContent = 'Please enter the amount first.';
        errorDiv.classList.add('show');
        return;
    }
    errorDiv.classList.remove('show');
    document.getElementById('paymentModalAmount').textContent =
        `₹${parseFloat(amount).toLocaleString('en-IN')}`;
    generateQrCode(generateUpiUri(amount));
    paymentModal.classList.remove('hidden');
}

function closePaymentModal() {
    paymentModal.classList.add('hidden');
}

function openUpiApp() {
    const amount   = document.getElementById('amount').value;
    const errorDiv = document.getElementById('upiError');
    if (!amount || parseFloat(amount) <= 0) {
        errorDiv.textContent = 'Please enter a valid amount.';
        errorDiv.classList.add('show');
        closePaymentModal();
        return;
    }
    const upiUri = generateUpiUri(amount);
    try {
        window.location.href = upiUri;
        showToast('Opening UPI app…', 'success');
        closePaymentModal();
        document.getElementById('paymentStatus').textContent = 'Pending';
        document.getElementById('paymentStatus').className   = 'status-badge status-pending';
    } catch (err) {
        errorDiv.textContent = 'Unable to open a UPI app. Please scan the QR code instead.';
        errorDiv.classList.add('show');
        closePaymentModal();
    }
}

// ============================================================
// Form Validation
// ============================================================
function validateForm() {
    let valid = true;

    const fullName = document.getElementById('fullName').value.trim();
    if (!fullName) { showError('fullNameError', 'Please enter full name'); valid = false; }
    else hideError('fullNameError');

    const aadhaar = document.getElementById('aadhaarNumber').value;
    if (!/^\d{12}$/.test(aadhaar)) {
        showError('aadhaarNumberError', 'Please enter a valid 12-digit Aadhaar number');
        valid = false;
    } else hideError('aadhaarNumberError');

    const pan = document.getElementById('panNumber').value.toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
        showError('panNumberError', 'Please enter a valid PAN number (e.g. ABCDE1234F)');
        valid = false;
    } else hideError('panNumberError');

    const dob = document.getElementById('dateOfBirth').value;
    if (!dob) { showError('dateOfBirthError', 'Please select date of birth'); valid = false; }
    else hideError('dateOfBirthError');

    const amount = document.getElementById('amount').value;
    if (!amount || parseFloat(amount) <= 0) {
        showError('amountError', 'Please enter a valid amount greater than ₹0');
        valid = false;
    } else hideError('amountError');

    return valid;
}

function showError(id, msg) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.classList.add('show');
}

function hideError(id) {
    document.getElementById(id).classList.remove('show');
}

// ============================================================
// Form Submission
// ============================================================
async function handleFormSubmit(e) {
    e.preventDefault();
    const submitError = document.getElementById('submitError');

    if (!validateForm()) {
        submitError.textContent = 'Please fix the errors above.';
        submitError.classList.add('show');
        return;
    }
    submitError.classList.remove('show');

    // Convert actual File/Blobs to base64 for backend
    let aadhaarBase64 = null;
    let panBase64     = null;
    if (aadhaarFile) aadhaarBase64 = await fileToBase64(aadhaarFile);
    if (panFile)     panBase64     = await fileToBase64(panFile);

    const application = {
        applicationId:    editingApplicationId || generateApplicationId(),
        date:             new Date().toISOString().split('T')[0],
        time:             new Date().toLocaleTimeString('en-US', { hour12: false }),
        fullName:         document.getElementById('fullName').value.trim(),
        aadhaarNumber:    document.getElementById('aadhaarNumber').value,
        panNumber:        document.getElementById('panNumber').value.toUpperCase(),
        dateOfBirth:      document.getElementById('dateOfBirth').value,
        amount:           parseFloat(document.getElementById('amount').value),
        paymentStatus:    document.getElementById('paymentStatus').textContent,
        paymentTimestamp: document.getElementById('paymentStatus').textContent === 'Paid'
                            ? new Date().toISOString() : null,
        createdBy:        'System',
        aadhaarPhoto:     aadhaarBase64,
        panPhoto:         panBase64
    };

    try {
        if (GOOGLE_SCRIPT_URL && GOOGLE_SCRIPT_URL !== 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
            await sendToGoogleSheets(application);
        }

        if (editingApplicationId) {
            const idx = applications.findIndex(a => a.applicationId === editingApplicationId);
            if (idx !== -1) applications[idx] = application;
        } else {
            applications.push(application);
        }

        localStorage.setItem('applications', JSON.stringify(applications));
        showToast(
            `Application ${editingApplicationId ? 'updated' : 'saved'} successfully. ID: ${application.applicationId}`,
            'success'
        );

        editingApplicationId = null;
        aadhaarFile          = null;
        panFile              = null;
        showDashboard();
    } catch (err) {
        console.error('Save error:', err);
        submitError.textContent = 'Unable to save the application. Please try again.';
        submitError.classList.add('show');
    }
}

// ============================================================
// File → Base64 Helper
// ============================================================
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ============================================================
// Application ID
// ============================================================
function generateApplicationId() {
    return `APP${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}

// ============================================================
// Google Sheets Integration
// ============================================================
async function sendToGoogleSheets(application) {
    return fetch(GOOGLE_SCRIPT_URL, {
        method:  'POST',
        mode:    'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(application)
    });
}

// ============================================================
// Local Storage
// ============================================================
function loadApplications() {
    const saved = localStorage.getItem('applications');
    if (saved) applications = JSON.parse(saved);
}

// ============================================================
// Dashboard Stats
// ============================================================
function updateDashboardStats() {
    const total   = applications.length;
    const pending = applications.filter(a => a.paymentStatus === 'Pending').length;
    const paid    = applications.filter(a => a.paymentStatus === 'Paid').length;
    const amount  = applications
        .filter(a => a.paymentStatus === 'Paid')
        .reduce((s, a) => s + (a.amount || 0), 0);

    document.getElementById('totalApps').textContent     = total;
    document.getElementById('pendingPayments').textContent = pending;
    document.getElementById('paidApps').textContent      = paid;
    document.getElementById('totalAmount').textContent   = `₹${amount.toLocaleString('en-IN')}`;
}

// ============================================================
// Applications List
// ============================================================
function renderApplicationsList(filtered = null) {
    const container = document.getElementById('applicationsList');
    const list      = filtered || applications;

    if (!list.length) {
        container.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z"/>
                </svg>
                <p>No applications found</p>
            </div>`;
        return;
    }

    container.innerHTML = list.map(app => `
        <div class="application-card">
            <div class="app-card-header">
                <span class="app-id">${app.applicationId}</span>
                <span class="app-date">${formatDate(app.date)}</span>
            </div>
            <div class="app-name">${escapeHtml(app.fullName)}</div>
            <div class="app-details">
                <div class="app-detail"><strong>Aadhaar:</strong> ${maskAadhaar(app.aadhaarNumber)}</div>
                <div class="app-detail"><strong>PAN:</strong> ${maskPAN(app.panNumber)}</div>
                <div class="app-detail"><strong>DOB:</strong> ${formatDate(app.dateOfBirth)}</div>
                <div class="app-detail"><strong>Amount:</strong> <span class="app-amount">₹${app.amount.toLocaleString('en-IN')}</span></div>
            </div>
            <div class="app-card-footer">
                <span class="status-badge ${app.paymentStatus === 'Paid' ? 'status-paid' : 'status-pending'}">${app.paymentStatus}</span>
                <div class="app-actions">
                    <button class="btn-action" onclick="viewApplication('${app.applicationId}')">View</button>
                    <button class="btn-action" onclick="editApplication('${app.applicationId}')">Edit</button>
                    ${app.paymentStatus === 'Pending'
                        ? `<button class="btn-action" onclick="markAsPaid('${app.applicationId}')">Mark Paid</button>`
                        : ''}
                    <button class="btn-action btn-action-delete" onclick="deleteApplication('${app.applicationId}')">Delete</button>
                </div>
            </div>
        </div>`
    ).join('');
}

// ============================================================
// Filter Applications
// ============================================================
function filterApplications() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const status = document.getElementById('statusFilter').value;
    const date   = document.getElementById('dateFilter').value;

    const filtered = applications.filter(app => {
        const matchSearch = !search ||
            app.fullName.toLowerCase().includes(search) ||
            app.applicationId.toLowerCase().includes(search);
        const matchStatus = !status || app.paymentStatus === status;
        const matchDate   = !date   || app.date === date;
        return matchSearch && matchStatus && matchDate;
    });
    renderApplicationsList(filtered);
}

// ============================================================
// View / Edit / Delete Applications
// ============================================================
function viewApplication(id) {
    const app = applications.find(a => a.applicationId === id);
    if (!app) return;

    document.getElementById('modalBody').innerHTML = `
        <div class="modal-detail"><label>Application ID</label><p>${app.applicationId}</p></div>
        <div class="modal-detail"><label>Date &amp; Time</label><p>${formatDate(app.date)} at ${app.time}</p></div>
        <div class="modal-detail"><label>Full Name</label><p>${escapeHtml(app.fullName)}</p></div>
        <div class="modal-detail"><label>Aadhaar Number</label><p class="masked">${app.aadhaarNumber}</p></div>
        <div class="modal-detail"><label>PAN Number</label><p class="masked">${app.panNumber}</p></div>
        <div class="modal-detail"><label>Date of Birth</label><p>${formatDate(app.dateOfBirth)}</p></div>
        <div class="modal-detail"><label>Amount</label><p>₹${app.amount.toLocaleString('en-IN')}</p></div>
        <div class="modal-detail"><label>Payment Status</label>
            <p><span class="status-badge ${app.paymentStatus === 'Paid' ? 'status-paid' : 'status-pending'}">${app.paymentStatus}</span></p>
        </div>
        <div class="modal-detail"><label>Created By</label><p>${escapeHtml(app.createdBy)}</p></div>`;

    viewModal.classList.remove('hidden');
}

function editApplication(id) {
    const app = applications.find(a => a.applicationId === id);
    if (!app) return;

    editingApplicationId = id;
    document.getElementById('fullName').value      = app.fullName;
    document.getElementById('aadhaarNumber').value = app.aadhaarNumber;
    document.getElementById('panNumber').value     = app.panNumber;
    document.getElementById('dateOfBirth').value   = app.dateOfBirth;
    document.getElementById('amount').value        = app.amount;

    const sb = document.getElementById('paymentStatus');
    sb.textContent = app.paymentStatus;
    sb.className   = `status-badge ${app.paymentStatus === 'Paid' ? 'status-paid' : 'status-pending'}`;

    showForm();
}

function markAsPaid(id) {
    const app = applications.find(a => a.applicationId === id);
    if (!app) return;
    if (!confirm('Mark this application as paid?')) return;

    app.paymentStatus    = 'Paid';
    app.paymentTimestamp = new Date().toISOString();
    localStorage.setItem('applications', JSON.stringify(applications));
    updateDashboardStats();
    renderApplicationsList();

    if (GOOGLE_SCRIPT_URL && GOOGLE_SCRIPT_URL !== 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
        sendToGoogleSheets(app).catch(console.error);
    }
    showToast('Payment status updated', 'success');
}

function deleteApplication(id) {
    const app = applications.find(a => a.applicationId === id);
    if (!app) return;
    if (!confirm(`Are you sure you want to delete application ${id}? This cannot be undone.`)) return;

    applications = applications.filter(a => a.applicationId !== id);
    localStorage.setItem('applications', JSON.stringify(applications));
    updateDashboardStats();
    renderApplicationsList();
    showToast('Application deleted', 'success');
}

function closeModal() {
    viewModal.classList.add('hidden');
}

// ============================================================
// Reset Form
// ============================================================
function resetForm() {
    document.getElementById('applicationForm').reset();
    editingApplicationId = null;
    aadhaarFile          = null;
    panFile              = null;
    aadhaarScanId        = 0;
    panScanId            = 0;

    document.getElementById('aadhaarPhotoPlaceholder').classList.remove('hidden');
    document.getElementById('aadhaarPhotoPreview').classList.add('hidden');
    document.getElementById('panPhotoPlaceholder').classList.remove('hidden');
    document.getElementById('panPhotoPreview').classList.add('hidden');

    document.getElementById('aadhaarOcrMessage').className = 'ocr-message';
    document.getElementById('panOcrMessage').className     = 'ocr-message';

    document.getElementById('paymentStatus').textContent = 'Pending';
    document.getElementById('paymentStatus').className   = 'status-badge status-pending';

    document.querySelectorAll('.error-message').forEach(el => el.classList.remove('show'));
}

// ============================================================
// Utility Functions
// ============================================================
function formatDate(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

function maskAadhaar(n) {
    if (!n || n.length < 4) return n;
    return 'XXXX XXXX ' + n.slice(-4);
}

function maskPAN(p) {
    if (!p || p.length < 4) return p;
    return 'XXXXX' + p.slice(-5);
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className   = `toast ${type}`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3500);
}

// ============================================================
// Global bindings for inline onclick handlers
// ============================================================
window.viewApplication   = viewApplication;
window.editApplication   = editApplication;
window.markAsPaid        = markAsPaid;
window.deleteApplication = deleteApplication;
