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
        primary: { DEFAULT: 'rgb(var(--accent-violet))', foreground: 'rgb(232 232 248)' },
        secondary: { DEFAULT: 'rgb(var(--bg-elevated))', foreground: 'rgb(var(--text-secondary))' },
        muted: { DEFAULT: 'rgb(var(--bg-muted))', foreground: 'rgb(var(--text-secondary))' },
        accent: { DEFAULT: 'rgb(var(--bg-elevated))', foreground: 'rgb(var(--text-primary))' },
        destructive: { DEFAULT: 'rgb(var(--error))', foreground: 'rgb(232 232 248)' },
        input: 'rgb(var(--bg-elevated))',
        ring: 'rgb(var(--accent-violet))',
        violet: {
          400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9',
        },
        fuchsia: {
          400: '#e879f9', 500: '#d946ef', 600: '#c026d3',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: '0.875rem',
        '2xl': '1rem',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'SF Pro Display', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
