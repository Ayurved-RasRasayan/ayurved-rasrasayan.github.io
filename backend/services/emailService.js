const axios = require('axios');

const sendEmail = async (payload) => {
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'NaturaBotanica', email: 'sales.naturabotanica20@gmail.com' },
      ...payload
    }, { headers: { 'api-key': process.env.EMAIL_PASS, 'content-type': 'application/json' } });
    return true;
  } catch (e) { console.error('[EMAIL] ❌ Error:', e.response?.data || e.message); return false; }
};

exports.sendClientEmail = (toEmail, toName, orderId, status) => {
  const displayStatus = status === 'Success' ? 'Payment Successful' : status;
  return sendEmail({ to: [{ email: toEmail, name: toName }], subject: `Order Update: #${orderId}`, htmlContent: `<h3>Hello ${toName},</h3><p>Your order #${orderId} is now: <strong>${displayStatus}</strong>.</p><p>Thank you!</p>` });
};

exports.sendAdminAlert = async (orderId, data) => {
  let itemsHtml = '<table style="width:100%;border-collapse:collapse;margin-top:10px;"><tr style="background:#f9fafb;"><th style="border:1px solid #e5e7eb;padding:8px;">Item</th><th style="border:1px solid #e5e7eb;padding:8px;">Form</th><th style="border:1px solid #e5e7eb;padding:8px;">Unit</th><th style="border:1px solid #e5e7eb;padding:8px;">Qty</th><th style="border:1px solid #e5e7eb;padding:8px;">Price</th></tr>';
  (data.items || []).forEach(i => { itemsHtml += `<tr><td style="border:1px solid #e5e7eb;padding:8px;">${i.name}</td><td style="border:1px solid #e5e7eb;padding:8px;">${i.form || 'N/A'}</td><td style="border:1px solid #e5e7eb;padding:8px;">${i.unit || 'N/A'}</td><td style="border:1px solid #e5e7eb;padding:8px;text-align:center;">${i.qty||1}</td><td style="border:1px solid #e5e7eb;padding:8px;">$${i.price||0}</td></tr>`; });
  itemsHtml += '</table>';
  return sendEmail({ to: [{ email: 'sales.naturabotanica20@gmail.com', name: 'Sales Team' }], subject: `🛒 NEW ORDER: #${orderId} - ${data.clientDetails.name}`, htmlContent: `<div style="font-family:Arial;color:#333;"><h2 style="color:#2d4a22;">New Order (#${orderId})</h2><p><b>Name:</b> ${data.clientDetails.name}<br><b>Email:</b> ${data.clientDetails.email}<br><b>Phone:</b> ${data.clientDetails.phone}</p><p><b>Total:</b> $${data.totalUSD} (${data.totalNPR} NPR)</p>${itemsHtml}${data.paymentScreenshot ? `<p>📸 <a href="${data.paymentScreenshot}" target="_blank">View Screenshot</a></p>` : ''}</div>` });
};

exports.sendInquiryAlert = async (data) => {
  const fullName = `${data.firstName || ''} ${data.lastName || ''}`.trim();
  return sendEmail({ to: [{ email: process.env.RECEIVER_EMAIL, name: 'Sales Team' }], subject: `📨 New Inquiry: ${fullName} (${data.company || 'Individual'})`, htmlContent: `<div style="font-family:Arial;color:#333;padding:20px;border:1px solid #eee;"><h2 style="color:#A3B14B;">New Inquiry Received</h2><p style="background:#f9fafb;padding:10px;border-radius:5px;"><strong>Name:</strong> ${fullName}<br><strong>Email:</strong> ${data.email}<br><strong>Company:</strong> ${data.company || 'N/A'}</p><div style="margin-top:20px;"><strong>Message:</strong><p style="background:#fff;padding:15px;border:1px solid #eee;margin-top:5px;">${data.message}</p></div></div>` });
};

exports.sendOTPEmail = (toEmail, toName, otp) => {
  return sendEmail({ to: [{ email: toEmail, name: toName }], subject: 'NaturaBotanica - Verify Your Email', htmlContent: `<div style="font-family:Arial;color:#333;text-align:center;padding:40px;"><h2 style="color:#2d4a22;">Email Verification</h2><p>Hello ${toName},</p><p>Your verification code is:</p><h1 style="font-size:40px;color:#A3B14B;letter-spacing:5px;">${otp}</h1><p>This code expires in 10 minutes.</p></div>` });
};