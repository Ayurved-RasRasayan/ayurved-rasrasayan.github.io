exports.validateOrder = (data) => {
  const errors = [];
  if (!data.items || !Array.isArray(data.items) || data.items.length === 0) errors.push('Items array is required');
  else data.items.forEach((item, i) => {
    if (!item.name) errors.push(`Item ${i}: missing name`);
    if (typeof item.price !== 'number' || item.price < 0) errors.push(`Item ${i}: invalid price`);
  });
  if (typeof data.totalUSD !== 'number' || data.totalUSD < 0) errors.push('Invalid totalUSD');
  if (!data.clientDetails || typeof data.clientDetails !== 'object') errors.push('Client details required');
  else {
    if (!data.clientDetails.name || typeof data.clientDetails.name !== 'string') errors.push('Client name required');
    if (!data.clientDetails.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.clientDetails.email)) errors.push('Valid email required');
    if (!data.clientDetails.phone) errors.push('Phone number required');
  }
  return errors;
};

exports.getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress;
};

exports.generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();