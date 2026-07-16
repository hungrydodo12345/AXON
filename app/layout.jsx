/**
 * app/layout.jsx — Root Layout
 *
 * Injects constitution-driven CSS variables at root level.
 * All sensory settings (brightness, grayscale, font) applied here.
 */

import "../styles/globals.css";

export const metadata = {
  title: "Neuro-Librarian",
  description: "Your social translation layer",
  manifest: "/manifest.json",
  themeColor: "#1a1a1a",
  viewport: "width=device-width, initial-scale=1, maximum-scale=1",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Neuro-Librarian",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body>
        {/* SensoryProvider wraps everything — CSS vars injected from user profile */}
        <SensoryRoot />
        {children}
      </body>
    </html>
  );
}

/**
 * Client component that reads sensory settings from localStorage
 * and injects them as CSS variables on <html>.
 * This avoids a flash of unstyled bright content.
 */
function SensoryRoot() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
          (function() {
            try {
              var s = localStorage.getItem('nl_sensory');
              if (s) {
                var cfg = JSON.parse(s);
                var root = document.documentElement;
                if (cfg.brightness !== undefined) root.style.setProperty('--nl-brightness', cfg.brightness);
                if (cfg.grayscale !== undefined) root.style.setProperty('--nl-grayscale', cfg.grayscale ? '100%' : '0%');
                if (cfg.font === 'dyslexic') document.body.classList.add('font-dyslexic');
                if (cfg.font === 'readable') document.body.classList.add('font-readable');
              }
            } catch(e) {}
          })();
        `,
      }}
    />
  );
}
