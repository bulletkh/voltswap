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
          50: '#fbfef0',
          100: '#f6fed2',
          200: '#eefd9d',
          300: '#e3fa5c',
          400: '#d7f626',
          500: '#c0dc11',
          DEFAULT: '#e3fa5c',
          glow: '#d7f626'
        },
        dark: {
          900: '#0a0b0d',
          800: '#121418',
          700: '#1b1e24',
          600: '#262a33',
        }
      },
      boxShadow: {
        'volt-glow': '0 0 25px rgba(215, 246, 38, 0.25)',
      }
    },
  },
  plugins: [],
}
