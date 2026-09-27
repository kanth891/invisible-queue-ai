#!/bin/bash
# ──────────────────────────────────────────────────
# Invisible Queue AI — Local Setup Script
# ──────────────────────────────────────────────────
# Usage: bash scripts/setup.sh
# ──────────────────────────────────────────────────

set -e

echo ""
echo "🏥 Invisible Queue AI — Local Setup"
echo "────────────────────────────────────"
echo ""

# Check .env exists
if [ ! -f ".env" ]; then
  echo "📋 Creating .env from .env.example..."
  cp .env.example .env
  echo "⚠️  Please edit .env with your Supabase DATABASE_URL"
  echo ""
fi

# Install root dependencies
echo "📦 Installing root dependencies..."
npm install

# Install backend dependencies
echo ""
echo "📦 Installing backend dependencies..."
cd backend && npm install && cd ..

# Install frontend dependencies
echo ""
echo "📦 Installing frontend dependencies..."
cd frontend && npm install && cd ..

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit .env with your Supabase DATABASE_URL"
echo "  2. Run backend:  cd backend && npm run dev"
echo "  3. Run frontend: cd frontend && npm run dev"
echo "  4. Or use:       npm run dev (runs both)"
echo ""
