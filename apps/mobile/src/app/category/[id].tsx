import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { ICON_CHOICES, searchIcons } from '@money-plant/categoriser';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { FormScroll } from '@/components/keyboard';
import { CategoryPicker } from '@/components/category-picker';
import { categoryStyle, type IconName } from '@/components/category-style';
import { CategoryIcon } from '@/components/sheet';
import { Button, ErrorText, Field, radius, useColors, makeStyles } from '@/components/ui';
import { ICON_NAMES } from '@/lib/icon-set';
import { deleteCategory, flatten, listCategories, mergeCategory, moveCategory, renameCategory, setCategoryIcon, type CategoryNode } from '@/lib/categories';

/** CAT-1, CAT-5: rename, change the icon, move, merge or delete one category. Entries keep their history. */
export default function CategoryDetail() {
  const colors = useColors();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [category, setCategory] = useState<CategoryNode | null>(null);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  // CAT-1: every icon in the font is searchable; the grid below the search shows the common ones.
  const found = useMemo(() => searchIcons(query, ICON_NAMES), [query]);
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
  // The icon as it would look with the name being typed, so a new name shows its icon before saving.
  const typed = { ...category, name: name.trim() || category.name };
  const automatic = categoryStyle({ ...typed, icon: null });
  const pickIcon = (icon: string | null) => {
    setCategory({ ...category, icon });
    setCategoryIcon(id, icon).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  const run = (work: () => Promise<unknown>) =>
    work().then(
      () => router.back(),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: category.name }} />
      <View style={styles.nameRow}>
        <CategoryIcon category={typed} size={48} />
        <View style={styles.grow}>
          <Field label="Name" value={name} onChangeText={setName} maxLength={80} />
        </View>
      </View>
      <Button title="Rename" onPress={() => run(() => renameCategory(id, name))} disabled={name.trim() === '' || name === category.name} />

      <Text style={styles.section}>Icon</Text>
      <Field
        label="Search all icons"
        value={query}
        onChangeText={setQuery}
        placeholder="badminton, guitar, temple…"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {query.trim() !== '' && found.length === 0 && <Text style={styles.body}>No icons match "{query.trim()}".</Text>}
      <View style={styles.icons}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pick the icon from the name"
          accessibilityState={{ selected: category.icon === null }}
          onPress={() => pickIcon(null)}
          style={[styles.auto, category.icon === null && styles.chosen]}
        >
          <MaterialCommunityIcons name={automatic.icon} size={20} color={automatic.color} />
          <Text style={styles.autoText}>From the name</Text>
        </Pressable>
        {(query.trim() ? found : category.icon && !ICON_CHOICES.includes(category.icon) ? [category.icon, ...ICON_CHOICES] : ICON_CHOICES).map((icon) => (
          <Pressable
            key={icon}
            accessibilityRole="button"
            accessibilityLabel={icon.replace(/-/g, ' ')}
            accessibilityState={{ selected: category.icon === icon }}
            onPress={() => pickIcon(icon)}
            style={[styles.icon, category.icon === icon && styles.chosen]}
          >
            <MaterialCommunityIcons name={icon as IconName} size={22} color={colors.secondary} />
          </Pressable>
        ))}
      </View>

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
    </FormScroll>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { padding: 16, paddingBottom: 48, gap: 12 },
  body: { fontSize: 14, color: colors.muted, marginTop: 16 },
  nameRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  grow: { flex: 1 },
  section: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 12 },
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  icon: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.subtle, borderWidth: 2, borderColor: 'transparent' },
  auto: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 12, borderRadius: radius.sm, backgroundColor: colors.subtle, borderWidth: 2, borderColor: 'transparent' },
  autoText: { fontSize: 13, color: colors.text },
  chosen: { borderColor: colors.primary },
  actions: { gap: 12 },
}));
