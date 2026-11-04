export type Todo = {
  id: string;
  title: string;
  done: boolean;
  createdAt: number;
};

export type Filter = 'all' | 'active' | 'done';
