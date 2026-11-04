import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FilterTabs } from './components/FilterTabs';
import { TodoInput } from './components/TodoInput';
import { TodoItem } from './components/TodoItem';
import { useTodos } from './hooks/useTodos';
import { colors } from './theme/colors';

const EMPTY_TEXT = {
  all: '아직 할 일이 없어요.\n위에서 첫 할 일을 추가해 보세요.',
  active: '남은 할 일이 없어요. 👏',
  done: '완료한 할 일이 없어요.',
} as const;

export function TodoScreen() {
  const { todos, total, remaining, doneCount, filter, setFilter, add, toggle, remove, clearDone, loaded } = useTodos();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>CONAS · TODO</Text>
          <Text style={styles.title}>오늘 할 일</Text>
          <Text style={styles.summary}>
            {total === 0 ? '할 일을 추가해 보세요' : `${remaining}개 남음 · ${doneCount}개 완료`}
          </Text>
        </View>

        <View style={styles.controls}>
          <TodoInput onSubmit={add} />
          <FilterTabs value={filter} onChange={setFilter} />
        </View>

        <FlatList
          data={todos}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <TodoItem todo={item} onToggle={toggle} onRemove={remove} />}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={loaded ? <Text style={styles.empty}>{EMPTY_TEXT[filter]}</Text> : undefined}
          ListFooterComponent={
            doneCount > 0 ? (
              <Pressable onPress={clearDone} style={styles.clear} accessibilityRole="button">
                <Text style={styles.clearText}>완료한 항목 지우기</Text>
              </Pressable>
            ) : undefined
          }
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.violet,
    fontWeight: '600',
  },
  title: {
    marginTop: 6,
    fontSize: 30,
    fontWeight: '700',
    color: colors.ink,
  },
  summary: {
    marginTop: 4,
    fontSize: 14,
    color: colors.soft,
  },
  controls: {
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    flexGrow: 1,
  },
  empty: {
    marginTop: 48,
    textAlign: 'center',
    lineHeight: 22,
    color: colors.dim,
  },
  clear: {
    alignSelf: 'center',
    marginTop: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  clearText: {
    color: colors.pink,
    fontSize: 14,
  },
});
