# Admin Portal - Application Form

A professional, mobile-first admin-only application form for collecting and managing applications with Aadhaar/PAN OCR, UPI payment integration, and Google Sheets backend.

## Features

- **Admin-Only Access**: Secure login system (prototype authentication)
- **Mobile-First Design**: Responsive layout optimized for Android, iPhone, tablets, and desktop
- **Aadhaar OCR**: Camera capture with automatic Aadhaar number detection using Tesseract.js
- **PAN OCR**: Camera capture with automatic PAN number detection and validation
- **Dynamic UPI Payment**: Opens UPI app with exact amount entered by admin
- **QR Code Fallback**: Static QR code for manual scanning
- **Admin Dashboard**: Statistics, search, filter, and application management
- **Google Sheets Integration**: Automatic data backup to Google Sheets
- **Data Security**: Masked Aadhaar/PAN display, secure data handling
- **Form Validation**: Comprehensive validation for all fields

## Quick Start

### 1. Open the Application

Simply open `index.html` in a web browser. No server required for the prototype.

### 2. Login (Prototype)

For the prototype, use any email and password:
- Email: `admin@example.com` (or any email)
- Password: `any password`

**Note**: In production, implement proper backend authentication.

### 3. Create Application

1. Click "+ New Application"
2. Enter Full Name
3. Take/upload Aadhaar photo → Click "Scan Aadhaar & Auto Fill"
4. Verify/correct Aadhaar number
5. Take/upload PAN photo → Click "Scan PAN & Auto Fill"
6. Verify/correct PAN number
7. Enter Date of Birth
8. Enter Amount (e.g., ₹1500)
9. Click "Pay via UPI" → Opens UPI app with exact amount
10. Click "Save Application"
11. Note the Application ID (e.g., APP-20261018-0001)

### 4. Manage Applications

- View all applications in the dashboard
- Search by name or Application ID
- Filter by payment status or date
- View, edit, mark as paid, or delete applications
- View statistics: Total, Pending, Paid, Total Amount

## Google Sheets Setup (Optional but Recommended)

### Step 1: Create Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com)
2. Create a new sheet
3. Add these headers in row 1:
   ```
   Application ID | Date | Time | Full Name | Aadhaar Number | PAN Number | Date of Birth | Amount | Payment Status | Payment Reference | Created By
   ```

### Step 2: Deploy Apps Script

1. In your Google Sheet, go to **Extensions > Apps Script**
2. Delete any existing code
3. Copy the entire contents of `GoogleAppsScript.gs`
4. Paste it into the script editor
5. Click **Deploy > New deployment**
6. Select type: **Web app**
7. Description: "Admin Application Backend"
8. Execute as: **Me**
9. Who has access: **Anyone** (for prototype) or **Only myself** (for production)
10. Click **Deploy**
11. Copy the Web App URL

### Step 3: Connect Application

1. Open `app.js`
2. Find this line:
   ```javascript
   const GOOGLE_SCRIPT_URL = 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE';
   ```
3. Replace with your actual Web App URL:
   ```javascript
   const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/XXXXX/exec';
   ```
4. Save the file

## File Structure

```
Selvan/
├── index.html              # Main HTML file with all screens
├── styles.css              # Responsive CSS styling
├── app.js                  # Application logic and OCR
├── GoogleAppsScript.gs     # Google Sheets backend script
└── README.md               # This file
```

## UPI Configuration

The application uses these UPI details (configured in `app.js`):

- **UPI ID**: 9789051375@axl
- **Payee Name**: DENNI MUTHU
- **Currency**: INR
- **Transaction Note**: Application Payment

To change these, modify the `UPI_CONFIG` object in `app.js`:

```javascript
const UPI_CONFIG = {
    pa: 'your-upi-id@bank',
    pn: 'PAYEE NAME',
    cu: 'INR',
    tn: 'Application Payment'
};
```

## OCR Functionality

The application uses Tesseract.js for browser-side OCR:

- **Aadhaar**: Detects 12-digit numbers
- **PAN**: Detects 10-character PAN format (5 letters + 4 digits + 1 letter)

**Important**: OCR results must always be verified by the admin before saving.

## Security Considerations

### For Production

1. **Authentication**: Implement proper backend authentication
2. **HTTPS**: Use HTTPS in production
3. **Google Sheet Access**: Restrict to authorized users only
4. **API Keys**: Never expose API keys in frontend code
5. **Data Masking**: Aadhaar and PAN are masked in the dashboard
6. **Rate Limiting**: Add rate limiting to prevent abuse
7. **Audit Logs**: Implement logging for all actions
8. **Database**: Consider using a proper database (Firebase, PostgreSQL, etc.)

### Current Prototype Limitations

- Authentication is mock (any email/password works)
- Data stored in localStorage (not for production)
- No actual payment verification (status remains "Pending" unless manually marked)
- OCR runs in browser (may be less accurate than server-side)

## Browser Compatibility

- Chrome/Edge (recommended)
- Firefox
- Safari
- Mobile browsers (Android Chrome, iOS Safari)

## Troubleshooting

### OCR Not Working

- Ensure you have a stable internet connection (Tesseract.js loads from CDN)
- Try using a clearer, well-lit photo
- Manual entry is always available as fallback

### UPI Not Opening

- Ensure you have a UPI app installed (PhonePe, GPay, Paytm, etc.)
- Try the QR code fallback
- Check that the amount is greater than 0

### Google Sheets Not Saving

- Verify the Web App URL is correct in `app.js`
- Check that the Google Sheet has the correct headers
- Ensure the Apps Script is deployed as a Web App
- Check browser console for errors

### Camera Not Working

- Ensure you've granted camera permissions
- Try selecting an existing photo instead
- Some browsers block camera on non-HTTPS sites (use localhost or HTTPS)

## Customization

### Change Colors

Edit the CSS variables in `styles.css`:

```css
:root {
    --primary-blue: #2563eb;
    --primary-blue-dark: #1d4ed8;
    /* ... other colors */
}
```

### Add More Fields

1. Add HTML input in `index.html`
2. Add validation in `validateForm()` in `app.js`
3. Add to Google Sheet headers and `GoogleAppsScript.gs`

### Change Validation Rules

Edit the validation functions in `app.js`:

```javascript
// Aadhaar validation
if (!/^\d{12}$/.test(aadhaar)) {
    // error
}

// PAN validation
if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan)) {
    // error
}
```

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review browser console for errors
3. Verify Google Apps Script deployment
4. Ensure all files are in the same directory

## License

This is an internal admin tool. Customize as needed for your organization.

## Version History

- v1.0.0 - Initial release with all core features
