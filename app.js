// Application State
let applications = [];
let editingApplicationId = null;

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
    document.getElementById('payNowBtn').addEventListener('click', showPaymentModal);
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
}

// Photo Upload Setup
function setupPhotoUpload(inputId, placeholderId, previewId, imgId, retakeBtnId) {
    const input = document.getElementById(inputId);
    const placeholder = document.getElementById(placeholderId);
    const preview = document.getElementById(previewId);
    const img = document.getElementById(imgId);
    const retakeBtn = document.getElementById(retakeBtnId);

    placeholder.addEventListener('click', () => input.click());
    retakeBtn.addEventListener('click', () => input.click());

    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                img.src = event.target.result;
                placeholder.classList.add('hidden');
                preview.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        }
    });
}

// Image Preprocessing for OCR
async function preprocessImage(file) {
    return new Promise((resolve) => {
        const img = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        img.onload = () => {
            // Resize to optimal dimensions for OCR
            const maxWidth = 2000;
            const maxHeight = 2000;
            let width = img.width;
            let height = img.height;
            
            if (width > maxWidth) {
                height = (height * maxWidth) / width;
                width = maxWidth;
            }
            if (height > maxHeight) {
                width = (width * maxHeight) / height;
                height = maxHeight;
            }
            
            canvas.width = width;
            canvas.height = height;
            
            // Draw image
            ctx.drawImage(img, 0, 0, width, height);
            
            // Get image data for processing
            let imageData = ctx.getImageData(0, 0, width, height);
            let data = imageData.data;
            
            // Convert to grayscale and enhance contrast
            for (let i = 0; i < data.length; i += 4) {
                const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                // Contrast enhancement
                const contrast = 1.5;
                const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
                const enhanced = factor * (gray - 128) + 128;
                
                data[i] = enhanced;
                data[i + 1] = enhanced;
                data[i + 2] = enhanced;
            }
            
            ctx.putImageData(imageData, 0, 0);
            
            // Convert to blob
            canvas.toBlob((blob) => {
                resolve(blob);
            }, 'image/jpeg', 0.95);
        };
        
        img.src = URL.createObjectURL(file);
    });
}

// OCR Functionality
async function performOCR(type) {
    const inputId = type === 'aadhaar' ? 'aadhaarPhoto' : 'panPhoto';
    const input = document.getElementById(inputId);
    const messageDiv = document.getElementById(type === 'aadhaar' ? 'aadhaarOcrMessage' : 'panOcrMessage');

    if (!input.files || !input.files[0]) {
        messageDiv.textContent = 'Please upload a photo first';
        messageDiv.className = 'ocr-message show error';
        return;
    }

    messageDiv.textContent = 'Processing... Please wait';
    messageDiv.className = 'ocr-message show info';

    try {
        // Preprocess image for better OCR
        const processedImage = await preprocessImage(input.files[0]);
        
        const result = await Tesseract.recognize(processedImage, 'eng', {
            logger: (m) => {
                if (m.status === 'recognizing text') {
                    messageDiv.textContent = `Processing... ${Math.round(m.progress * 100)}%`;
                }
            }
        });

        const text = result.data.text;
        
        if (type === 'aadhaar') {
            processAadhaarOCR(text, messageDiv);
        } else {
            processPanOCR(text, messageDiv);
        }
    } catch (error) {
        console.error('OCR Error:', error);
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
        document.getElementById('dateOfBirth').value = dob;
        detected = true;
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
        document.getElementById('dateOfBirth').value = dob;
        detected = true;
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

    // Construct UPI intent URL
    const upiUrl = `upi://pay?pa=${encodeURIComponent(UPI_CONFIG.pa)}&pn=${encodeURIComponent(UPI_CONFIG.pn)}&am=${parseFloat(amount).toFixed(2)}&cu=${UPI_CONFIG.cu}&tn=${encodeURIComponent(UPI_CONFIG.tn)}`;

    // Try to open UPI app
    try {
        window.location.href = upiUrl;
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
        createdBy: 'System'
    };

    try {
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
        showDashboard();
    } catch (error) {
        console.error('Save Error:', error);
        submitError.textContent = 'Unable to save the application. Please try again.';
        submitError.classList.add('show');
    }
}

// Generate Application ID
function generateApplicationId() {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const count = applications.filter(app => app.applicationId && app.applicationId.includes(dateStr)).length + 1;
    const countStr = count.toString().padStart(4, '0');
    return `APP-${dateStr}-${countStr}`;
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
