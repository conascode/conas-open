import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme/colors';
import type { Todo } from '../types';

type Props = {
  todo: Todo;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
};

function TodoItemBase({ todo, onToggle, onRemove }: Props) {
  return (
    <View style={styles.card}>
      <Pressable
        style={styles.main}
        onPress={() => onToggle(todo.id)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: todo.done }}
        accessibilityLabel={todo.title}
      >
        <View style={[styles.check, todo.done && styles.checkOn]}>
          {todo.done && <Text style={styles.checkMark}>✓</Text>}
        </View>
        <Text style={[styles.title, todo.done && styles.titleDone]} numberOfLines={3}>
          {todo.title}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => onRemove(todo.id)}
        hitSlop={8}
        style={({ pressed }) => [styles.delete, pressed && { opacity: 0.5 }]}
        accessibilityRole="button"
        accessibilityLabel={`${todo.title} 삭제`}
      >
        <Text style={styles.deleteText}>✕</Text>
      </Pressable>
    </View>
  );
}

export const TodoItem = memo(TodoItemBase);

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingLeft: 14,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.dim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: colors.violet,
    borderColor: colors.violet,
  },
  checkMark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  title: {
    flex: 1,
    fontSize: 16,
    color: colors.ink,
  },
  titleDone: {
    color: colors.dim,
    textDecorationLine: 'line-through',
  },
  delete: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    fontSize: 16,
    color: colors.dim,
  },
});
