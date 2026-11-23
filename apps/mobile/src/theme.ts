// Системные цвета платформы: на iOS — UIKit (сами меняются в тёмной теме), на Android — Material You от обоев.
import { Color } from 'expo-router';
import { Platform } from 'react-native';

const pick = (ios: Parameters<typeof Platform.select>[0]['ios'], android: unknown) => Platform.select({ ios, android, default: '#000' }) as string;

export const colors = {
  label: pick(Color.ios.label, Color.android.dynamic.onSurface),
  secondaryLabel: pick(Color.ios.secondaryLabel, Color.android.dynamic.onSurfaceVariant),
  separator: pick(Color.ios.separator, Color.android.dynamic.outlineVariant),
  background: pick(Color.ios.systemGroupedBackground, Color.android.dynamic.surface),
  card: pick(Color.ios.secondarySystemGroupedBackground, Color.android.dynamic.surfaceContainer),
  fill: pick(Color.ios.tertiarySystemFill, Color.android.dynamic.surfaceContainerHighest),
  tint: pick(Color.ios.systemBlue, Color.android.dynamic.primary),
  onTint: pick('#FFFFFF', Color.android.dynamic.onPrimary),
  hot: pick(Color.ios.systemOrange, Color.android.dynamic.tertiary),
  good: pick(Color.ios.systemGreen, Color.android.dynamic.secondary),
};
