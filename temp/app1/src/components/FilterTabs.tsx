import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme/colors';
import type { Filter } from '../types';

const TABS: { key: Filter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'active', label: '할 일' },
  { key: 'done', label: '완료' },
];

type Props = {
  value: Filter;
  onChange: (f: Filter) => void;
};

export function FilterTabs({ value, onChange }: Props) {
  return (
    <View style={styles.wrap} accessibilityRole="tablist">
      {TABS.map((tab) => {
        const active = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={[styles.tab, active && styles.tabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(40, 50, 120, 0.06)',
  },
  tab: {
    flex: 1,
    minHeight: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: colors.surface,
    shadowColor: '#14162b',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  label: {
    fontSize: 14,
    color: colors.soft,
  },
  labelActive: {
    color: colors.ink,
    fontWeight: '600',
  },
});
