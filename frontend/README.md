# Invisible Queue AI — Frontend

React.js client for the Invisible Queue AI hospital management system.

## Quick Start

```bash
# Install dependencies
npm install

# Development (port 5173)
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL | `""` (uses Vite proxy in dev) |

## Tech Stack

- **React** 19 + Vite 8
- **Styling**: Vanilla CSS with CSS custom properties
- **Font**: Inter (Google Fonts)

## Project Structure

```
src/
├── App.jsx         # Main application component
├── App.css         # Component styles
├── index.css       # Global styles and design tokens
├── main.jsx        # React entry point
└── assets/         # Static assets
```
