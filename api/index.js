// Vercel serverless entrypoint — adapts the shared Express app to
// Vercel's (req, res) function signature without any provider wrapper.
// vercel.json routes /api/* and /health here; static files are served
// by Vercel's CDN straight from public/.
// The app (and its Turso client) is created once per warm instance and reused.
const { createApp } = require('../server/app');

let appPromise;
function getApp() {
  if (!appPromise) appPromise = createApp();
  return appPromise;
}

module.exports = async (req, res) => {
  const app = await getApp();
  await new Promise((resolve, reject) => {
    res.on('finish', resolve);
    res.on('error', reject);
    app(req, res);
  });
};
