import type { Config } from 'tailwindcss';
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'rgb(var(--bg-base) / <alpha-value>)',
        foreground: 'rgb(var(--text-primary) / <alpha-value>)',
        surface: 'rgb(var(--bg-surface) / <alpha-value>)',
        elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        card: { DEFAULT: 'rgb(var(--bg-surface))', foreground: 'rgb(var(--text-primary))' },
        popover: { DEFAULT: 'rgb(var(--bg-elevated))', foreground: 'rgb(var(--text-primary))' },
        primary: { DEFAULT: 'rgb(var(--accent-violet))', foreground: 'rgb(var(--bg-base))' },
        secondary: { DEFAULT: 'rgb(var(--bg-elevated))', foreground: 'rgb(var(--text-secondary))' },
        muted: { DEFAULT: 'rgb(var(--bg-muted))', foreground: 'rgb(var(--text-secondary))' },
        accent: { DEFAULT: 'rgb(var(--bg-elevated))', foreground: 'rgb(var(--text-primary))' },
        destructive: { DEFAULT: 'rgb(var(--error))', foreground: 'rgb(var(--text-primary))' },
        input: 'rgb(var(--bg-elevated))',
        ring: 'rgb(var(--accent-violet))',
        // Nova2 violet palette — maps to accent-violet token
        violet: {
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8981e5',
          600: '#7a78d0',
          700: '#6366f1',
        },
      },
      // Nova2 border radii (sm=4, md=8, lg=10, xl=15, 2xl=20)
      borderRadius: {
        sm:   '4px',
        DEFAULT: '8px',
        md:   '8px',
        lg:   '10px',
        xl:   '15px',
        '2xl': '20px',
        full: '9999px',
      },
      // Nova2 multi-layer elevation shadows
      boxShadow: {
        m: '0px 2px 2px rgba(30,31,42,0.24), 0px 4px 4px rgba(30,31,42,0.24), 0px 8px 8px rgba(30,31,42,0.24)',
        l: '0px 2px 2px rgba(30,31,42,0.24), 0px 4px 4px rgba(30,31,42,0.24), 0px 8px 8px rgba(30,31,42,0.24), 0px 16px 16px rgba(30,31,42,0.24)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Source Sans Pro', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
