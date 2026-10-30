import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import designTokens from '@societysaas/design-tokens';

const { colors, spacing } = designTokens;

export function Screen({ children, scroll = true }) {
  const content = scroll ? (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={styles.content}>{children}</View>
  );

  return <SafeAreaView style={styles.safeArea}>{content}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, gap: spacing[4], padding: spacing[5] },
});
