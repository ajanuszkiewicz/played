#!/usr/bin/env bash
set -e
PI=adamj@platipi.local

echo "==> Building web UI..."
cd web
npm install --silent
npm run build
cd ..

echo "==> Syncing files..."
rsync -av \
  --exclude='.DS_Store' \
  --exclude='.git' \
  --exclude='.gitignore' \
  --exclude='web/node_modules' \
  --exclude='web/src' \
  --exclude='web/package.json' \
  --exclude='web/package-lock.json' \
  --exclude='web/tsconfig.json' \
  --exclude='web/vite.config.ts' \
  --exclude='web/index.html' \
  ./ $PI:/home/adamj/rpi-song-tracker/

read -r -p "==> Overwrite /etc/song-tracker/env on the Pi with env.example? [y/N] " overwrite_env

echo "==> Deploying on Pi..."
ssh $PI "
  sudo cp ~/rpi-song-tracker/scripts/*.py /usr/local/bin/song-tracker/ &&
  sudo chmod 644 /usr/local/bin/song-tracker/*.py &&
  sudo cp -r ~/rpi-song-tracker/web/dist/. /usr/local/bin/song-tracker/web/ &&
  sudo chmod -R 755 /usr/local/bin/song-tracker/web/ &&
  $([ "$overwrite_env" = "y" ] || [ "$overwrite_env" = "Y" ] && echo 'sudo cp ~/rpi-song-tracker/env.example /etc/song-tracker/env &&' || echo '') \
  sudo cp ~/rpi-song-tracker/config/asound.conf /etc/asound.conf &&
  sudo systemctl restart song-tracker song-tracker-web &&
  echo 'Deploy complete'
"
