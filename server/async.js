// Wrap async Express handlers so rejected promises reach the error middleware
// (Express 4 does not catch them on its own).
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ah };
