// Aquarium Public backend — standalone entrypoint.
// Serves the frontend from ../public plus the JSON API under /api.
// Health check: GET /health -> {ok:true}.
const { createApp } = require('./app');

async function main() {
  const app = await createApp();
  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, () => {
    console.log(`aquarium-public backend listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('failed to start:', err);
  process.exit(1);
});
