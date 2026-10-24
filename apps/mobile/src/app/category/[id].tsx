import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { CategoryPicker } from '@/components/category-picker';
import { Button, ErrorText, Field, colors } from '@/components/ui';
import { deleteCategory, flatten, listCategories, mergeCategory, moveCategory, renameCategory, type CategoryNode } from '@/lib/categories';

/** CAT-5: rename, move, merge or delete one category. Entries keep their history. */
export default function CategoryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [category, setCategory] = useState<CategoryNode | null>(null);
  const [name, setName] = useState('');
  const [picking, setPicking] = useState<'move' | 'merge' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCategories().then((tree) => {
      const found = flatten(tree).find((c) => c.id === id) ?? null;
      setCategory(found);
      setName(found?.name ?? '');
    });
  }, [id]);

  if (!category) return null;
  const run = (work: () => Promise<unknown>) =>
    work().then(
      () => router.back(),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: category.name }} />
      <Field label="Name" value={name} onChangeText={setName} maxLength={80} />
      <Button title="Rename" onPress={() => run(() => renameCategory(id, name))} disabled={name.trim() === '' || name === category.name} />

      <Text style={styles.body}>
        Moving or merging keeps every entry: they count toward the new place from then on, in every month.
      </Text>
      <View style={styles.actions}>
        {category.parentId ? (
          <Button title="Make it top level" variant="secondary" onPress={() => run(() => moveCategory(id, null))} />
        ) : null}
        <Button title="Move under…" variant="secondary" onPress={() => setPicking('move')} />
        <Button title="Merge into…" variant="secondary" onPress={() => setPicking('merge')} />
        <Button
          title="Delete"
          variant="secondary"
          onPress={() =>
            Alert.alert(
              `Delete ${category.name}?`,
              category.parentId
                ? 'Its entries, rules and budgets move to the parent category.'
                : 'Its entries and rules move to Uncategorised.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => run(() => deleteCategory(id)) },
              ],
            )
          }
        />
      </View>
      {error && <ErrorText>{error}</ErrorText>}

      <CategoryPicker
        visible={picking !== null}
        flow={category.flow}
        topLevelOnly={picking === 'move'}
        allowCreate={false}
        exclude={[id]}
        title={picking === 'move' ? `Move ${category.name} under` : `Merge ${category.name} into`}
        onPick={(target) => {
          const mode = picking;
          setPicking(null);
          if (mode === 'move') run(() => moveCategory(id, target.id));
          else
            Alert.alert(`Merge into ${target.name}?`, `${category.name} goes away and its entries, rules and sub-categories move to ${target.name}.`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Merge', style: 'destructive', onPress: () => run(() => mergeCategory(id, target.id)) },
            ]);
        }}
        onClose={() => setPicking(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48, gap: 12 },
  body: { fontSize: 14, color: colors.muted, marginTop: 16 },
  actions: { gap: 12 },
});
