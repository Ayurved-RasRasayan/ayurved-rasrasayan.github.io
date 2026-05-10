const axios = require('axios');

// ==========================================
// BASE EMAIL SENDER (Brevo API)
// ==========================================
const sendEmail = async (payload) => {
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'NaturaBotanica', email: 'sales.naturabotanica20@gmail.com' },
      ...payload
    }, { headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' } });
    return true;
  } catch (e) { 
    console.error('[EMAIL] ❌ Error:', e.response?.data || e.message); 
    return false; 
  }
};

// ==========================================
// CLIENT: ORDER STATUS UPDATE
// ==========================================
exports.sendClientEmail = (toEmail, toName, orderId, status) => {
  const displayStatus = status === 'Success' ? 'Payment Successful' : status;
  return sendEmail({ 
    to: [{ email: toEmail, name: toName }], 
    subject: `Order Update: #${orderId}`, 
    htmlContent: `
      <div style="font-family:'Inter',Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#FAFAF9;border-radius:16px;border:1px solid #E7E5E4;">
        <h2 style="color:#1C1917;margin:0 0 16px;">Order Update</h2>
        <p style="color:#57534E;font-size:15px;">Hello ${toName},</p>
        <p style="color:#57534E;font-size:15px;">Your order <strong>#${orderId}</strong> status is now:</p>
        <div style="background:#FFFFFF;padding:16px;border-radius:12px;text-align:center;margin:16px 0;border:1px solid #E7E5E4;">
          <p style="font-size:18px;font-weight:600;color:#1C1917;margin:0;">${displayStatus}</p>
        </div>
        <p style="color:#78716C;font-size:13px;margin-top:20px;">Thank you for shopping with NaturaBotanica!</p>
      </div>
    ` 
  });
};

// ==========================================
// ADMIN: NEW ORDER ALERT
// ==========================================
exports.sendAdminAlert = async (orderId, data) => {
  let itemsHtml = '<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:13px;"><tr style="background:#f9fafb;"><th style="border:1px solid #e5e7eb;padding:8px;text-align:left;">Item</th><th style="border:1px solid #e5e7eb;padding:8px;">Form</th><th style="border:1px solid #e5e7eb;padding:8px;">Unit</th><th style="border:1px solid #e5e7eb;padding:8px;">Qty</th><th style="border:1px solid #e5e7eb;padding:8px;text-align:right;">Price</th></tr>';
  (data.items || []).forEach(i => { 
    itemsHtml += `<tr><td style="border:1px solid #e5e7eb;padding:8px;">${i.name}</td><td style="border:1px solid #e5e7eb;padding:8px;text-align:center;">${i.form || 'N/A'}</td><td style="border:1px solid #e5e7eb;padding:8px;text-align:center;">${i.unit || 'N/A'}</td><td style="border:1px solid #e5e7eb;padding:8px;text-align:center;">${i.qty||1}</td><td style="border:1px solid #e5e7eb;padding:8px;text-align:right;">NPR ${(i.price||0).toLocaleString()}</td></tr>`; 
  });
  itemsHtml += '</table>';

  return sendEmail({ 
    to: [{ email: 'sales.naturabotanica20@gmail.com', name: 'Sales Team' }], 
    subject: `🛒 NEW ORDER: #${orderId} - ${data.clientDetails.name}`, 
    htmlContent: `
      <div style="font-family:'Inter',Arial,sans-serif;color:#333;max-width:560px;margin:0 auto;padding:24px;background:#FAFAF9;border-radius:16px;border:1px solid #E7E5E4;">
        <h2 style="color:#2d4a22;margin:0 0 16px;">New Order (#${orderId})</h2>
        <div style="background:#fff;padding:16px;border-radius:12px;border:1px solid #e5e7eb;margin-bottom:16px;">
          <p style="margin:0 0 8px;"><strong>Name:</strong> ${data.clientDetails.name}</p>
          <p style="margin:0 0 8px;"><strong>Email:</strong> ${data.clientDetails.email}</p>
          <p style="margin:0;"><strong>Phone:</strong> ${data.clientDetails.phone}</p>
        </div>
        <div style="background:#fff;padding:16px;border-radius:12px;border:1px solid #e5e7eb;margin-bottom:16px;">
          <p style="margin:0 0 8px;font-size:16px;"><strong>Total:</strong> NPR ${data.totalNPR.toLocaleString()} <span style="color:#78716C;font-size:13px;">($${data.totalUSD})</span></p>
          ${itemsHtml}
        </div>
        ${data.paymentScreenshot ? `<div style="background:#fff;padding:16px;border-radius:12px;border:1px solid #e5e7eb;"><p style="margin:0 0 8px;font-weight:600;">📸 Payment Proof:</p><a href="${data.paymentScreenshot}" target="_blank" style="color:#A3B14B;text-decoration:underline;">View Screenshot</a></div>` : ''}
      </div>
    ` 
  });
};

// ==========================================
// ADMIN: NEW INQUIRY ALERT
// ==========================================
exports.sendInquiryAlert = async (data) => {
  const fullName = `${data.firstName || ''} ${data.lastName || ''}`.trim();
  return sendEmail({ 
    to: [{ email: process.env.RECEIVER_EMAIL, name: 'Sales Team' }], 
    subject: `📨 New Inquiry: ${fullName} (${data.company || 'Individual'})`, 
    htmlContent: `
      <div style="font-family:'Inter',Arial,sans-serif;color:#333;max-width:480px;margin:0 auto;padding:24px;background:#FAFAF9;border-radius:16px;border:1px solid #E7E5E4;">
        <h2 style="color:#A3B14B;margin:0 0 16px;">New Inquiry Received</h2>
        <div style="background:#fff;padding:16px;border-radius:12px;border:1px solid #e5e7eb;margin-bottom:16px;">
          <p style="margin:0 0 8px;"><strong>Name:</strong> ${fullName}</p>
          <p style="margin:0 0 8px;"><strong>Email:</strong> ${data.email}</p>
          <p style="margin:0;"><strong>Company:</strong> ${data.company || 'N/A'}</p>
        </div>
        <div style="background:#fff;padding:16px;border-radius:12px;border:1px solid #e5e7eb;">
          <p style="margin:0 0 8px;font-weight:600;">Message:</p>
          <p style="margin:0;color:#57534E;line-height:1.6;">${data.message}</p>
        </div>
      </div>
    ` 
  });
};

// ==========================================
// SIGNUP: EMAIL VERIFICATION OTP (5 min)
// ==========================================
exports.sendOTPEmail = (toEmail, toName, otp) => {
  return sendEmail({ 
    to: [{ email: toEmail, name: toName }], 
    subject: 'NaturaBotanica — Verify Your Email', 
    htmlContent: `
      <div style="font-family:'Inter',Arial,sans-serif;max-width:400px;margin:0 auto;padding:24px;background:#FAFAF9;border-radius:16px;">
        <div style="text-align:center;margin-bottom:24px;">
          <h2 style="color:#1C1917;margin:0;">Verify Your Email</h2>
          <p style="color:#78716C;font-size:14px;">Hello ${toName}, enter this code to verify your account.</p>
        </div>
        <div style="background:#FFFFFF;border:2px dashed #A3B14B;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px;">
          <p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#A3B14B;margin:0;">${otp}</p>
        </div>
        <p style="color:#EF4444;font-size:12px;text-align:center;font-weight:600;">⚠️ This code expires in 5 minutes.</p>
        <p style="color:#78716C;font-size:12px;text-align:center;margin-top:16px;">If you didn't create an account, ignore this email.</p>
      </div>
    ` 
  });
};

// ==========================================
// PASSWORD RESET OTP (5 min) - NEW
// ==========================================
exports.sendResetEmail = (toEmail, toName, otp) => {
  return sendEmail({ 
    to: [{ email: toEmail, name: toName }], 
    subject: 'NaturaBotanica — Password Reset Code', 
    htmlContent: `
      <div style="font-family:'Inter',Arial,sans-serif;max-width:400px;margin:0 auto;padding:24px;background:#FAFAF9;border-radius:16px;">
        <div style="text-align:center;margin-bottom:24px;">
          <h2 style="color:#1C1917;margin:0;">Reset Your Password</h2>
          <p style="color:#78716C;font-size:14px;">Hello ${toName}, use this code to set a new password.</p>
        </div>
        <div style="background:#FFFFFF;border:2px dashed #EF4444;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px;">
          <p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#EF4444;margin:0;">${otp}</p>
        </div>
        <p style="color:#EF4444;font-size:12px;text-align:center;font-weight:600;">⚠️ This code expires in 5 minutes.</p>
        <p style="color:#78716C;font-size:12px;text-align:center;margin-top:16px;">If you didn't request a password reset, ignore this email. Your account is safe.</p>
      </div>
    ` 
  });
};
