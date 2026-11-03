const { spawn } = require('child_process');
const path = require('path');

const env = {
  ...process.env,
  HIPOS_FEATURE_STORAGE: 'postgres',
  HIPOS_FEATURES_CONNECTION: 'Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only',
  ASPNETCORE_URLS: 'http://127.0.0.1:5180',
  ASPNETCORE_ENVIRONMENT: 'Development'
};

const child = spawn('dotnet', ['run', '--project', 'apps/api/Hipos.Api', '--no-build', '--urls', 'http://127.0.0.1:5180'], {
  stdio: 'inherit',
  env
});

child.on('exit', (code) => {
  console.log(`API exited with code ${code}`);
});
