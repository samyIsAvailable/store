module.exports = {
  apps: [
    {
      name: 'my-store',
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        ADMIN_PASSWORD: 'ChangeMeStrong!'
      }
    }
  ]
};
