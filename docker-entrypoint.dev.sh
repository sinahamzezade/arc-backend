#!/bin/sh
set -e
cd /app
npm install
npm run admin:ui:build
exec npm run start:dev
