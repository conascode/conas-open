import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Todo } from '../types';

const KEY = 'conas.todos.v1';

export async function loadTodos(): Promise<Todo[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Todo[]) : [];
  } catch {
    return [];
  }
}

export async function saveTodos(todos: Todo[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(todos));
  } catch {
    // 저장 실패는 앱을 멈추지 않음. 다음 변경 때 다시 저장됨.
  }
}
