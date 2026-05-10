const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'natura_botanica_super_secret_key_123';

exports.checkAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Authentication Required');
  }
  try {
    const decoded = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
    const [user, pass] = decoded.split(':');
    if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASSWORD) return next();
  } catch (e) {}
  res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
  return res.status(401).send('Access Denied');
};

exports.userAuth = (req, res, next) => {
  const token = req.header('Authorization');
  if (!token) return res.status(401).json({ error: 'No token, authorization denied' });
  try {
    const decoded = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token is not valid' });
  }
};