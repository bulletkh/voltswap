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
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          DEFAULT: '#38bdf8',
          glow: '#0284c7'
        },
        dark: {
          900: '#0a0b0d',
          800: '#121418',
          700: '#1b1e24',
          600: '#262a33',
        }
      },
      boxShadow: {
        'volt-glow': '0 0 25px rgba(56, 189, 248, 0.25)',
      }
    },
  },
  plugins: [],
}
