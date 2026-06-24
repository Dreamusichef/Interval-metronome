// PM2 process definition for the Ops Daemon.
// Mirrors the Pulse Bot deploy pattern: git pull on the VPS, then
//   pm2 start ecosystem.config.js     (first deploy)
//   pm2 reload ops-daemon             (subsequent updates)
//
// This is its OWN PM2 app, separate from dojo-pulse. A slow or hung daemon
// module must never be able to lag Pulse's live clip tracking.

module.exports = {
  apps: [
    {
      name: 'ops-daemon',
      cwd: '/opt/ops-daemon',
      script: 'index.js',
      // Long-lived scheduler process — node-cron keeps it alive.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      // Modest cap; the daemon is mostly idle between nightly cycles.
      max_memory_restart: '256M',
      // config.js reads /opt/ops-daemon/.env itself (no dotenv dependency),
      // so the secrets never need to live in this committed file.
      env: {
        NODE_ENV: 'production',
      },
      time: true,
    },
  ],
};
