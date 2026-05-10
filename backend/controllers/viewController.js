const fs = require('fs');
const path = require('path');

const getView = (filename) => (req, res) => {
  try {
    // Path goes up one level to backend/, then into views/
    let html = fs.readFileSync(path.join(__dirname, '..', 'views', filename), 'utf8');
    res.send(html);
  } catch (e) { res.status(500).send('Error loading page'); }
};

exports.manageUsers = getView('user-management.html');
exports.viewOrders = getView('orders.html');
exports.profile = getView('user.html'); // Assuming user.html might be added later