/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Onebeep — clean clinical palette (light, airy, medical teal)
        canvas: '#F1F6F8',
        surface: '#FFFFFF',
        ink: '#0B1727',
        ink2: '#5A6B7B',
        line: '#E2EBF0',
        // Pulse / positive vitals accent (medical teal)
        pulse: '#0D9488',
        pulse2: '#14B8A6',
        // Heart-rate accent (warm coral)
        heart: '#F43F5E',
        heart2: '#FB7185',
        // Respiratory / secondary accent (clinical sky)
        sky: '#0891B2',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontVariantNumeric: {
        tabular: 'tabular-nums',
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,23,39,0.04), 0 8px 24px -12px rgba(11,23,39,0.12)',
        float: '0 10px 40px -12px rgba(13,148,136,0.35)',
      },
    },
  },
  plugins: [],
}
