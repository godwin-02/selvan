// Application State
let applications = [];
let editingApplicationId = null;
let aadhaarFile = null;
let panFile = null;

// UPI Configuration
const UPI_CONFIG = {
    pa: '9789051375@axl',
    pn: 'DENNI MUTHU',
    cu: 'INR',
    tn: 'Application Payment'
};

// UPI QR Image Path (change filename if needed)
const UPI_QR_IMAGE = 'assets/upi-image.png';

// Google Apps Script URL (Replace with your actual deployment URL)
const GOOGLE_SCRIPT_URL = 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE';

// DOM Elements
const dashboardScreen = document.getElementById('dashboardScreen');
const formScreen = document.getElementById('formScreen');
const viewModal = document.getElementById('viewModal');
const paymentModal = document.getElementById('paymentModal');

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    loadApplications();
    setupEventListeners();
    // Show form by default
    showForm();
});

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

// Event Listeners
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

    // Photo Uploads
    setupPhotoUpload('aadhaarPhoto', 'aadhaarPhotoPlaceholder', 'aadhaarPhotoPreview', 'aadhaarPreviewImg', 'retakeAadhaar');
    setupPhotoUpload('panPhoto', 'panPhotoPlaceholder', 'panPhotoPreview', 'panPreviewImg', 'retakePan');

    // OCR Buttons
    document.getElementById('scanAadhaarBtn').addEventListener('click', () => performOCR('aadhaar'));
    document.getElementById('scanPanBtn').addEventListener('click', () => performOCR('pan'));

    // UPI Payment
    const payNowBtn = document.getElementById('payNowBtn');
    if (payNowBtn) {
        payNowBtn.addEventListener('click', () => {
            console.log('Pay Now button clicked');
            showPaymentModal();
        });
    } else {
        console.error('Pay Now button not found');
    }
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
    
    // Amount change listener for dynamic QR regeneration
    document.getElementById('amount').addEventListener('input', () => {
        // If payment modal is open, regenerate QR with new amount
        if (!paymentModal.classList.contains('hidden')) {
            const amount = document.getElementById('amount').value;
            if (amount && parseFloat(amount) > 0) {
                const formattedAmount = parseFloat(amount).toLocaleString('en-IN');
                document.getElementById('paymentModalAmount').textContent = `₹${formattedAmount}`;
                const upiUri = generateUpiUri(amount);
                generateQrCode(upiUri);
            }
        }
    });
}

// Photo Upload Setup
function setupPhotoUpload(inputId, placeholderId, previewId, imgId, retakeBtnId) {
    const input = document.getElementById(inputId);
    const placeholder = document.getElementById(placeholderId);
    const preview = document.getElementById(previewId);
    const img = document.getElementById(imgId);
    const retakeBtn = document.getElementById(retakeBtnId);

    if (!input || !placeholder || !preview || !img || !retakeBtn) {
        console.error('Photo upload setup failed - missing elements:', { inputId, placeholderId, previewId, imgId, retakeBtnId });
        return;
    }

    placeholder.addEventListener('click', () => {
        console.log('Placeholder clicked, triggering file input');
        input.click();
    });
    
    retakeBtn.addEventListener('click', () => {
        console.log('Retake clicked, triggering file input');
        input.click();
    });

    input.addEventListener('change', (e) => {
        console.log('File input changed', e.target.files);
        const file = e.target.files[0];
        if (file) {
            // Debug logging
            console.log('Camera capture details:', {
                name: file.name,
                type: file.type,
                size: file.size,
                lastModified: file.lastModified,
                isFile: file instanceof File
            });
            
            // Store file in application state
            if (inputId === 'aadhaarPhoto') {
                aadhaarFile = file;
                console.log('Stored aadhaarFile in state', aadhaarFile);
            } else if (inputId === 'panPhoto') {
                panFile = file;
                console.log('Stored panFile in state', panFile);
            }
            
            const reader = new FileReader();
            reader.onload = (event) => {
                img.src = event.target.result;
                placeholder.classList.add('hidden');
                preview.classList.remove('hidden');
                console.log('Photo loaded successfully');
            };
            reader.onerror = () => {
                console.error('Failed to read file');
                alert('Unable to load the captured image. Please retake the photo.');
            };
            reader.readAsDataURL(file);
        } else {
            console.log('No file selected - camera may have been cancelled');
        }
    });
    
    // Handle camera permission errors
    input.addEventListener('error', (e) => {
        console.error('File input error:', e);
        alert('Camera permission is required to scan the document. Please allow camera access and try again.');
    });
}

// Debug logging for development
const DEBUG_OCR = true;

function logDebug(message, data = null) {
    if (DEBUG_OCR) {
        console.log('[OCR Debug]', message, data || '');
    }
}

// Image Preprocessing for OCR - Robust mobile camera pipeline
async function preprocessImage(file) {
    logDebug('Starting image preprocessing', {
        type: file.type,
        size: file.size,
        name: file.name
    });

    return new Promise((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();
        
        reader.onload = (e) => {
            img.src = e.target.result;
        };
        
        reader.onerror = () => {
            reject(new Error('Failed to read file'));
        };
        
        img.onload = async () => {
            logDebug('Image loaded', {
                width: img.width,
                height: img.height,
                aspectRatio: img.width / img.height
            });

            try {
                // Create multiple preprocessing versions (await the async function)
                const versions = await createPreprocessedVersions(img);
                
                // Return all versions for OCR to try
                resolve(versions);
            } catch (error) {
                logDebug('Preprocessing error', error);
                reject(error);
            }
        };
        
        img.onerror = () => {
            reject(new Error('Failed to load image'));
        };
        
        reader.readAsDataURL(file);
    });
}

// Create multiple preprocessed versions of the image
async function createPreprocessedVersions(img) {
    const maxWidth = 2000;
    const maxHeight = 2000;
    let width = img.width;
    let height = img.height;
    
    // Calculate dimensions maintaining aspect ratio
    if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
    }
    if (height > maxHeight) {
        width = (width * maxHeight) / height;
        height = maxHeight;
    }
    
    logDebug('Target dimensions', { width, height });
    
    // Create canvas for original
    const canvasOriginal = document.createElement('canvas');
    canvasOriginal.width = width;
    canvasOriginal.height = height;
    const ctxOriginal = canvasOriginal.getContext('2d');
    ctxOriginal.drawImage(img, 0, 0, width, height);
    
    // Create grayscale version
    const canvasGray = document.createElement('canvas');
    canvasGray.width = width;
    canvasGray.height = height;
    const ctxGray = canvasGray.getContext('2d');
    ctxGray.drawImage(img, 0, 0, width, height);
    const imageDataGray = ctxGray.getImageData(0, 0, width, height);
    const dataGray = imageDataGray.data;
    
    for (let i = 0; i < dataGray.length; i += 4) {
        const gray = 0.299 * dataGray[i] + 0.587 * dataGray[i + 1] + 0.114 * dataGray[i + 2];
        dataGray[i] = gray;
        dataGray[i + 1] = gray;
        dataGray[i + 2] = gray;
    }
    ctxGray.putImageData(imageDataGray, 0, 0);
    
    // Create high contrast version
    const canvasHighContrast = document.createElement('canvas');
    canvasHighContrast.width = width;
    canvasHighContrast.height = height;
    const ctxHighContrast = canvasHighContrast.getContext('2d');
    ctxHighContrast.drawImage(img, 0, 0, width, height);
    const imageDataHigh = ctxHighContrast.getImageData(0, 0, width, height);
    const dataHigh = imageDataHigh.data;
    
    for (let i = 0; i < dataHigh.length; i += 4) {
        const gray = 0.299 * dataHigh[i] + 0.587 * dataHigh[i + 1] + 0.114 * dataHigh[i + 2];
        // High contrast enhancement
        const contrast = 2.0;
        const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
        const enhanced = Math.max(0, Math.min(255, factor * (gray - 128) + 128));
        
        dataHigh[i] = enhanced;
        dataHigh[i + 1] = enhanced;
        dataHigh[i + 2] = enhanced;
    }
    ctxHighContrast.putImageData(imageDataHigh, 0, 0);
    
    // Create threshold/binary version
    const canvasThreshold = document.createElement('canvas');
    canvasThreshold.width = width;
    canvasThreshold.height = height;
    const ctxThreshold = canvasThreshold.getContext('2d');
    ctxThreshold.drawImage(img, 0, 0, width, height);
    const imageDataThresh = ctxThreshold.getImageData(0, 0, width, height);
    const dataThresh = imageDataThresh.data;
    
    // Calculate average brightness for adaptive threshold
    let totalBrightness = 0;
    for (let i = 0; i < dataThresh.length; i += 4) {
        const gray = 0.299 * dataThresh[i] + 0.587 * dataThresh[i + 1] + 0.114 * dataThresh[i + 2];
        totalBrightness += gray;
    }
    const avgBrightness = totalBrightness / (dataThresh.length / 4);
    const threshold = avgBrightness * 0.85; // Slightly below average
    
    logDebug('Adaptive threshold', { avgBrightness, threshold });
    
    for (let i = 0; i < dataThresh.length; i += 4) {
        const gray = 0.299 * dataThresh[i] + 0.587 * dataThresh[i + 1] + 0.114 * dataThresh[i + 2];
        const binary = gray > threshold ? 255 : 0;
        dataThresh[i] = binary;
        dataThresh[i + 1] = binary;
        dataThresh[i + 2] = binary;
    }
    ctxThreshold.putImageData(imageDataThresh, 0, 0);
    
    // Convert canvases to blobs (await all)
    const [original, grayscale, highContrast, thresholdBlob] = await Promise.all([
        canvasToBlob(canvasOriginal, 'image/jpeg', 0.95),
        canvasToBlob(canvasGray, 'image/jpeg', 0.95),
        canvasToBlob(canvasHighContrast, 'image/jpeg', 0.95),
        canvasToBlob(canvasThreshold, 'image/jpeg', 0.95)
    ]);
    
    return {
        original,
        grayscale,
        highContrast,
        threshold: thresholdBlob
    };
}

// Helper: Convert canvas to blob
function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => {
        canvas.toBlob((blob) => {
            resolve(blob);
        }, type, quality);
    });
}

// OCR Functionality - Try multiple preprocessing versions
async function performOCR(type) {
    const messageDiv = document.getElementById(type === 'aadhaar' ? 'aadhaarOcrMessage' : 'panOcrMessage');
    
    // Use stored file from application state
    const file = type === 'aadhaar' ? aadhaarFile : panFile;
    
    console.log('OCR attempting with file:', {
        type,
        fileExists: !!file,
        fileName: file ? file.name : 'none',
        fileType: file ? file.type : 'none',
        fileSize: file ? file.size : 'none'
    });

    if (!file) {
        messageDiv.textContent = 'Please capture or upload a photo first';
        messageDiv.className = 'ocr-message show error';
        console.error('No file available for OCR', type);
        return;
    }

    messageDiv.textContent = 'Processing document...';
    messageDiv.className = 'ocr-message show info';

    try {
        // Preprocess image - get multiple versions
        const versions = await preprocessImage(file);
        
        // Try OCR on different versions, starting with high contrast
        const ocrVersions = [
            { name: 'high contrast', blob: versions.highContrast },
            { name: 'grayscale', blob: versions.grayscale },
            { name: 'threshold', blob: versions.threshold },
            { name: 'original', blob: versions.original }
        ];
        
        let bestResult = null;
        let bestConfidence = 0;
        
        for (const version of ocrVersions) {
            logDebug(`Trying OCR with ${version} version`);
            
            try {
                const result = await Tesseract.recognize(version.blob, 'eng', {
                    logger: (m) => {
                        if (m.status === 'recognizing text') {
                            messageDiv.textContent = `Processing... (${version}) ${Math.round(m.progress * 100)}%`;
                        }
                    }
                });
                
                const confidence = result.data.confidence || 0;
                logDebug(`${version} OCR confidence`, confidence);
                
                if (confidence > bestConfidence) {
                    bestConfidence = confidence;
                    bestResult = result;
                }
                
                // If we got a good result, stop trying
                if (confidence > 70) {
                    logDebug('Good confidence found, stopping', confidence);
                    break;
                }
            } catch (error) {
                logDebug(`OCR failed for ${version}`, error);
                continue;
            }
        }
        
        if (!bestResult) {
            throw new Error('OCR failed on all versions');
        }
        
        logDebug('Best OCR result', {
            confidence: bestConfidence,
            textLength: bestResult.data.text.length
        });
        
        const text = bestResult.data.text;
        
        if (type === 'aadhaar') {
            processAadhaarOCR(text, messageDiv);
        } else {
            processPanOCR(text, messageDiv);
        }
    } catch (error) {
        console.error('OCR Error:', error);
        logDebug('OCR error', error);
        messageDiv.textContent = 'Unable to read the document clearly. Please retake the photo or enter the details manually.';
        messageDiv.className = 'ocr-message show error';
    }
}

function processAadhaarOCR(text, messageDiv) {
    let detected = false;
    
    // Extract 12-digit Aadhaar number (various formats)
    const aadhaarMatch = text.match(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b|\b\d{12}\b/g);
    
    if (aadhaarMatch) {
        const aadhaarNumber = aadhaarMatch[0].replace(/[\s-]/g, '');
        if (aadhaarNumber.length === 12) {
            document.getElementById('aadhaarNumber').value = aadhaarNumber;
            detected = true;
        }
    }
    
    // Try to extract name (usually appears before Aadhaar number)
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Look for name pattern (uppercase words, not numbers)
        if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/.test(line) && !/\d/.test(line) && line.length > 3 && line.length < 50) {
            // Check if it's not a common header
            const lowerLine = line.toLowerCase();
            if (!lowerLine.includes('aadhaar') && !lowerLine.includes('government') && !lowerLine.includes('india') && !lowerLine.includes('unique')) {
                document.getElementById('fullName').value = line;
                detected = true;
                break;
            }
        }
    }
    
    // Try to extract DOB (format: DD/MM/YYYY or DD-MM-YYYY)
    const dobMatch = text.match(/\b(0[1-9]|[12]\d|3[01])[\/\-](0[1-9]|1[0-2])[\/\-]\d{4}\b/);
    if (dobMatch) {
        const dob = dobMatch[0].replace(/-/g, '/');
        // Convert DD/MM/YYYY to yyyy-MM-dd for HTML date input
        const parts = dob.split('/');
        if (parts.length === 3) {
            const formattedDob = `${parts[2]}-${parts[1]}-${parts[0]}`;
            document.getElementById('dateOfBirth').value = formattedDob;
            detected = true;
        }
    }
    
    if (detected) {
        messageDiv.textContent = 'Please verify the scanned details before saving.';
        messageDiv.className = 'ocr-message show success';
    } else {
        messageDiv.textContent = 'Unable to read the document clearly. Please retake the photo or enter the details manually.';
        messageDiv.className = 'ocr-message show error';
    }
}

function processPanOCR(text, messageDiv) {
    let detected = false;
    
    // Extract PAN pattern: 5 letters + 4 digits + 1 letter
    const panMatch = text.match(/[A-Z]{5}[0-9]{4}[A-Z]{1}/i);
    
    if (panMatch) {
        const panNumber = panMatch[0].toUpperCase();
        document.getElementById('panNumber').value = panNumber;
        detected = true;
    }
    
    // Try to extract name from PAN card
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Look for name pattern
        if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/.test(line) && !/\d/.test(line) && line.length > 3 && line.length < 50) {
            const lowerLine = line.toLowerCase();
            if (!lowerLine.includes('permanent') && !lowerLine.includes('account') && !lowerLine.includes('number') && !lowerLine.includes('income') && !lowerLine.includes('tax')) {
                // Only fill name if empty or if current name is shorter
                const currentName = document.getElementById('fullName').value;
                if (!currentName || line.length > currentName.length) {
                    document.getElementById('fullName').value = line;
                    detected = true;
                }
                break;
            }
        }
    }
    
    // Try to extract DOB
    const dobMatch = text.match(/\b(0[1-9]|[12]\d|3[01])[\/\-](0[1-9]|1[0-2])[\/\-]\d{4}\b/);
    if (dobMatch && !document.getElementById('dateOfBirth').value) {
        const dob = dobMatch[0].replace(/-/g, '/');
        // Convert DD/MM/YYYY to yyyy-MM-dd for HTML date input
        const parts = dob.split('/');
        if (parts.length === 3) {
            const formattedDob = `${parts[2]}-${parts[1]}-${parts[0]}`;
            document.getElementById('dateOfBirth').value = formattedDob;
            detected = true;
        }
    }
    
    if (detected) {
        messageDiv.textContent = 'Please verify the scanned details before saving.';
        messageDiv.className = 'ocr-message show success';
    } else {
        messageDiv.textContent = 'Unable to read the document clearly. Please retake the photo or enter the details manually.';
        messageDiv.className = 'ocr-message show error';
    }
}

// Input Formatting
function formatAadhaar(e) {
    let value = e.target.value.replace(/\D/g, '');
    e.target.value = value;
}

function formatPAN(e) {
    let value = e.target.value.toUpperCase();
    e.target.value = value;
}

// Generate Dynamic UPI URI
function generateUpiUri(amount) {
    const params = new URLSearchParams();
    params.append('pa', UPI_CONFIG.pa);
    params.append('pn', UPI_CONFIG.pn);
    params.append('am', parseFloat(amount).toFixed(2));
    params.append('cu', UPI_CONFIG.cu);
    params.append('tn', UPI_CONFIG.tn);
    
    return `upi://pay?${params.toString()}`;
}

// Generate Dynamic QR Code
function generateQrCode(upiUri) {
    const canvas = document.getElementById('paymentQrCanvas');
    const qrError = document.getElementById('qrError');
    
    if (!canvas) {
        console.error('QR canvas not found');
        return;
    }
    
    try {
        // Use qrious library
        const qr = new QRious({
            element: canvas,
            value: upiUri,
            size: 200,
            level: 'H'
        });
        canvas.style.display = 'block';
        qrError.classList.add('hidden');
    } catch (error) {
        console.error('QR generation error:', error);
        canvas.style.display = 'none';
        qrError.classList.remove('hidden');
    }
}

// Show Payment Modal
function showPaymentModal() {
    const amount = document.getElementById('amount').value;
    const errorDiv = document.getElementById('upiError');

    if (!amount || parseFloat(amount) <= 0) {
        errorDiv.textContent = 'Please enter the amount first.';
        errorDiv.classList.add('show');
        return;
    }

    if (parseFloat(amount) <= 0) {
        errorDiv.textContent = 'Please enter a valid amount.';
        errorDiv.classList.add('show');
        return;
    }

    errorDiv.classList.remove('show');

    // Display amount in modal
    const formattedAmount = parseFloat(amount).toLocaleString('en-IN');
    document.getElementById('paymentModalAmount').textContent = `₹${formattedAmount}`;

    // Generate dynamic UPI URI
    const upiUri = generateUpiUri(amount);
    console.log('Generated UPI URI:', upiUri);

    // Generate dynamic QR code
    generateQrCode(upiUri);

    // Show modal
    paymentModal.classList.remove('hidden');
}

// Close Payment Modal
function closePaymentModal() {
    paymentModal.classList.add('hidden');
}

// Open UPI App
function openUpiApp() {
    const amount = document.getElementById('amount').value;
    const errorDiv = document.getElementById('upiError');

    if (!amount || parseFloat(amount) <= 0) {
        errorDiv.textContent = 'Please enter a valid amount.';
        errorDiv.classList.add('show');
        closePaymentModal();
        return;
    }

    // Generate dynamic UPI URI (same as QR)
    const upiUri = generateUpiUri(amount);
    console.log('Opening UPI app with URI:', upiUri);

    // Try to open UPI app
    try {
        window.location.href = upiUri;
        showToast('Opening UPI app...', 'success');
        closePaymentModal();
        
        // Update payment status to pending
        document.getElementById('paymentStatus').textContent = 'Pending';
        document.getElementById('paymentStatus').className = 'status-badge status-pending';
    } catch (error) {
        errorDiv.textContent = 'Unable to open a UPI app. Please scan the QR code instead.';
        errorDiv.classList.add('show');
        closePaymentModal();
    }
}

// Form Validation
function validateForm() {
    let isValid = true;
    
    // Full Name
    const fullName = document.getElementById('fullName').value.trim();
    if (!fullName) {
        showError('fullNameError', 'Please enter full name');
        isValid = false;
    } else {
        hideError('fullNameError');
    }

    // Aadhaar Number
    const aadhaar = document.getElementById('aadhaarNumber').value;
    if (!/^\d{12}$/.test(aadhaar)) {
        showError('aadhaarNumberError', 'Please enter a valid 12-digit Aadhaar number');
        isValid = false;
    } else {
        hideError('aadhaarNumberError');
    }

    // PAN Number
    const pan = document.getElementById('panNumber').value.toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan)) {
        showError('panNumberError', 'Please enter a valid PAN number (ABCDE1234F)');
        isValid = false;
    } else {
        hideError('panNumberError');
    }

    // Date of Birth
    const dob = document.getElementById('dateOfBirth').value;
    if (!dob) {
        showError('dateOfBirthError', 'Please select date of birth');
        isValid = false;
    } else {
        hideError('dateOfBirthError');
    }

    // Amount
    const amount = document.getElementById('amount').value;
    if (!amount || parseFloat(amount) <= 0) {
        showError('amountError', 'Please enter a valid amount greater than ₹0');
        isValid = false;
    } else {
        hideError('amountError');
    }

    return isValid;
}

function showError(elementId, message) {
    const errorDiv = document.getElementById(elementId);
    errorDiv.textContent = message;
    errorDiv.classList.add('show');
}

function hideError(elementId) {
    const errorDiv = document.getElementById(elementId);
    errorDiv.classList.remove('show');
}

// Form Submission Handler
async function handleFormSubmit(e) {
    e.preventDefault();
    const submitError = document.getElementById('submitError');

    if (!validateForm()) {
        submitError.textContent = 'Please fix the errors above';
        submitError.classList.add('show');
        return;
    }

    submitError.classList.remove('show');

    // Debug: Check file availability before upload
    console.log('Before upload - File state:', {
        aadhaarFileExists: !!aadhaarFile,
        aadhaarFileSize: aadhaarFile ? aadhaarFile.size : 0,
        aadhaarFileType: aadhaarFile ? aadhaarFile.type : 'none',
        panFileExists: !!panFile,
        panFileSize: panFile ? panFile.size : 0,
        panFileType: panFile ? panFile.type : 'none'
    });

    // Convert files to base64 for upload
    let aadhaarBase64 = null;
    let panBase64 = null;

    if (aadhaarFile) {
        aadhaarBase64 = await fileToBase64(aadhaarFile);
        console.log('Aadhaar converted to base64, length:', aadhaarBase64?.length);
    }

    if (panFile) {
        panBase64 = await fileToBase64(panFile);
        console.log('PAN converted to base64, length:', panBase64?.length);
    }

    const application = {
        applicationId: editingApplicationId || generateApplicationId(),
        date: new Date().toISOString().split('T')[0],
        time: new Date().toLocaleTimeString('en-US', { hour12: false }),
        fullName: document.getElementById('fullName').value.trim(),
        aadhaarNumber: document.getElementById('aadhaarNumber').value,
        panNumber: document.getElementById('panNumber').value.toUpperCase(),
        dateOfBirth: document.getElementById('dateOfBirth').value,
        amount: parseFloat(document.getElementById('amount').value),
        paymentStatus: document.getElementById('paymentStatus').textContent,
        paymentTimestamp: document.getElementById('paymentStatus').textContent === 'Paid' ? new Date().toISOString() : null,
        createdBy: 'System',
        aadhaarPhoto: aadhaarBase64,
        panPhoto: panBase64
    };

    try {
        console.log('Sending application to backend:', {
            hasAadhaar: !!application.aadhaarPhoto,
            hasPan: !!application.panPhoto,
            aadhaarLength: application.aadhaarPhoto?.length,
            panLength: application.panPhoto?.length
        });

        // Try to send to Google Sheets
        if (GOOGLE_SCRIPT_URL && GOOGLE_SCRIPT_URL !== 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
            await sendToGoogleSheets(application);
        }

        // Save to local storage as backup
        if (editingApplicationId) {
            const index = applications.findIndex(app => app.applicationId === editingApplicationId);
            if (index !== -1) {
                applications[index] = application;
            }
        } else {
            applications.push(application);
        }
        
        localStorage.setItem('applications', JSON.stringify(applications));

        showToast(`Application ${editingApplicationId ? 'updated' : 'saved'} successfully. ID: ${application.applicationId}`, 'success');
        
        // Reset and go to dashboard
        editingApplicationId = null;
        aadhaarFile = null;
        panFile = null;
        showDashboard();
    } catch (error) {
        console.error('Save Error:', error);
        submitError.textContent = 'Unable to save the application. Please try again.';
        submitError.classList.add('show');
    }
}

// Helper: Convert File to Base64
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            // Remove data URL prefix to get pure base64
            const base64 = result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = (error) => {
            console.error('File to base64 error:', error);
            reject(error);
        };
        reader.readAsDataURL(file);
    });
}

// Generate Application ID
function generateApplicationId() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `APP${timestamp}${random}`;
}

// Google Sheets Integration
async function sendToGoogleSheets(application) {
    const response = await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(application)
    });

    // Since no-cors mode doesn't allow reading response, we assume success if no error
    return response;
}

// Load Applications
function loadApplications() {
    const saved = localStorage.getItem('applications');
    if (saved) {
        applications = JSON.parse(saved);
    }
}

// Update Dashboard Stats
function updateDashboardStats() {
    const totalApps = applications.length;
    const pendingPayments = applications.filter(app => app.paymentStatus === 'Pending').length;
    const paidApps = applications.filter(app => app.paymentStatus === 'Paid').length;
    const totalAmount = applications
        .filter(app => app.paymentStatus === 'Paid')
        .reduce((sum, app) => sum + (app.amount || 0), 0);

    document.getElementById('totalApps').textContent = totalApps;
    document.getElementById('pendingPayments').textContent = pendingPayments;
    document.getElementById('paidApps').textContent = paidApps;
    document.getElementById('totalAmount').textContent = `₹${totalAmount.toLocaleString('en-IN')}`;
}

// Render Applications List
function renderApplicationsList(filteredApps = null) {
    const listContainer = document.getElementById('applicationsList');
    const appsToRender = filteredApps || applications;

    if (appsToRender.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z"/>
                </svg>
                <p>No applications found</p>
            </div>
        `;
        return;
    }

    listContainer.innerHTML = appsToRender.map(app => `
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
                    ${app.paymentStatus === 'Pending' ? `<button class="btn-action" onclick="markAsPaid('${app.applicationId}')">Mark Paid</button>` : ''}
                    <button class="btn-action btn-action-delete" onclick="deleteApplication('${app.applicationId}')">Delete</button>
                </div>
            </div>
        </div>
    `).join('');
}

// Filter Applications
function filterApplications() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;
    const dateFilter = document.getElementById('dateFilter').value;

    const filtered = applications.filter(app => {
        const matchesSearch = !searchTerm || 
            app.fullName.toLowerCase().includes(searchTerm) ||
            app.applicationId.toLowerCase().includes(searchTerm);
        
        const matchesStatus = !statusFilter || app.paymentStatus === statusFilter;
        
        const matchesDate = !dateFilter || app.date === dateFilter;

        return matchesSearch && matchesStatus && matchesDate;
    });

    renderApplicationsList(filtered);
}

// View Application
function viewApplication(applicationId) {
    const app = applications.find(a => a.applicationId === applicationId);
    if (!app) return;

    const modalBody = document.getElementById('modalBody');
    modalBody.innerHTML = `
        <div class="modal-detail">
            <label>Application ID</label>
            <p>${app.applicationId}</p>
        </div>
        <div class="modal-detail">
            <label>Date & Time</label>
            <p>${formatDate(app.date)} at ${app.time}</p>
        </div>
        <div class="modal-detail">
            <label>Full Name</label>
            <p>${escapeHtml(app.fullName)}</p>
        </div>
        <div class="modal-detail">
            <label>Aadhaar Number</label>
            <p class="masked">${app.aadhaarNumber}</p>
        </div>
        <div class="modal-detail">
            <label>PAN Number</label>
            <p class="masked">${app.panNumber}</p>
        </div>
        <div class="modal-detail">
            <label>Date of Birth</label>
            <p>${formatDate(app.dateOfBirth)}</p>
        </div>
        <div class="modal-detail">
            <label>Amount</label>
            <p>₹${app.amount.toLocaleString('en-IN')}</p>
        </div>
        <div class="modal-detail">
            <label>Payment Status</label>
            <p><span class="status-badge ${app.paymentStatus === 'Paid' ? 'status-paid' : 'status-pending'}">${app.paymentStatus}</span></p>
        </div>
        <div class="modal-detail">
            <label>Created By</label>
            <p>${escapeHtml(app.createdBy)}</p>
        </div>
    `;

    viewModal.classList.remove('hidden');
}

// Edit Application
function editApplication(applicationId) {
    const app = applications.find(a => a.applicationId === applicationId);
    if (!app) return;

    editingApplicationId = applicationId;

    document.getElementById('fullName').value = app.fullName;
    document.getElementById('aadhaarNumber').value = app.aadhaarNumber;
    document.getElementById('panNumber').value = app.panNumber;
    document.getElementById('dateOfBirth').value = app.dateOfBirth;
    document.getElementById('amount').value = app.amount;
    
    const statusBadge = document.getElementById('paymentStatus');
    statusBadge.textContent = app.paymentStatus;
    statusBadge.className = `status-badge ${app.paymentStatus === 'Paid' ? 'status-paid' : 'status-pending'}`;

    showForm();
}

// Mark as Paid
function markAsPaid(applicationId) {
    const app = applications.find(a => a.applicationId === applicationId);
    if (!app) return;

    if (confirm('Mark this application as paid?')) {
        app.paymentStatus = 'Paid';
        app.paymentTimestamp = new Date().toISOString();
        
        localStorage.setItem('applications', JSON.stringify(applications));
        updateDashboardStats();
        renderApplicationsList();
        
        // Try to update in Google Sheets
        if (GOOGLE_SCRIPT_URL && GOOGLE_SCRIPT_URL !== 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
            sendToGoogleSheets(app).catch(console.error);
        }

        showToast('Payment status updated', 'success');
    }
}

// Delete Application
function deleteApplication(applicationId) {
    const app = applications.find(a => a.applicationId === applicationId);
    if (!app) return;

    if (confirm(`Are you sure you want to delete application ${applicationId}? This action cannot be undone.`)) {
        applications = applications.filter(a => a.applicationId !== applicationId);
        localStorage.setItem('applications', JSON.stringify(applications));
        updateDashboardStats();
        renderApplicationsList();
        showToast('Application deleted', 'success');
    }
}

// Close Modal
function closeModal() {
    viewModal.classList.add('hidden');
}

// Reset Form
function resetForm() {
    document.getElementById('applicationForm').reset();
    editingApplicationId = null;

    // Reset photo previews
    document.getElementById('aadhaarPhotoPlaceholder').classList.remove('hidden');
    document.getElementById('aadhaarPhotoPreview').classList.add('hidden');
    document.getElementById('panPhotoPlaceholder').classList.remove('hidden');
    document.getElementById('panPhotoPreview').classList.add('hidden');

    // Reset OCR messages
    document.getElementById('aadhaarOcrMessage').classList.remove('show');
    document.getElementById('panOcrMessage').classList.remove('show');

    // Reset payment status
    document.getElementById('paymentStatus').textContent = 'Pending';
    document.getElementById('paymentStatus').className = 'status-badge status-pending';

    // Clear errors
    document.querySelectorAll('.error-message').forEach(el => el.classList.remove('show'));
}

// Utility Functions
function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function maskAadhaar(aadhaar) {
    if (!aadhaar || aadhaar.length < 4) return aadhaar;
    return 'XXXX XXXX ' + aadhaar.slice(-4);
}

function maskPAN(pan) {
    if (!pan || pan.length < 4) return pan;
    return 'XXXXX' + pan.slice(-5);
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.remove('hidden');

    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// Make functions globally available for onclick handlers
window.viewApplication = viewApplication;
window.editApplication = editApplication;
window.markAsPaid = markAsPaid;
window.deleteApplication = deleteApplication;
