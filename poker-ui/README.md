# Poker Platform UI

This is the React-based frontend for the Poker Platform, built with Vite and TypeScript.

## Features

- **Responsive Design**: Works on desktop and mobile devices
- **Interactive Gameplay**: Join tables, play games, and view hand history
- **Authentication**: Login and manage accounts
- **Community Management**: Create and join poker communities

## Quick Start

### Installation
```bash
npm install
```

### Run the Development Server
```bash
npm run dev
# Server starts on http://localhost:5173
```

### Build for Production
```bash
npm run build
```

### Preview Production Build
```bash
npm run preview
```

## Responsive Smoke Tests (Playwright)

These tests protect layout stability across major aspect ratios (phones, tablets, laptops, desktop).

### One-time Browser Install
```bash
npx playwright install chromium
```

### Run the Responsive Smoke Matrix
```bash
npm run test:ui:smoke
```

### Useful Variants
```bash
# Faster visual debugging on key viewports
npm run test:ui:smoke:headed

# Open HTML report from the last run
npm run test:ui:smoke:report
```

What this covers:
- Login layout
- Register layout
- Authenticated dashboard layout
- Authenticated community lobby layout

The suite uses mocked API responses so it is deterministic and does not require backend services running.

## Project Structure

```
src/
├── api.ts            # API client for backend communication
├── App.tsx           # Main application component
├── components/       # Reusable UI components
├── pages/            # Page-level components (e.g., Dashboard, GameTable)
├── styles/           # Global and component-specific styles
└── utils/            # Utility functions
```

## Next Steps

1. Add more detailed error handling.
2. Implement WebSocket-based real-time updates.
3. Optimize performance for large communities.
