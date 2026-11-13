/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        volt: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#2b7fff',
          DEFAULT: '#2b7fff',
          glow: '#1d6ff2'
        },
        dark: {
          950: '#000000',
          900: '#06070a',
          800: '#0c0e13',
          700: '#161a22',
          600: '#202632',
        }
      },
      boxShadow: {
        'volt-glow': '0 0 24px rgba(43, 127, 255, 0.28)',
      }
    },
  },
  plugins: [],
}
