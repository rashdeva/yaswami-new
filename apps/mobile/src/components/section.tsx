import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { colors } from '@/theme';

/** Сгруппированный блок, как в «Настройках»: подпись сверху и карточка со скруглением. */
export function Section({ title, children, footer }: { title?: string; children: ReactNode; footer?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {title && <Text style={{ color: colors.secondaryLabel, fontSize: 13, textTransform: 'uppercase', paddingHorizontal: 16 }}>{title}</Text>}
      <View style={{ backgroundColor: colors.card, borderRadius: 16, borderCurve: 'continuous', overflow: 'hidden' }}>{children}</View>
      {footer && <Text style={{ color: colors.secondaryLabel, fontSize: 13, paddingHorizontal: 16 }}>{footer}</Text>}
    </View>
  );
}

/** Строка блока: подпись и значение. */
export function Row({ icon, children }: { icon?: string; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12, padding: 14 }}>
      {icon && <Text style={{ fontSize: 17 }}>{icon}</Text>}
      <Text selectable style={{ flex: 1, color: colors.label, fontSize: 16, lineHeight: 22 }}>{children}</Text>
    </View>
  );
}
