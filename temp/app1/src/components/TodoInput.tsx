import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '../theme/colors';

type Props = {
  onSubmit: (title: string) => void;
};

export function TodoInput({ onSubmit }: Props) {
  const [text, setText] = useState('');
  const canSubmit = text.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(text);
    setText('');
  };

  return (
    <View style={styles.row}>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        onSubmitEditing={submit}
        placeholder="할 일을 입력하세요"
        placeholderTextColor={colors.dim}
        returnKeyType="done"
        submitBehavior="submit"
        accessibilityLabel="새 할 일"
      />
      <Pressable
        onPress={submit}
        disabled={!canSubmit}
        style={({ pressed }) => [styles.button, !canSubmit && styles.buttonDisabled, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="추가"
      >
        <Text style={styles.buttonText}>추가</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 50,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    fontSize: 16,
    color: colors.ink,
  },
  button: {
    minWidth: 64,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  pressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
