export const colors = {
  navy950: '#101a2d',
  navy900: '#16243b',
  navy800: '#203451',
  blue600: '#2563eb',
  blue100: '#dbeafe',
  background: '#f4f6fa',
  surface: '#ffffff',
  border: '#dce2eb',
  text: '#182230',
  textMuted: '#667085',
  success: '#15803d',
  successSurface: '#ecfdf3',
  warning: '#b45309',
  warningSurface: '#fffaeb',
  danger: '#b42318',
  dangerSurface: '#fef3f2',
  info: '#175cd3',
  infoSurface: '#eff8ff',
};

export const typography = {
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: { xs: 12, sm: 14, md: 16, lg: 18, xl: 24, display: 30 },
  lineHeight: { tight: 1.25, normal: 1.5 },
  fontWeight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
};

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
};

export const radii = { sm: 6, md: 10, lg: 14, pill: 999 };

const designTokens = { colors, typography, spacing, radii };

export default designTokens;
