import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TodoScreen } from './src/TodoScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <TodoScreen />
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
