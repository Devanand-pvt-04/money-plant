import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { CategoryFlow } from '@money-plant/categoriser';
import { listCategories, type CategoryNode } from '@/lib/categories';
import { Button, colors } from './ui';

interface Props {
  visible: boolean;
  /** Only show spending or only income categories. */
  flow?: CategoryFlow;
  /** Only top-level categories, for picking a parent. */
  topLevelOnly?: boolean;
  /** Ids that can't be picked, such as the category being moved. */
  exclude?: readonly string[];
  title?: string;
  onPick: (category: CategoryNode) => void;
  onClose: () => void;
}

/** Two-level category picker (CAT-5): parents with their sub-categories indented, searchable. */
export function CategoryPicker({ visible, flow, topLevelOnly, exclude = [], title = 'Pick a category', onPick, onClose }: Props) {
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (visible) listCategories().then(setTree);
    else setQuery('');
  }, [visible]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: { node: CategoryNode; depth: number }[] = [];
    for (const root of tree) {
      if (flow && root.flow !== flow) continue;
      if (topLevelOnly && root.system) continue;
      const children = topLevelOnly ? [] : root.children.filter((c) => !q || c.name.toLowerCase().includes(q));
      const rootMatches = !q || root.name.toLowerCase().includes(q);
      if (!rootMatches && children.length === 0) continue;
      out.push({ node: root, depth: 0 });
      for (const child of children) out.push({ node: child, depth: 1 });
    }
    return out.filter((row) => !exclude.includes(row.node.id));
  }, [tree, query, flow, topLevelOnly, exclude]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <Text style={styles.title}>{title}</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={colors.muted}
          style={styles.search}
          autoCorrect={false}
        />
        <FlatList
          data={rows}
          keyExtractor={(row) => row.node.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => onPick(item.node)}
              style={({ pressed }) => [styles.row, item.depth === 1 && styles.child, pressed && styles.pressed]}
            >
              <Text style={[styles.name, item.depth === 0 && styles.parent]}>{item.node.name}</Text>
            </Pressable>
          )}
        />
        <Button title="Cancel" variant="secondary" onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, backgroundColor: colors.background },
  title: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 16 },
  search: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  row: { paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  child: { paddingLeft: 28 },
  pressed: { backgroundColor: colors.pressed },
  name: { fontSize: 16, color: colors.text },
  parent: { fontWeight: '600' },
});
