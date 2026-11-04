import { useCallback, useEffect, useMemo, useState } from 'react';

import { loadTodos, saveTodos } from '../storage/todoStorage';
import type { Filter, Todo } from '../types';

const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// 할 일 목록의 상태와 동작을 한곳에 모은 훅. 화면 컴포넌트는 이것만 쓰면 됨.
export function useTodos() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadTodos().then((saved) => {
      setTodos(saved);
      setLoaded(true);
    });
  }, []);

  // 처음 불러오기 전에는 저장하지 않음 (빈 목록으로 덮어쓰기 방지)
  useEffect(() => {
    if (loaded) saveTodos(todos);
  }, [todos, loaded]);

  const add = useCallback((title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setTodos((prev) => [{ id: makeId(), title: trimmed, done: false, createdAt: Date.now() }, ...prev]);
  }, []);

  const toggle = useCallback((id: string) => {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }, []);

  const remove = useCallback((id: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearDone = useCallback(() => {
    setTodos((prev) => prev.filter((t) => !t.done));
  }, []);

  const visible = useMemo(() => {
    if (filter === 'active') return todos.filter((t) => !t.done);
    if (filter === 'done') return todos.filter((t) => t.done);
    return todos;
  }, [todos, filter]);

  const remaining = useMemo(() => todos.filter((t) => !t.done).length, [todos]);
  const doneCount = todos.length - remaining;

  return { todos: visible, total: todos.length, remaining, doneCount, filter, setFilter, add, toggle, remove, clearDone, loaded };
}
