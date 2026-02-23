const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-set-JWT_SECRET-in-env';

module.exports = function requireAuth(req, res, next) {
  const token = req.cookies.oc_token;

  if (!token) {
    return res.redirect('/login');
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('oc_token');
    res.redirect('/login');
  }
};
