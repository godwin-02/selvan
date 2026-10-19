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

    // Also wire the camera inputs (separate inputs with capture="environment")
    mirrorInputToMain('aadhaarPhotoCamera', 'aadhaarPhoto');
    mirrorInputToMain('panPhotoCamera',     'panPhoto');

    // Camera buttons → open dedicated camera input
    document.getElementById('aadhaarCameraBtn').addEventListener('click', () => {
        document.getElementById('aadhaarPhotoCamera').value = '';
        document.getElementById('aadhaarPhotoCamera').click();
    });
    document.getElementById('panCameraBtn').addEventListener('click', () => {
        document.getElementById('panPhotoCamera').value = '';
        document.getElementById('panPhotoCamera').click();
    });

    // Upload buttons → open gallery/file input (no capture attr)
    document.getElementById('aadhaarUploadBtn').addEventListener('click', () => {
        document.getElementById('aadhaarPhoto').value = '';
        document.getElementById('aadhaarPhoto').click();
    });
    document.getElementById('panUploadBtn').addEventListener('click', () => {
        document.getElementById('panPhoto').value = '';
        document.getElementById('panPhoto').click();
    });

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
// Mirror a camera input's file selection into the main input
// so the existing setupPhotoUpload pipeline handles both paths
// ============================================================
function mirrorInputToMain(cameraInputId, mainInputId) {
    const camInput  = document.getElementById(cameraInputId);
    const mainInput = document.getElementById(mainInputId);
    if (!camInput || !mainInput) return;

    camInput.addEventListener('change', () => {
        if (!camInput.files || !camInput.files[0]) return;
        // Dispatch the file through the main input's change handler
        // by using a DataTransfer object (supported in all modern browsers)
        try {
            const dt = new DataTransfer();
            dt.items.add(camInput.files[0]);
            mainInput.files = dt.files;
        } catch (_) {
            // DataTransfer not supported — fall back to firing directly
        }
        mainInput.dispatchEvent(new Event('change', { bubbles: true }));
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

    // Clicking the placeholder opens the gallery/file picker (no camera lock)
    placeholder.addEventListener('click', () => {
        input.value = '';
        input.click();
    });
    retakeBtn.addEventListener('click', () => {
        if (docType === 'aadhaar') aadhaarFile = null;
        else panFile = null;
        input.value = '';
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
// ── Single-pass, minimum-memory design ──
//
// The "low memory" error on Android comes from Tesseract's
// WebAssembly worker. Each Tesseract.recognize() call allocates
// 40-80 MB inside the WASM heap. Running it 3 times sequentially
// (as previous versions did) means 120-240 MB total — Android
// WebView kills the process.
//
// This version:
//   1. Resize image to MAX 1000px longest side before OCR
//   2. Run Tesseract ONCE on the best-preprocessed version
//   3. Never run multiple Tesseract calls back-to-back
//   4. Use URL.createObjectURL (not FileReader dataURL) for preview
//   5. Release all canvas/blob memory after OCR
// ============================================================

// Lock — one OCR operation at a time, per document slot
const ocrLock = { aadhaar: false, pan: false };

// 1000px longest side = ~4MB canvas buffer
// Still reads 12-digit Aadhaar numbers and 10-char PAN clearly
const MAX_OCR_SIDE = 1000;

async function processDocument(file, type) {
    logDebug('processDocument', {
        type,
        fileType: file ? file.type : 'none',
        fileSizeKB: file ? Math.round(file.size / 1024) : 0
    });

    if (!file || file.size === 0) {
        showOcrMessage(type, 'Please capture or upload a photo first.', 'error');
        return;
    }

    // Prevent duplicate concurrent OCR
    if (ocrLock[type]) {
        logDebug('Already processing ' + type + ' — ignoring duplicate');
        return;
    }
    ocrLock[type] = true;

    const scanId = type === 'aadhaar' ? ++aadhaarScanId : ++panScanId;

    showOcrMessage(type, 'Loading image…', 'info');

    let canvas = null;

    try {
        // ── Step 1: Load image via Image element (works on all Android) ──
        // We use URL.createObjectURL — it does NOT base64-encode the whole
        // file into memory the way FileReader.readAsDataURL does.
        const imgEl = await loadImageElement(file);

        logDebug('Image decoded', {
            w: imgEl.naturalWidth,
            h: imgEl.naturalHeight
        });

        if (!imgEl.naturalWidth || !imgEl.naturalHeight) {
            showOcrMessage(type, 'Could not decode the image. Please retake.', 'error');
            return;
        }

        // ── Step 2: EXIF orientation ──
        const orientation = await getExifOrientation(file);
        logDebug('EXIF orientation', orientation);

        // ── Step 3: Draw onto a single correctly-oriented, scaled canvas ──
        canvas = drawOrientedCanvas(imgEl, orientation, MAX_OCR_SIDE);

        // imgEl src object URL is revoked inside loadImageElement after load
        // Nothing else holds a reference to the full-res data now

        if (!canvas) {
            showOcrMessage(type, 'Could not process image. Please retake.', 'error');
            return;
        }

        logDebug('Canvas size', { w: canvas.width, h: canvas.height });

        if ((type === 'aadhaar' ? aadhaarScanId : panScanId) !== scanId) return;

        showOcrMessage(type, 'Enhancing image…', 'info');

        // ── Step 4: Apply HIGH CONTRAST filter once, in-place ──
        // One filter pass. No multiple copies. No retry loop.
        // High-contrast grayscale is the single best choice for
        // printed Indian ID card text under mixed lighting.
        const ctx      = canvas.getContext('2d');
        const imgData  = ctx.getImageData(0, 0, canvas.width, canvas.height);
        applyHighContrast(imgData.data);
        ctx.putImageData(imgData, 0, 0);
        // imgData is now eligible for GC

        // ── Step 5: Get a single Blob — no base64, no toDataURL ──
        let blob;
        try {
            blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
        } catch (e) {
            // Fallback: toDataURL (slightly more memory but universally supported)
            blob = dataURLtoBlob(canvas.toDataURL('image/jpeg', 0.85));
        }

        // Release canvas backing store immediately — Tesseract has the blob now
        canvas.width  = 0;
        canvas.height = 0;
        canvas        = null;

        logDebug('Blob ready', { sizeKB: Math.round(blob.size / 1024) });

        if ((type === 'aadhaar' ? aadhaarScanId : panScanId) !== scanId) return;

        showOcrMessage(type, 'Reading text…', 'info');

        // ── Step 6: ONE Tesseract call ──
        let result;
        try {
            result = await Tesseract.recognize(blob, 'eng', {
                logger: (m) => {
                    if (m.status === 'recognizing text') {
                        const cur = type === 'aadhaar' ? aadhaarScanId : panScanId;
                        if (cur === scanId) {
                            showOcrMessage(type,
                                'Reading text… ' + Math.round(m.progress * 100) + '%',
                                'info');
                        }
                    }
                }
            });
        } catch (ocrErr) {
            logDebug('Tesseract.recognize failed', ocrErr.message || String(ocrErr));
            showOcrMessage(type,
                'OCR failed. Please retake the photo in good lighting with the card clearly visible.',
                'error');
            return;
        }

        // blob goes out of scope here → GC-eligible

        if ((type === 'aadhaar' ? aadhaarScanId : panScanId) !== scanId) return;

        const text = (result && result.data && result.data.text) ? result.data.text : '';
        const conf = (result && result.data && typeof result.data.confidence === 'number')
            ? result.data.confidence : 0;

        logDebug('OCR result', { conf, textLen: text.length });

        if (!text || text.trim().length < 3) {
            showOcrMessage(type,
                'No text detected. Retake with the card filling most of the frame in good light.',
                'error');
            return;
        }

        // ── Step 7: Extract and auto-fill ──
        if (type === 'aadhaar') extractAadhaarDetails(text, conf);
        else                    extractPanDetails(text, conf);

    } catch (err) {
        const msg = (err && err.message) ? err.message.toLowerCase() : '';
        logDebug('processDocument caught', err.message || String(err));

        if (msg.includes('memory') || msg.includes('quota') || msg.includes('oom') ||
            msg.includes('previous operation')) {
            showOcrMessage(type,
                'Not enough memory on this device. Please close other apps and try again.',
                'error');
        } else {
            showOcrMessage(type,
                'Could not process the document. Please retake in good lighting.',
                'error');
        }
    } finally {
        if (canvas) {
            canvas.width  = 0;
            canvas.height = 0;
            canvas = null;
        }
        ocrLock[type] = false;
        logDebug('Lock released', type);
    }
}

// ============================================================
// Load image using URL.createObjectURL + HTMLImageElement
// This does NOT read the entire file as base64 into JS heap —
// the browser streams it directly from the Blob URL.
// ============================================================
function loadImageElement(file) {
    return new Promise((resolve, reject) => {
        const url   = URL.createObjectURL(file);
        const imgEl = new Image();
        imgEl.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
        imgEl.onload  = () => { URL.revokeObjectURL(url); resolve(imgEl); };
        imgEl.src     = url;
    });
}

// ============================================================
// EXIF Orientation Reader
// Reads only first 64KB of the JPEG — EXIF is always at the start
// ============================================================
function getExifOrientation(file) {
    return new Promise((resolve) => {
        const type = (file.type || '').toLowerCase();
        if (!type.includes('jpeg') && !type.includes('jpg')) { resolve(1); return; }
        const reader = new FileReader();
        reader.onerror = () => resolve(1);
        reader.onload  = (ev) => {
            try {
                const view = new DataView(ev.target.result);
                if (view.getUint16(0) !== 0xFFD8) { resolve(1); return; }
                let offset = 2;
                while (offset + 4 < view.byteLength) {
                    const marker = view.getUint16(offset);
                    const segLen = view.getUint16(offset + 2);
                    if (marker === 0xFFE1) {
                        if (view.byteLength < offset + 10) { resolve(1); return; }
                        if (view.getUint32(offset + 4) !== 0x45786966) { resolve(1); return; }
                        const tiffBase = offset + 10;
                        const little   = view.getUint16(tiffBase) === 0x4949;
                        const ifdOff   = view.getUint32(tiffBase + 4, little);
                        const ifdStart = tiffBase + ifdOff;
                        if (ifdStart + 2 > view.byteLength) { resolve(1); return; }
                        const numTags  = view.getUint16(ifdStart, little);
                        for (let i = 0; i < numTags; i++) {
                            const tagOff = ifdStart + 2 + i * 12;
                            if (tagOff + 12 > view.byteLength) break;
                            if (view.getUint16(tagOff, little) === 0x0112) {
                                resolve(view.getUint16(tagOff + 8, little));
                                return;
                            }
                        }
                        resolve(1); return;
                    }
                    offset += 2 + segLen;
                    if ((marker & 0xFF00) !== 0xFF00) break;
                }
            } catch (_) {}
            resolve(1);
        };
        reader.readAsArrayBuffer(file.slice(0, 65536));
    });
}

// ============================================================
// Draw image onto canvas with EXIF rotation applied + scaled
// ============================================================
function drawOrientedCanvas(imgEl, orientation, maxSide) {
    try {
        const srcW = imgEl.naturalWidth;
        const srcH = imgEl.naturalHeight;

        const swap   = orientation >= 5;
        const logicW = swap ? srcH : srcW;
        const logicH = swap ? srcW : srcH;

        const scale = Math.min(1, maxSide / Math.max(logicW, logicH));
        const outW  = Math.round(logicW * scale);
        const outH  = Math.round(logicH * scale);

        const c   = document.createElement('canvas');
        c.width   = outW;
        c.height  = outH;
        const ctx = c.getContext('2d');
        if (!ctx) return null;

        ctx.save();
        switch (orientation) {
            case 2: ctx.transform(-1, 0,  0,  1, outW, 0);     break;
            case 3: ctx.transform(-1, 0,  0, -1, outW, outH);   break;
            case 4: ctx.transform( 1, 0,  0, -1, 0,    outH);   break;
            case 5: ctx.transform( 0, 1,  1,  0, 0,    0);      break;
            case 6: ctx.transform( 0, 1, -1,  0, outH, 0);      break;
            case 7: ctx.transform( 0,-1, -1,  0, outH, outW);   break;
            case 8: ctx.transform( 0,-1,  1,  0, 0,    outW);   break;
            default: break;
        }
        ctx.drawImage(imgEl, 0, 0, srcW, srcH, 0, 0,
            swap ? outH : outW, swap ? outW : outH);
        ctx.restore();
        return c;
    } catch (e) {
        logDebug('drawOrientedCanvas error', e.message);
        return null;
    }
}

// ============================================================
// High-contrast grayscale — single best filter for Indian IDs
// ============================================================
function applyHighContrast(d) {
    const factor = (259 * (1.9 + 255)) / (255 * (259 - 1.9));
    for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const e = Math.max(0, Math.min(255, factor * (g - 128) + 128));
        d[i] = d[i + 1] = d[i + 2] = e;
    }
}

// ============================================================
// canvas.toBlob — Promise wrapper
// ============================================================
function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else      reject(new Error('toBlob returned null'));
        }, mimeType, quality);
    });
}

// ============================================================
// dataURL → Blob fallback
// ============================================================
function dataURLtoBlob(dataURL) {
    const parts  = dataURL.split(',');
    const mime   = parts[0].match(/:(.*?);/)[1];
    const binary = atob(parts[1]);
    const buf    = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
    return new Blob([buf], { type: mime });
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

    logDebug('Extracting Aadhaar from text length', text.length);

    // ── Aadhaar number ──
    // Handles: 1234 5678 9012 | 1234-5678-9012 | 123456789012
    // Also catches OCR noise like 1234\n5678\n9012
    const cleaned = text.replace(/\n/g, ' ');
    const numMatch = cleaned.match(/\b(\d{4}[\s\-]?\d{4}[\s\-]?\d{4})\b/);
    if (numMatch) {
        const raw = numMatch[1].replace(/[\s\-]/g, '');
        if (raw.length === 12) {
            document.getElementById('aadhaarNumber').value = raw;
            detected = true;
            logDebug('Aadhaar number found');
        }
    }

    // ── Full Name ──
    // Aadhaar cards print names in Title Case OR ALL CAPS
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 1);
    const skipWords = ['aadhaar', 'government', 'india', 'unique', 'authority',
                       'enrolment', 'enrollment', 'dob', 'year', 'male', 'female',
                       'address', 'village', 'district', 'state', 'pin'];
    for (const line of lines) {
        const noDigit = !/\d/.test(line);
        const noSpecial = !/[<>\/\\@#$%^&*()_+=\[\]{};:'",]/.test(line);
        const goodLen = line.length >= 4 && line.length <= 55;
        const looksLikeName =
            /^[A-Z][a-z]+(\s+[A-Za-z]+)+$/.test(line) ||   // Title Case
            /^[A-Z]{2,}(\s+[A-Z]{2,})+$/.test(line);        // ALL CAPS
        const ll = line.toLowerCase();
        const notHeader = skipWords.every(w => !ll.includes(w));
        if (noDigit && noSpecial && goodLen && looksLikeName && notHeader) {
            document.getElementById('fullName').value = toTitleCase(line);
            detected = true;
            logDebug('Name found');
            break;
        }
    }

    // ── Date of Birth ──
    // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
    const dobMatch = text.match(/\b(0?[1-9]|[12]\d|3[01])[\/\-\.](0?[1-9]|1[0-2])[\/\-\.](\d{4})\b/);
    if (dobMatch) {
        const d = dobMatch[1].padStart(2,'0');
        const m = dobMatch[2].padStart(2,'0');
        const y = dobMatch[3];
        document.getElementById('dateOfBirth').value = `${y}-${m}-${d}`;
        detected = true;
        logDebug('DOB found');
    }

    if (detected) {
        showOcrMessage(type, 'Details detected. Please verify before saving.', 'success');
    } else {
        showOcrMessage(type,
            'Could not detect details. Please retake the photo or enter manually.', 'error');
    }
}

// ============================================================
// PAN Detail Extraction
// ============================================================
function extractPanDetails(text, confidence) {
    let detected = false;
    const type = 'pan';

    logDebug('Extracting PAN from text length', text.length);

    // ── PAN Number ──
    // Format: ABCDE1234F — 5 letters, 4 digits, 1 letter
    // OCR sometimes introduces spaces: ABCDE 1234 F
    const panClean = text.replace(/\s/g, '');
    const panMatch = panClean.match(/[A-Z]{5}[0-9]{4}[A-Z]/i);
    if (panMatch) {
        document.getElementById('panNumber').value = panMatch[0].toUpperCase();
        detected = true;
        logDebug('PAN number found');
    }

    // ── Full Name — only if not already filled ──
    if (!document.getElementById('fullName').value) {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 1);
        const skipWords = ['permanent', 'account', 'number', 'income', 'tax',
                           'department', 'government', 'india', 'father', 'name'];
        for (const line of lines) {
            const noDigit   = !/\d/.test(line);
            const noSpecial = !/[<>\/\\@#$%^&*()_+=\[\]{};:'",]/.test(line);
            const goodLen   = line.length >= 4 && line.length <= 55;
            const looksLikeName =
                /^[A-Z][a-z]+(\s+[A-Za-z]+)+$/.test(line) ||
                /^[A-Z]{2,}(\s+[A-Z]{2,})+$/.test(line);
            const ll = line.toLowerCase();
            const notHeader = skipWords.every(w => !ll.includes(w));
            if (noDigit && noSpecial && goodLen && looksLikeName && notHeader) {
                document.getElementById('fullName').value = toTitleCase(line);
                detected = true;
                logDebug('Name found from PAN');
                break;
            }
        }
    }

    // ── DOB — only if not already filled ──
    if (!document.getElementById('dateOfBirth').value) {
        const dobMatch = text.match(/\b(0?[1-9]|[12]\d|3[01])[\/\-\.](0?[1-9]|1[0-2])[\/\-\.](\d{4})\b/);
        if (dobMatch) {
            const d = dobMatch[1].padStart(2,'0');
            const m = dobMatch[2].padStart(2,'0');
            const y = dobMatch[3];
            document.getElementById('dateOfBirth').value = `${y}-${m}-${d}`;
            detected = true;
            logDebug('DOB found from PAN');
        }
    }

    if (detected) {
        showOcrMessage(type, 'Details detected. Please verify before saving.', 'success');
    } else {
        showOcrMessage(type,
            'Could not detect details. Please retake the photo or enter manually.', 'error');
    }
}

// ============================================================
// Helper: Convert ALL CAPS name to Title Case
// ============================================================
function toTitleCase(str) {
    return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
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
