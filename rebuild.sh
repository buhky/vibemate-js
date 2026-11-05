#!/bin/bash
set -e

echo "🧹 Stopping old container..."
docker compose down

echo "🔄 Rebuilding image with latest dependencies..."
docker compose build --no-cache vibemate

echo "🚀 Starting container..."
docker compose up -d vibemate

echo "📋 Showing logs..."
docker compose logs -f vibemate

