// Vercel serverless entrypoint — wraps the shared Express app.
// vercel.json routes /api/* and /health here; static files are served
// by Vercel's CDN straight from public/, so this function only handles API.
// The app (and its Turso client) is created once per warm instance and reused.
const serverless = require('serverless-http');
const { createApp } = require('../server/app');

let handler;
module.exports = async (req, res) => {
  if (!handler) {
    const app = await createApp();
    handler = serverless(app);
  }
  return handler(req, res);
};
